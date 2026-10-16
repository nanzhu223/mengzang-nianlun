/* =====================================================================
 * tree3d.js —— 首页开头「3D 枣树」
 * ---------------------------------------------------------------------
 * · 完全程序化生成：树干/枝条用递归算法生长，树皮、树叶、地面纹理全部
 *   用 Canvas 现场绘制；叶片与枣果用 InstancedMesh，整棵树上万个顶点
 *   只占 4~5 个 draw call。
 * · 依赖本地内置的 three.js（assets/vendor/three/three.global.js，
 *   经典脚本，暴露 window.THREE），因此 file:// 双击打开也能显示。
 * · 无 WebGL 时优雅降级：隐藏画布，保留文字层，不影响其余页面。
 * · 支持 prefers-reduced-motion：关闭自转与风动。
 * ===================================================================== */
(function () {
  'use strict';

  var THREE = window.THREE;
  var section = document.getElementById('opening');
  var canvas = document.getElementById('treeCanvas');

  if (!section || !canvas) return;
  if (!THREE) { degrade('three.js 未加载'); return; }

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { reduceMotion = false; }

  function degrade(msg) {
    if (window.console && console.warn) {
      console.warn('[tree3d] 已降级为静态开场：' + msg);
    }
    section.classList.add('no-webgl');
  }

  /* ================================================================== */
  /* 主流程                                                              */
  /* ================================================================== */
  function init() {
    // ---- WebGL 能力探测 ----
    var probe = document.createElement('canvas');
    var gl = probe.getContext('webgl2') || probe.getContext('webgl') ||
      probe.getContext('experimental-webgl');
    if (!gl) throw new Error('当前环境不支持 WebGL');

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: true,
      powerPreference: 'high-performance'
    });
    var small = (window.innerWidth || 999) < 700;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;

    if (renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
      try { rendererAniso = renderer.capabilities.getMaxAnisotropy(); } catch (e) { }
    }

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf0e5cd, 26, 66);

    var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
    var focus = new THREE.Vector3(0, 4.9, 0);

    /* ---------------- 光照：晴天正午，暖阳 + 冷天光 ---------------- */
    scene.add(new THREE.HemisphereLight(0xdcecff, 0x4a3a24, 1.05));

    var sun = new THREE.DirectionalLight(0xffe9c4, 2.65);
    sun.position.set(11, 17, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    var SH = 13;
    sun.shadow.camera.left = -SH;
    sun.shadow.camera.right = SH;
    sun.shadow.camera.top = SH;
    sun.shadow.camera.bottom = -SH;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    sun.target.position.copy(focus);
    scene.add(sun);
    scene.add(sun.target);

    var rim = new THREE.DirectionalLight(0xc2d8ff, 0.55);
    rim.position.set(-10, 8, -11);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    /* ---------------- 程序化纹理 ---------------- */
    var bark = makeBarkTextures();
    var leafTex = makeLeafTexture();
    var groundTex = makeGroundTexture();

    // 各存一份像素备份，供上下文丢失时重建
    backupTexture(bark.color);
    backupTexture(bark.bump);
    backupTexture(leafTex);
    backupTexture(groundTex);

    var wind = { value: 0 };

    /* ---------------- 树干与枝条 ---------------- */
    var treeGroup = new THREE.Group();
    var store = { bark: [], twig: [], tips: [] };

    growBranch({
      start: new THREE.Vector3(0, 0, 0),
      dir: new THREE.Vector3(0.05, 1, 0.02).normalize(),
      length: 3.7, radius: 0.62, depth: 0, store: store
    });

    var barkMat = new THREE.MeshStandardMaterial({
      map: bark.color, bumpMap: bark.bump, bumpScale: 0.02,
      color: 0xb39a79, roughness: 0.97, metalness: 0.0
    });
    var barkMesh = new THREE.Mesh(mergeGeoms(store.bark), barkMat);
    barkMesh.castShadow = true;
    barkMesh.receiveShadow = true;
    treeGroup.add(barkMesh);

    var twigMat = new THREE.MeshStandardMaterial({
      color: 0x7a6350, roughness: 0.9, metalness: 0.0
    });
    var twigMesh = new THREE.Mesh(mergeGeoms(store.twig), twigMat);
    twigMesh.castShadow = true;
    twigMesh.receiveShadow = true;
    applyWind(twigMat, wind, true);
    treeGroup.add(twigMesh);

    /* ---------------- 叶片 ---------------- */
    var leaves = buildLeaves(store.tips, leafTex, wind);
    treeGroup.add(leaves);

    /* ---------------- 枣果 ---------------- */
    var fruits = buildFruits(store.tips);
    treeGroup.add(fruits);

    scene.add(treeGroup);

    /* ---------------- 地面 ---------------- */
    var ground = new THREE.Mesh(
      new THREE.CircleGeometry(80, 64),
      new THREE.MeshStandardMaterial({
        map: groundTex, color: 0xffffff, roughness: 1, metalness: 0
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    scene.add(ground);

    /* ---------------- 相机控制 ---------------- */
    var controls = createControls(canvas, reduceMotion);

    /* ---------------- 尺寸自适应 ---------------- */
    function resize() {
      var w = section.clientWidth || window.innerWidth;
      var h = section.clientHeight || Math.round(window.innerHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      // 竖屏（手机）时拉远一点，保证整棵树都在画面里
      controls.baseDist = camera.aspect < 1 ? 28 : (camera.aspect < 1.5 ? 22 : 19);
      camera.updateProjectionMatrix();
    }
    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(section);
    }
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    resize();

    /* ---------------- 渲染循环 ---------------- */
    var clock = new THREE.Clock();
    function frame() {
      var dt = Math.min(clock.getDelta(), 0.05);
      wind.value = reduceMotion ? 0 : clock.elapsedTime;
      controls.update(dt);
      controls.apply(camera, focus);
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // WebGL 上下文丢失/恢复：自动用备份重建纹理，避免树叶等消失（不影响外观）
    canvas.addEventListener('webglcontextlost', function (e) {
      if (e && e.preventDefault) e.preventDefault();
    }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      restoreTextures();
    }, false);
    // 启动早期做两次完整性自检，应对极端的源 canvas 后备存储被回收
    var selfChecks = [900, 2600];
    for (var si = 0; si < selfChecks.length; si++) {
      (function (ms) {
        setTimeout(function () {
          if (leafTextureEmpty(leafTex)) restoreTextures();
        }, ms);
      })(selfChecks[si]);
    }

    section.classList.add('tree-ready');

    // 便于自动化检查/调试（无副作用）
    window.__tree3d = {
      THREE: THREE, renderer: renderer, scene: scene, camera: camera,
      counts: { leaves: leaves.count, fruits: fruits.count, tips: store.tips.length },
      restore: restoreTextures, backups: textureBackups.length
    };
  }

  /* ================================================================== */
  /* 递归生长：树干 → 主枝 → 侧枝 → 细枝                                  */
  /* ================================================================== */
  var MAX_DEPTH = 5;
  var CHILDREN = [5, 3, 3, 3, 3];   // 各层分叉数

  function growBranch(o) {
    var start = o.start, dir = o.dir, length = o.length,
      radius = o.radius, depth = o.depth, store = o.store;

    var sub = depth === 0 ? 4 : (depth === 1 ? 3 : 2);
    var p = start.clone();
    var d = dir.clone().normalize();

    // 每根枝的随机弯曲轴向
    var bendAxis = new THREE.Vector3(
      Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
    ).normalize();
    if (bendAxis.lengthSq() < 1e-6) bendAxis.set(1, 0, 0);
    var bend = (depth === 0 ? 0.05 : 0.15) * (Math.random() * 0.8 + 0.4);
    var endRadius = radius * (depth === 0 ? 0.6 : 0.72);
    var isTwig = depth >= 3;

    for (var i = 0; i < sub; i++) {
      d.applyAxisAngle(bendAxis, bend * (i / sub + 0.35));
      d.y += depth === 0 ? 0.015 : 0.075;          // 向上生长偏置
      d.normalize();

      var segLen = length / sub;
      var p2 = p.clone().addScaledVector(d, segLen);
      var ra = lerp(radius, endRadius, i / sub);
      var rb = lerp(radius, endRadius, (i + 1) / sub);
      addSegment(p, p2, ra, rb, isTwig ? store.twig : store.bark, depth);

      // 细枝中段也挂叶片锚点（让树冠更饱满）
      if (depth >= 4 && i === 0) {
        store.tips.push({ pos: p.clone().lerp(p2, 0.5), dir: d.clone(), r: rb });
      }
      p = p2;
    }

    if (depth >= MAX_DEPTH) {
      store.tips.push({ pos: p.clone(), dir: d.clone(), r: endRadius });
      return;
    }

    var n = CHILDREN[depth] || 2;
    for (var k = 0; k < n; k++) {
      var azim = (k / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.95 + depth * 0.75;
      var tilt = THREE.MathUtils.degToRad(40 + Math.random() * 26 - depth * 3.5);
      var childDir = rotateAway(d, azim, tilt);
      growBranch({
        start: p.clone().addScaledVector(d, -length * 0.07 * Math.random()),
        dir: childDir,
        length: length * (0.66 + Math.random() * 0.12),
        radius: endRadius * (depth === 0 ? 0.7 : 0.74),
        depth: depth + 1,
        store: store
      });
    }
  }

  // 生成一段「圆台」并按需写入合并缓冲
  function addSegment(p1, p2, rBottom, rTop, list, depth) {
    var dir = new THREE.Vector3().subVectors(p2, p1);
    var len = dir.length();
    if (len < 1e-4) return;

    var radial = depth === 0 ? 12 : (depth <= 2 ? 8 : 5);
    var geo = new THREE.CylinderGeometry(rTop, rBottom || rTop, len, radial, 1, true);

    // 统一树皮纹理密度（避免短枝把纹理压扁）
    var uv = geo.attributes.uv;
    for (var i = 0; i < uv.count; i++) {
      uv.setY(i, uv.getY(i) * Math.max(len * 0.85, 0.55));
    }

    var q = new THREE.Quaternion().setFromUnitVectors(
      UP, dir.clone().normalize()
    );
    var m = new THREE.Matrix4().compose(
      new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5),
      q, ONE
    );

    var g = geo.toNonIndexed();
    g.applyMatrix4(m);
    list.push(g);
  }

  var UP = new THREE.Vector3(0, 1, 0);
  var ONE = new THREE.Vector3(1, 1, 1);

  function rotateAway(axis, azimuth, tilt) {
    var a = axis.clone().normalize();
    var ref = Math.abs(a.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0);
    var u = new THREE.Vector3().crossVectors(a, ref).normalize();
    var v = new THREE.Vector3().crossVectors(a, u).normalize();
    return new THREE.Vector3()
      .addScaledVector(a, Math.cos(tilt))
      .addScaledVector(u, Math.sin(tilt) * Math.cos(azimuth))
      .addScaledVector(v, Math.sin(tilt) * Math.sin(azimuth))
      .normalize();
  }

  // 把一堆已变换到世界坐标的非索引几何合并成一个（省 draw call）
  function mergeGeoms(list) {
    var geo = new THREE.BufferGeometry();
    if (!list.length) return geo;
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i].attributes.position.count;

    var pos = new Float32Array(total * 3);
    var nor = new Float32Array(total * 3);
    var uv = new Float32Array(total * 2);
    var o = 0;
    for (i = 0; i < list.length; i++) {
      var g = list[i];
      var c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      uv.set(g.attributes.uv.array, o * 2);
      o += c;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }

  /* ================================================================== */
  /* 叶片：InstancedMesh + alphaTest 贴图                                 */
  /* ================================================================== */
  function buildLeaves(tips, tex, wind) {
    if (!tips.length) tips.push({ pos: new THREE.Vector3(0, 6, 0), dir: UP, r: 0.05 });

    // 手机端降低叶片密度，保证流畅
    var small = (window.innerWidth || 999) < 700;
    var perTip = small ? 7 : 12;
    var count = tips.length * perTip;

    var geo = new THREE.PlaneGeometry(0.23, 0.4);
    var mat = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.5, metalness: 0.0, color: 0xffffff
    });
    applyWind(mat, wind, false);

    var mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // 让阴影也按叶子轮廓裁剪，而不是整块方片
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.42
    });

    var m = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var s = new THREE.Vector3();
    var pos = new THREE.Vector3();
    var e = new THREE.Euler();
    var jitter = 0.4;
    var idx = 0;

    for (var i = 0; i < tips.length; i++) {
      var tip = tips[i];
      for (var k = 0; k < perTip; k++) {
        pos.copy(tip.pos)
          .addScaledVector(tip.dir, 0.04 + Math.random() * 0.16)
          .add(new THREE.Vector3(
            (Math.random() - 0.5) * jitter,
            (Math.random() - 0.5) * jitter,
            (Math.random() - 0.5) * jitter
          ));
        // 叶片略向下垂
        e.set(
          Math.PI * 0.5 + (Math.random() - 0.5) * 2.2,
          Math.random() * Math.PI * 2,
          (Math.random() - 0.5) * 1.2
        );
        q.setFromEuler(e);
        var sc = 0.7 + Math.random() * 0.75;
        s.set(sc, sc, sc);
        m.compose(pos, q, s);
        mesh.setMatrixAt(idx++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  /* ================================================================== */
  /* 枣果：少量点缀，实例颜色区分成熟度                                    */
  /* ================================================================== */
  function buildFruits(tips) {
    var geo = new THREE.SphereGeometry(0.11, 12, 10);
    geo.scale(1, 1.18, 1);
    var mat = new THREE.MeshStandardMaterial({
      roughness: 0.34, metalness: 0.0, color: 0xffffff
    });

    var n = Math.max(1, Math.round(tips.length * 0.3));
    var mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    var pool = tips.slice();
    shuffle(pool);
    var m = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var s = new THREE.Vector3();
    var pos = new THREE.Vector3();
    var e = new THREE.Euler();
    var col = new THREE.Color();

    for (var i = 0; i < n; i++) {
      var tip = pool[i % pool.length];
      pos.copy(tip.pos)
        .addScaledVector(tip.dir, 0.05)
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.34,
          -0.12 - Math.random() * 0.22,
          (Math.random() - 0.5) * 0.34
        ));
      e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      q.setFromEuler(e);
      var sc = 0.8 + Math.random() * 0.55;
      s.set(sc, sc, sc);
      m.compose(pos, q, s);
      mesh.setMatrixAt(i, m);

      // 成熟度：多数暗红，少量青枣
      if (Math.random() < 0.74) {
        col.setHSL(0.012 + Math.random() * 0.02, 0.62, 0.29 + Math.random() * 0.08);
      } else {
        col.setHSL(0.2, 0.5, 0.42 + Math.random() * 0.1);
      }
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  /* ================================================================== */
  /* 风动：顶点着色器注入                                                 */
  /* ================================================================== */
  function applyWind(mat, wind, isTwig) {
    var amp = isTwig ? 0.016 : 0.05;
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uWindTime = wind;
      shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vec3 wbase;',
          '#ifdef USE_INSTANCING',
          '  wbase = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
          '#else',
          '  wbase = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]) + transformed;',
          '#endif',
          'float wph = wbase.x * 0.5 + wbase.z * 0.62;',
          'float wamp = clamp(wbase.y - 2.4, 0.0, 7.5);',
          'transformed.x += sin(uWindTime * 1.25 + wph) * ' + amp.toFixed(3) + ' * wamp;',
          'transformed.z += cos(uWindTime * 1.05 + wph * 1.3) * ' +
          (amp * 0.8).toFixed(3) + ' * wamp;'
        ].join('\n')
      );
    };
    // 让不同风动参数的材质各自编译一份 program
    mat.customProgramCacheKey = function () {
      return isTwig ? 'tree-wind-twig' : 'tree-wind-leaf';
    };
  }

  /* ================================================================== */
  /* 纹理备份 / WebGL 上下文自愈（纯兜底，不改变外观）                      */
  /* ================================================================== */
  var textureBackups = [];

  function backupTexture(tex) {
    try {
      var img = tex && tex.image;
      if (!img || !img.getContext) return;
      var d = img.getContext('2d').getImageData(0, 0, img.width, img.height);
      textureBackups.push({ tex: tex, w: img.width, h: img.height, data: d });
    } catch (e) { /* 读不到就不备份，不影响正常渲染 */ }
  }

  // 用备份像素把纹理源重新画出来（putImageData 逐像素还原，与原来完全一致）
  function restoreTextures() {
    for (var i = 0; i < textureBackups.length; i++) {
      var b = textureBackups[i];
      var c = document.createElement('canvas');
      c.width = b.w; c.height = b.h;
      c.getContext('2d').putImageData(b.data, 0, 0);
      b.tex.image = c;
      b.tex.needsUpdate = true;
    }
  }

  // 叶子纹理中心本应是实心叶肉；若 alpha 为 0，说明源 canvas 被回收了
  function leafTextureEmpty(tex) {
    try {
      var img = tex && tex.image;
      if (!img || !img.getContext) return false;
      var p = img.getContext('2d').getImageData(
        (img.width / 2) | 0, (img.height / 2) | 0, 1, 1
      ).data;
      return p[3] === 0;
    } catch (e) { return false; }
  }

  /* ================================================================== */
  /* 程序化纹理                                                           */
  /* ================================================================== */
  function makeBarkTextures() {
    var w = 512, h = 512;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d', { willReadFrequently: true });

    x.fillStyle = '#8b7154';
    x.fillRect(0, 0, w, h);

    // 纵向木纹
    var i, px, wdt, shade, y, xx;
    for (i = 0; i < 300; i++) {
      px = Math.random() * w;
      wdt = 1 + Math.random() * 5;
      shade = Math.random();
      x.strokeStyle = shade < 0.52
        ? 'rgba(58,40,24,' + (0.08 + Math.random() * 0.22) + ')'
        : 'rgba(196,170,132,' + (0.05 + Math.random() * 0.16) + ')';
      x.lineWidth = wdt;
      x.beginPath();
      y = 0; xx = px;
      x.moveTo(xx, y);
      while (y < h) {
        y += 12 + Math.random() * 30;
        xx += (Math.random() - 0.5) * 10;
        x.lineTo(xx, y);
      }
      x.stroke();
    }

    // 树皮裂纹
    for (i = 0; i < 46; i++) {
      x.strokeStyle = 'rgba(38,24,13,' + (0.16 + Math.random() * 0.3) + ')';
      x.lineWidth = 1 + Math.random() * 2.2;
      x.beginPath();
      y = Math.random() * h;
      xx = Math.random() * w;
      x.moveTo(xx, y);
      for (var k = 0; k < 6; k++) {
        xx += (Math.random() - 0.5) * 42;
        y += 10 + Math.random() * 42;
        x.lineTo(xx, y);
      }
      x.stroke();
    }

    // 细噪点
    var img = x.getImageData(0, 0, w, h);
    var d = img.data;
    for (i = 0; i < d.length; i += 4) {
      var nn = (Math.random() - 0.5) * 26;
      d[i] += nn; d[i + 1] += nn; d[i + 2] += nn;
    }
    x.putImageData(img, 0, 0);

    var color = new THREE.CanvasTexture(c);
    color.colorSpace = THREE.SRGBColorSpace;
    color.wrapS = color.wrapT = THREE.RepeatWrapping;

    // 用同一画面转灰度做凹凸
    var bc = document.createElement('canvas');
    bc.width = w; bc.height = h;
    var bx = bc.getContext('2d', { willReadFrequently: true });
    bx.drawImage(c, 0, 0);
    var bimg = bx.getImageData(0, 0, w, h);
    var bd = bimg.data;
    for (i = 0; i < bd.length; i += 4) {
      var g = bd[i] * 0.3 + bd[i + 1] * 0.59 + bd[i + 2] * 0.11;
      bd[i] = bd[i + 1] = bd[i + 2] = g;
    }
    bx.putImageData(bimg, 0, 0);
    var bump = new THREE.CanvasTexture(bc);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;

    return { color: color, bump: bump };
  }

  function makeLeafTexture() {
    var s = 256;
    var c = document.createElement('canvas');
    c.width = s; c.height = s;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, s, s);

    x.save();
    x.translate(s / 2, s / 2);

    var L = s * 0.46, W = s * 0.2;
    var grad = x.createLinearGradient(-W, 0, W, 0);
    grad.addColorStop(0, '#3d6a29');
    grad.addColorStop(0.45, '#5c9740');
    grad.addColorStop(1, '#82b95c');

    x.fillStyle = grad;
    x.beginPath();
    x.moveTo(0, -L);
    x.bezierCurveTo(W, -L * 0.5, W * 0.95, L * 0.55, 0, L);
    x.bezierCurveTo(-W * 0.95, L * 0.55, -W, -L * 0.5, 0, -L);
    x.closePath();
    x.fill();

    // 主脉
    x.strokeStyle = 'rgba(28,58,18,0.5)';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(0, -L * 0.92);
    x.lineTo(0, L * 0.92);
    x.stroke();

    // 侧脉
    x.strokeStyle = 'rgba(28,58,18,0.26)';
    x.lineWidth = 1.6;
    for (var i = -4; i <= 4; i++) {
      var yy = i * L * 0.16;
      x.beginPath(); x.moveTo(0, yy); x.lineTo(W * 0.72, yy - 14); x.stroke();
      x.beginPath(); x.moveTo(0, yy); x.lineTo(-W * 0.72, yy - 14); x.stroke();
    }

    // 高光（枣叶油亮）
    x.globalAlpha = 0.22;
    x.fillStyle = '#eaffd0';
    x.beginPath();
    x.ellipse(-W * 0.25, -L * 0.22, W * 0.24, L * 0.34, -0.3, 0, Math.PI * 2);
    x.fill();
    x.restore();

    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (rendererAniso) tex.anisotropy = rendererAniso;
    return tex;
  }

  var rendererAniso = 0;

  function makeGroundTexture() {
    var s = 512;
    var c = document.createElement('canvas');
    c.width = s; c.height = s;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#6f7a4b';
    x.fillRect(0, 0, s, s);

    for (var i = 0; i < 4200; i++) {
      var r = Math.random() * 6 + 1.5;
      var g = Math.random();
      x.fillStyle = g < 0.5
        ? 'rgba(88,102,56,0.5)'
        : (g < 0.8 ? 'rgba(122,122,72,0.4)' : 'rgba(66,76,42,0.5)');
      x.beginPath();
      x.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
      x.fill();
    }

    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 8);
    if (rendererAniso) tex.anisotropy = rendererAniso;
    return tex;
  }

  /* ================================================================== */
  /* 相机控制：拖动旋转 + 缓慢自转（不劫持滚轮，保证页面可滚动）           */
  /* ================================================================== */
  function createControls(canvas, reduceMotion) {
    var az = 0.62, el = 0.24;
    var tAz = az, tEl = el;
    var dragging = false, moved = false;
    var lastX = 0, lastY = 0, idle = 10;   // 初始即允许自转
    var baseDist = 18;

    canvas.style.touchAction = 'pan-y';
    if (window.getComputedStyle(canvas).cursor === 'auto') {
      canvas.style.cursor = 'grab';
    }

    canvas.addEventListener('pointerdown', function (e) {
      dragging = true; moved = false; idle = 0;
      lastX = e.clientX; lastY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
      tAz -= dx * 0.005;
      tEl = clamp(tEl + dy * 0.004, 0.03, 1.05);
      idle = 0;
    });
    function endDrag() {
      dragging = false;
      canvas.classList.remove('grabbing');
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDrag);

    function update(dt) {
      idle += dt;
      // 未交互 1.2 秒后缓慢自转
      if (!reduceMotion && !dragging && idle > 1.2) tAz += dt * 0.05;
      az += (tAz - az) * Math.min(1, dt * 3.4);
      el += (tEl - el) * Math.min(1, dt * 3.4);
    }

    function apply(camera, focus) {
      var d = baseDist;
      var ce = Math.cos(el);
      camera.position.set(
        focus.x + Math.sin(az) * ce * d,
        focus.y + Math.sin(el) * d,
        focus.z + Math.cos(az) * ce * d
      );
      camera.lookAt(focus);
    }

    return {
      update: update, apply: apply,
      get baseDist() { return baseDist; },
      set baseDist(v) { baseDist = v; }
    };
  }

  /* ================================================================== */
  /* 小工具                                                              */
  /* ================================================================== */
  function lerp(a, b, t) { return a + (b - a) * t; }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ================================================================== */
  /* 启动（放在最后：确保上方所有模块级初始化已完成）                        */
  /* ================================================================== */
  try {
    init();
  } catch (err) {
    degrade(err && err.message ? err.message : String(err));
  }
})();
