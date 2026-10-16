/* =====================================================================
 * tree3d.js —— 首页开头「3D 院落：近 400 年大枣树 + 老北京四合院」
 * ---------------------------------------------------------------------
 * · 完全程序化生成：树干/枝条用递归算法生长；树皮、树叶、青砖、灰瓦、
 *   石作、垌地、格扇门窗、朱漆木构等纹理全部用 Canvas 现场绘制；
 *   叶片与枣果用 InstancedMesh，院落按材质合并，整场只占十余个 draw call。
 * · 院落：一进院（厢房、石桌石凳、水缸花盆）+ 隔墙与垂花门 +
 *   二进院（正房）。枣树就长在一进院与二进院之间。
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
    scene.fog = new THREE.Fog(0xf0e5cd, 44, 150);

    var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    var focus = new THREE.Vector3(0, 5.6, -4.0);

    /* ---------------- 光照：晴天，暖阳 + 冷天光 ---------------- */
    scene.add(new THREE.HemisphereLight(0xdcecff, 0x4a3a24, 1.05));

    var sun = new THREE.DirectionalLight(0xffe9c4, 2.65);
    sun.position.set(9, 21, 13);
    sun.castShadow = true;
    sun.shadow.mapSize.set(small ? 1024 : 3072, small ? 1024 : 3072);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    var SH = 24;
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

    /* ---------------- 院落（四合院：枣树位于一进院与二进院之间） ---------------- */
    treeGroup.position.set(-2.6, 0, -4.2);
    buildCourtyard(scene);

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
      // 按水平视野反推距离：保证约 30m 宽的院落都装进画面（竖屏自动拉远）
      var hf = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
      controls.baseDist = Math.max(26, Math.min(64, 15 / Math.tan(hf)));
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
      objects: scene.children.length,
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
    x.fillStyle = '#8a7c5f';
    x.fillRect(0, 0, s, s);

    for (var i = 0; i < 4200; i++) {
      var r = Math.random() * 6 + 1.5;
      var g = Math.random();
      x.fillStyle = g < 0.45
        ? 'rgba(120,106,78,0.45)'
        : (g < 0.82 ? 'rgba(154,140,109,0.4)' : 'rgba(96,104,62,0.42)');
      x.beginPath();
      x.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
      x.fill();
    }

    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 16);
    if (rendererAniso) tex.anisotropy = rendererAniso;
    return tex;
  }

  /* ================================================================== */
  /* 小工具：canvas / 纹理                                                */
  /* ================================================================== */
  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

  function tex(c, rx, ry) {
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (rx) t.repeat.set(rx, ry || rx);
    if (rendererAniso) t.anisotropy = rendererAniso;
    return t;
  }

  function addNoise(x, w, h, amt) {
    var img = x.getImageData(0, 0, w, h), d = img.data, i, n;
    for (i = 0; i < d.length; i += 4) {
      n = (Math.random() - 0.5) * amt;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
  }

  /* ================================================================== */
  /* 几何工具：世界坐标投影 UV + 统一摆放                                  */
  /* ================================================================== */
  function nidx(g) { return g && g.index ? g.toNonIndexed() : g; }
  function geoBox(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
  function geoCyl(rt, rb, h, seg) { return new THREE.CylinderGeometry(rt, rb, h, seg || 16); }
  function geoLathe(pts, seg) { return new THREE.LatheGeometry(pts, seg || 20); }

  // 用世界坐标重算 UV，保证所有材质纹理密度一致（每 scale 米重复一次）
  function projectUV(geo, scale) {
    var pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    if (!pos || !nor || !uv) return;
    var inv = 1 / scale, i, x, y, z, nx, ny, nz, u, v;
    for (i = 0; i < pos.count; i++) {
      x = pos.getX(i); y = pos.getY(i); z = pos.getZ(i);
      nx = Math.abs(nor.getX(i)); ny = Math.abs(nor.getY(i)); nz = Math.abs(nor.getZ(i));
      if (ny >= nx && ny >= nz) { u = x; v = z; }
      else if (nx >= nz) { u = z; v = y; }
      else { u = x; v = y; }
      uv.setXY(i, u * inv, v * inv);
    }
    uv.needsUpdate = true;
  }

  // 把纹理在水平方向重复 n 次（用于格扇门窗等“整块贴图”）
  function scaleU(geo, n) {
    var uv = geo.attributes.uv;
    if (!uv) return;
    for (var i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * n);
    uv.needsUpdate = true;
  }

  function mix(a, b) {
    var r = {}, k;
    for (k in a) r[k] = a[k];
    for (k in b) r[k] = b[k];
    return r;
  }

  /* 摆放顺序：先按自身中心旋转（坡度）→ 移到建筑局部坐标 →
   * 绕建筑中轴整体转向（ry）→ 平移到世界坐标 */
  function put(list, geo, o) {
    o = o || {};
    geo = nidx(geo);
    if (o.rx) geo.rotateX(o.rx);
    if (o.rz) geo.rotateZ(o.rz);
    if (o.x || o.y || o.z) geo.translate(o.x || 0, o.y || 0, o.z || 0);
    if (o.ry) geo.rotateY(o.ry);
    if (o.wx || o.wy || o.wz) geo.translate(o.wx || 0, o.wy || 0, o.wz || 0);
    if (o.uvw) scaleU(geo, o.uvw);
    else if (o.uv !== false) projectUV(geo, o.uv || 1);
    list.push(geo);
    return geo;
  }

  /* ================================================================== */
  /* 程序化纹理：青砖 / 灰瓦 / 石作 / 垌地 / 格扇 / 朱漆                   */
  /* ================================================================== */
  function makeBrickTexture() {                 // 一块贴图 ≈ 2m × 2m 墙面
    var w = 512, h = 512, c = newCanvas(w, h), x = ctx2d(c), r, b, i;
    x.fillStyle = '#9a9a92'; x.fillRect(0, 0, w, h);      // 灰缝
    var rows = 16, bh = h / rows, bw = w / 8;
    for (r = 0; r < rows; r++) {
      for (b = 0; b < 8; b++) {
        var g = 146 + (Math.random() - 0.5) * 34;
        var cool = (Math.random() - 0.5) * 7;
        x.fillStyle = 'rgb(' + Math.round(g - 5 + cool) + ',' + Math.round(g) +
          ',' + Math.round(g + 7 + cool * 0.5) + ')';
        x.fillRect(b * bw + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
    for (i = 0; i < 260; i++) {                  // 斑驳
      x.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '58,60,56,' : '206,204,193,') +
        (0.03 + Math.random() * 0.1) + ')';
      x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 4 + Math.random() * 28, 0, 6.2832); x.fill();
    }
    for (i = 0; i < 16; i++) {                   // 雨痕
      x.fillStyle = 'rgba(70,72,64,' + (0.04 + Math.random() * 0.09) + ')';
      x.fillRect(Math.random() * w, Math.random() * h * 0.6, 2 + Math.random() * 9, 60 + Math.random() * 190);
    }
    addNoise(x, w, h, 16);
    return tex(c);
  }

  function makeRoofTexture() {                   // 一块贴图 ≈ 1.2m × 1.2m 屋面
    var w = 512, h = 512, c = newCanvas(w, h), x = ctx2d(c), i, k;
    x.fillStyle = '#54555a'; x.fillRect(0, 0, w, h);
    var n = 6, sw = w / n;                       // 瓦垄：沿坡向（V）排列
    for (i = 0; i < n; i++) {
      var g = x.createLinearGradient(i * sw, 0, (i + 1) * sw, 0);
      g.addColorStop(0, '#404147'); g.addColorStop(0.3, '#6c6e75');
      g.addColorStop(0.5, '#7f828a'); g.addColorStop(0.74, '#5c5e65');
      g.addColorStop(1, '#3c3d43');
      x.fillStyle = g; x.fillRect(i * sw, 0, sw, h);
    }
    var rows = 5, rh = h / rows;                 // 瓦片搭接
    for (i = 1; i < rows; i++) {
      x.fillStyle = 'rgba(28,29,34,0.5)'; x.fillRect(0, i * rh - 2, w, 4);
      x.fillStyle = 'rgba(182,186,194,0.15)'; x.fillRect(0, i * rh + 2, w, 2);
    }
    for (k = 0; k < 420; k++) {
      x.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '20,20,24,' : '192,196,204,') +
        (0.02 + Math.random() * 0.08) + ')';
      x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 6, 0, 6.2832); x.fill();
    }
    addNoise(x, w, h, 14);
    return tex(c);
  }

  function makeStoneTexture() {                  // 一块贴图 ≈ 1m × 1m 石面
    var w = 512, h = 512, c = newCanvas(w, h), x = ctx2d(c), i, k;
    x.fillStyle = '#b2aea3'; x.fillRect(0, 0, w, h);
    for (i = 0; i < 9000; i++) {
      x.fillStyle = Math.random() < 0.5
        ? 'rgba(86,84,78,' + (0.05 + Math.random() * 0.24) + ')'
        : 'rgba(230,227,216,' + (0.05 + Math.random() * 0.3) + ')';
      x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2.6, 1 + Math.random() * 2.6);
    }
    for (k = 0; k < 12; k++) {                   // 石纹
      x.strokeStyle = 'rgba(118,114,104,' + (0.05 + Math.random() * 0.12) + ')';
      x.lineWidth = 0.6 + Math.random() * 1.9;
      var px = Math.random() * w, py = Math.random() * h;
      x.beginPath(); x.moveTo(px, py);
      for (i = 0; i < 7; i++) { px += (Math.random() - 0.5) * 150; py += (Math.random() - 0.5) * 150; x.lineTo(px, py); }
      x.stroke();
    }
    addNoise(x, w, h, 18);
    return tex(c);
  }

  function makePavingTexture() {                 // 一块贴图 ≈ 4.8m × 4.8m 垌地（6×6 块灰砖）
    var w = 512, h = 512, c = newCanvas(w, h), x = ctx2d(c), r, b, i;
    x.fillStyle = '#6c6a62'; x.fillRect(0, 0, w, h);
    var n = 6, s = w / n;
    for (r = 0; r < n; r++) {
      for (b = 0; b < n; b++) {
        var g = 136 + (Math.random() - 0.5) * 30;
        x.fillStyle = 'rgb(' + Math.round(g - 4) + ',' + Math.round(g) + ',' + Math.round(g + 5) + ')';
        x.fillRect(b * s + 2, r * s + 2, s - 4, s - 4);
      }
    }
    for (i = 0; i < 220; i++) {                  // 苔痕 / 污渍
      x.fillStyle = 'rgba(' + (Math.random() < 0.42 ? '84,94,60,' : '92,88,78,') +
        (0.04 + Math.random() * 0.12) + ')';
      x.beginPath(); x.arc(Math.random() * w, Math.random() * h, 3 + Math.random() * 22, 0, 6.2832); x.fill();
    }
    addNoise(x, w, h, 16);
    return tex(c, 5, 6);
  }

  function makeLatticeTexture() {                // 一扇格扇门窗（贴图按宽度重复使用）
    var w = 256, h = 512, c = newCanvas(w, h), x = ctx2d(c), i;
    var f = 11, lh = Math.round(h * 0.6);
    x.fillStyle = '#4b3221'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ece4cd'; x.fillRect(f, f, w - 2 * f, lh - 2 * f);   // 窗纸
    x.strokeStyle = '#55391f'; x.lineWidth = 3;
    var cols = 4, rows = 8;
    for (i = 1; i < cols; i++) {
      x.beginPath(); x.moveTo(f + i * (w - 2 * f) / cols, f);
      x.lineTo(f + i * (w - 2 * f) / cols, lh - f); x.stroke();
    }
    for (i = 1; i < rows; i++) {
      x.beginPath(); x.moveTo(f, f + i * (lh - 2 * f) / rows);
      x.lineTo(w - f, f + i * (lh - 2 * f) / rows); x.stroke();
    }
    x.fillStyle = '#4b3221'; x.fillRect(f, lh - f, w - 2 * f, 18);      // 横枨
    var sy = lh + 10;
    x.fillStyle = '#6a4630'; x.fillRect(f, sy, w - 2 * f, h - f - sy);  // 裙板
    x.strokeStyle = '#3d2718'; x.lineWidth = 4;
    x.strokeRect(f + 17, sy + 15, w - 2 * f - 34, h - f - sy - 30);
    addNoise(x, w, h, 10);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (rendererAniso) t.anisotropy = rendererAniso;
    return t;
  }

  function makeWoodTexture() {                   // 朱漆木构
    var w = 256, h = 256, c = newCanvas(w, h), x = ctx2d(c), i, px, y;
    x.fillStyle = '#8b3d2c'; x.fillRect(0, 0, w, h);
    for (i = 0; i < 170; i++) {
      x.strokeStyle = 'rgba(' + (Math.random() < 0.5 ? '58,21,14,' : '162,86,64,') +
        (0.04 + Math.random() * 0.14) + ')';
      x.lineWidth = 0.6 + Math.random() * 3;
      px = Math.random() * w; y = 0;
      x.beginPath(); x.moveTo(px, y);
      while (y < h) { y += 20 + Math.random() * 42; px += (Math.random() - 0.5) * 6; x.lineTo(px, y); }
      x.stroke();
    }
    addNoise(x, w, h, 12);
    return tex(c);
  }

  /* ================================================================== */
  /* 院落：老北京四合院（一进院 + 隔墙/垂花门 + 二进院），全部程序化 3D     */
  /* ================================================================== */
  function buildCourtyard(scene) {
    var texBrick = makeBrickTexture();
    var texTile = makeRoofTexture();
    var texStone = makeStoneTexture();
    var texPave = makePavingTexture();
    var texLattice = makeLatticeTexture();
    var texWood = makeWoodTexture();
    backupTexture(texBrick); backupTexture(texTile); backupTexture(texStone);
    backupTexture(texPave); backupTexture(texLattice); backupTexture(texWood);

    var matBrick = new THREE.MeshStandardMaterial({ map: texBrick, roughness: 0.95, metalness: 0 });
    var matTile = new THREE.MeshStandardMaterial({ map: texTile, roughness: 0.8, metalness: 0.02 });
    var matStone = new THREE.MeshStandardMaterial({ map: texStone, roughness: 0.9, metalness: 0 });
    var matLat = new THREE.MeshStandardMaterial({ map: texLattice, roughness: 0.85, metalness: 0 });
    var matWood = new THREE.MeshStandardMaterial({ map: texWood, roughness: 0.6, metalness: 0.02 });
    var matPaint = new THREE.MeshStandardMaterial({ color: 0x2f6b53, roughness: 0.62, metalness: 0.03 });
    var matGlaze = new THREE.MeshStandardMaterial({ color: 0x3d5044, roughness: 0.26, metalness: 0.08 });
    var matWater = new THREE.MeshStandardMaterial({ color: 0x2b4450, roughness: 0.08, metalness: 0.4 });
    var matFoliage = new THREE.MeshStandardMaterial({ color: 0x5c7a3c, roughness: 0.92, metalness: 0 });
    var matTrunk = new THREE.MeshStandardMaterial({ color: 0x6d5c46, roughness: 0.96, metalness: 0 });
    var matBgLeaf = new THREE.MeshStandardMaterial({ color: 0x54703a, roughness: 0.96, metalness: 0 });
    var matPave = new THREE.MeshStandardMaterial({ map: texPave, roughness: 1, metalness: 0 });

    var G = {
      brick: [], tile: [], stone: [], lattice: [], wood: [],
      paint: [], glaze: [], water: [], foliage: [], trunk: [], bgLeaf: []
    };

    /* ---------------- 垌地（灰砖墁地，覆盖一进院 + 二进院） ---------------- */
    var pave = new THREE.Mesh(new THREE.PlaneGeometry(24, 29), matPave);
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(0, 0.004, -5.5);
    pave.receiveShadow = true;
    scene.add(pave);

    /* ---------------- 石板路：南门 → 垂花门 ---------------- */
    put(G.stone, geoBox(1.9, 0.06, 18.4), { y: 0.03, wx: 3.4, wz: -0.5, uv: 1.1 });

    /* ---------------- 院墙 ---------------- */
    var WH = 2.8, WT = 0.42;

    function capX(x0, x1, z, h, t) {
      var halfW = t / 2 + 0.16, rise = 0.16, len = x1 - x0;
      var ang = Math.atan2(rise, halfW), sl = Math.sqrt(halfW * halfW + rise * rise);
      put(G.tile, geoBox(len, 0.1, sl), { x: (x0 + x1) / 2, y: h + rise / 2, z: z + halfW / 2, rx: ang, uv: 1.2 });
      put(G.tile, geoBox(len, 0.1, sl), { x: (x0 + x1) / 2, y: h + rise / 2, z: z - halfW / 2, rx: -ang, uv: 1.2 });
    }

    function wallX(x0, x1, z, h, t, gap) {
      var segs = gap ? [[x0, gap.c - gap.w / 2], [gap.c + gap.w / 2, x1]] : [[x0, x1]];
      var i, a, b;
      for (i = 0; i < segs.length; i++) {
        a = segs[i][0]; b = segs[i][1];
        if (b - a < 0.05) continue;
        put(G.brick, geoBox(b - a, h, t), { x: (a + b) / 2, y: h / 2, z: z, uv: 2 });
      }
      if (gap) {
        put(G.brick, geoBox(gap.w, h - gap.h, t),
          { x: gap.c, y: gap.h + (h - gap.h) / 2, z: z, uv: 2 });
        put(G.wood, geoBox(gap.w + 0.24, 0.18, t + 0.08),   // 木过梁
          { x: gap.c, y: gap.h - 0.09, z: z, uv: 1 });
      }
      capX(x0, x1, z, h, t);
    }

    function wallZ(z0, z1, x, h, t) {
      var halfW = t / 2 + 0.16, rise = 0.16, len = z1 - z0;
      var ang = Math.atan2(rise, halfW), sl = Math.sqrt(halfW * halfW + rise * rise);
      var cz = (z0 + z1) / 2;
      put(G.brick, geoBox(t, h, len), { x: x, y: h / 2, z: cz, uv: 2 });
      put(G.tile, geoBox(sl, 0.1, len), { x: x + halfW / 2, y: h + rise / 2, z: cz, rz: -ang, uv: 1.2 });
      put(G.tile, geoBox(sl, 0.1, len), { x: x - halfW / 2, y: h + rise / 2, z: cz, rz: ang, uv: 1.2 });
    }

    wallX(-12, 12, 8.5, 2.2, WT, { c: 3.4, w: 2.6, h: 2.0 });      // 南墙（较低）+ 门洞
    wallX(-9.5, 9.5, -9.5, WH, WT, { c: 3.4, w: 2.8, h: 2.4 });   // 隔墙 + 垂花门（一进院/二进院之界）
    wallX(-12, 12, -20, WH, WT, null);                            // 北墙
    wallZ(4.6, 8.5, -12, 2.2, WT); wallZ(4.6, 8.5, 12, 2.2, WT);  // 一进院南侧补墙
    wallZ(-20, -9.5, -12, WH, WT); wallZ(-20, -9.5, 12, WH, WT);  // 二进院侧墙

    /* ---------------- 屋面 / 山墙 ---------------- */
    function addRoof(L, D, E, R, og, gg, W) {
      var halfW = D / 2 + og, rise = R - E;
      var ang = Math.atan2(rise, halfW), sl = Math.sqrt(halfW * halfW + rise * rise);
      var len = L + 2 * gg;
      put(G.tile, geoBox(len, 0.17, sl), mix({ y: (E + R) / 2 + 0.05, z: halfW / 2, rx: ang, uv: 1.2 }, W));
      put(G.tile, geoBox(len, 0.17, sl), mix({ y: (E + R) / 2 + 0.05, z: -halfW / 2, rx: -ang, uv: 1.2 }, W));
      put(G.tile, geoBox(len + 0.14, 0.2, 0.46), mix({ y: R + 0.12, uv: 1.2 }, W));   // 正脊
      put(G.tile, geoBox(len, 0.16, 0.1), mix({ y: E + 0.03, z: halfW, uv: 1.2 }, W));   // 檐口
      put(G.tile, geoBox(len, 0.16, 0.1), mix({ y: E + 0.03, z: -halfW, uv: 1.2 }, W));
    }

    function gableGeo(D, E, R, T) {
      var s = new THREE.Shape();
      s.moveTo(-D / 2, E); s.lineTo(D / 2, E); s.lineTo(0, R); s.closePath();
      var g = nidx(new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false }));
      g.translate(0, 0, -T / 2);
      g.rotateY(Math.PI / 2);          // 挤出轴 → X；shape-x → Z（对称）
      return g;
    }

    /* ---------------- 房屋（硬山、前出廊檐柱、格扇门窗） ---------------- */
    function addHall(c) {
      var L = c.len, D = c.dep, E = c.eave, R = c.ridge;
      var deck = c.deck || 0, i, cx;
      var W = { wx: c.x, wz: c.z, ry: c.ry || 0 };

      put(G.stone, geoBox(L + 0.8, deck, D + 0.8), mix({ y: deck / 2, uv: 1.1 }, W));   // 台基
      if (deck > 0.25)
        put(G.stone, geoBox(3.6, 0.16, 0.7), mix({ y: 0.08, z: D / 2 + 0.78, uv: 1.1 }, W));  // 踏跺

      put(G.brick, geoBox(L, E - deck, D), mix({ y: deck + (E - deck) / 2, uv: 2 }, W));  // 墙体

      var ph = (E - deck) * 0.68, pw = L * 0.86;                                       // 格扇
      put(G.lattice, geoBox(pw, ph, 0.1),
        mix({ y: deck + ph / 2 + 0.16, z: D / 2 + 0.03, uvw: Math.max(2, Math.round(pw / (ph * 0.44))) }, W));

      var nCol = Math.max(4, Math.round(L / 3.4));                                      // 檐柱
      for (i = 0; i < nCol; i++) {
        cx = -L / 2 + 0.4 + i * ((L - 0.8) / (nCol - 1));
        put(G.wood, geoCyl(0.1, 0.115, E - deck, 12),
          mix({ x: cx, y: deck + (E - deck) / 2, z: D / 2 + 0.2, uv: 1 }, W));
      }
      put(G.wood, geoBox(L, 0.22, 0.24), mix({ y: E - 0.28, z: D / 2 + 0.2, uv: 1 }, W));  // 檐枋

      var gt = gableGeo(D, E, R, 0.36);                                                // 山墙
      put(G.brick, gt.clone(), mix({ x: L / 2, uv: 2 }, W));   // 注意：克隆未变换的那份
      put(G.brick, gt, mix({ x: -L / 2, uv: 2 }, W));

      addRoof(L, D, E, R, c.og == null ? 0.55 : c.og, 0.2, W);
    }

    addHall({ x: -11.2, z: -2.4, len: 14, dep: 3.4, eave: 3.1, ridge: 4.8, deck: 0.2, ry: Math.PI / 2 });  // 西厢房
    addHall({ x: 11.2, z: -2.4, len: 14, dep: 3.4, eave: 3.1, ridge: 4.8, deck: 0.2, ry: -Math.PI / 2 });  // 东厢房
    addHall({ x: 0, z: -17, len: 14, dep: 4.5, eave: 3.3, ridge: 5.6, deck: 0.34 });                       // 二进院正房

    /* ---------------- 垂花门（隔墙上的院门） ---------------- */
    var gx = 3.4, gz = -9.5;
    put(G.wood, geoCyl(0.12, 0.13, 2.9, 14), { x: gx - 1.2, y: 1.45, z: gz, uv: 1 });
    put(G.wood, geoCyl(0.12, 0.13, 2.9, 14), { x: gx + 1.2, y: 1.45, z: gz, uv: 1 });
    put(G.paint, geoBox(2.7, 0.34, 0.3), { x: gx, y: 2.62, z: gz, uv: 1 });          // 额枋（彩画）
    put(G.wood, geoBox(3.0, 0.13, 0.34), { x: gx, y: 2.86, z: gz, uv: 1 });
    addRoof(3.5, 2.3, 3.05, 3.95, 0.42, 0.22, { wx: gx, wz: gz });                  // 门屋面
    put(G.wood, geoCyl(0.09, 0.09, 0.42, 10), { x: gx - 1.52, y: 2.66, z: gz + 1.0, uv: 1 });  // 垂柱
    put(G.wood, new THREE.SphereGeometry(0.13, 10, 8), { x: gx - 1.52, y: 2.4, z: gz + 1.0, uv: 1 });
    put(G.wood, geoCyl(0.09, 0.09, 0.42, 10), { x: gx + 1.52, y: 2.66, z: gz + 1.0, uv: 1 });
    put(G.wood, new THREE.SphereGeometry(0.13, 10, 8), { x: gx + 1.52, y: 2.4, z: gz + 1.0, uv: 1 });
    put(G.stone, geoBox(3.0, 0.14, 0.85), { x: gx, y: 0.07, z: gz + 1.4, uv: 1.1 }); // 门踏跺

    /* ---------------- 石桌石凳（枣树下） ---------------- */
    var tx = 0.4, tz = -2.2, s, a, sx, sz;
    put(G.stone, geoCyl(0.68, 0.68, 0.1, 24), { y: 0.76, wx: tx, wz: tz, uv: 1 });
    put(G.stone, geoCyl(0.17, 0.21, 0.66, 16), { y: 0.4, wx: tx, wz: tz, uv: 1 });
    put(G.stone, geoCyl(0.4, 0.46, 0.12, 20), { y: 0.06, wx: tx, wz: tz, uv: 1 });
    for (s = 0; s < 4; s++) {
      a = Math.PI / 4 + s * Math.PI / 2;
      sx = tx + Math.cos(a) * 1.35; sz = tz + Math.sin(a) * 1.35;
      put(G.stone, geoCyl(0.25, 0.29, 0.42, 16), { y: 0.21, wx: sx, wz: sz, uv: 1 });
      put(G.stone, geoCyl(0.28, 0.28, 0.06, 18), { y: 0.44, wx: sx, wz: sz, uv: 1 });
    }

    /* ---------------- 水缸（防火） + 花盆 ---------------- */
    var jarProf = [
      new THREE.Vector2(0.05, 0), new THREE.Vector2(0.36, 0.02), new THREE.Vector2(0.42, 0.12),
      new THREE.Vector2(0.53, 0.3), new THREE.Vector2(0.6, 0.5), new THREE.Vector2(0.58, 0.68),
      new THREE.Vector2(0.52, 0.82), new THREE.Vector2(0.5, 0.92), new THREE.Vector2(0.52, 0.95)
    ];
    put(G.glaze, geoLathe(jarProf, 24), { wx: 7.2, wz: -5.4, uv: 1 });
    put(G.water, geoCyl(0.47, 0.47, 0.02, 22), { y: 0.86, wx: 7.2, wz: -5.4, uv: 1 });

    function putPot(px, pz) {
      put(G.glaze, geoLathe([
        new THREE.Vector2(0.04, 0), new THREE.Vector2(0.17, 0.02), new THREE.Vector2(0.22, 0.1),
        new THREE.Vector2(0.28, 0.3), new THREE.Vector2(0.31, 0.42), new THREE.Vector2(0.35, 0.46),
        new THREE.Vector2(0.33, 0.5), new THREE.Vector2(0.29, 0.5)
      ], 18), { x: px, z: pz, uv: 1 });
    }
    putPot(1.5, -8.4); putPot(5.3, -8.4);      // 垂花门两侧

    /* ---------------- 绿植（花盆 + 墙角） ---------------- */
    function blob(r) {
      var g = nidx(new THREE.IcosahedronGeometry(r, 1));
      var p = g.attributes.position, i, vx, vy, vz, k;
      for (i = 0; i < p.count; i++) {
        vx = p.getX(i); vy = p.getY(i); vz = p.getZ(i);
        k = 1 + (Math.random() - 0.5) * 0.34;
        p.setXYZ(i, vx * k, vy * k * 0.82, vz * k);
      }
      g.computeVertexNormals();
      return g;
    }
    put(G.foliage, blob(0.34), { x: 1.5, y: 0.66, z: -8.4, uv: 1 });
    put(G.foliage, blob(0.34), { x: 5.3, y: 0.66, z: -8.4, uv: 1 });
    put(G.foliage, blob(0.55), { x: -8.4, y: 0.5, z: -8.4, uv: 1 });
    put(G.foliage, blob(0.5), { x: 8.2, y: 0.45, z: -8.2, uv: 1 });

    /* ---------------- 院外环境：零星杂树（填远景，不抢主体） ---------------- */
    var bgSpots = [
      [-30, 7, 11], [-23, -17, 9], [-35, -31, 12], [-17, 27, 10], [7, 31, 9],
      [27, 21, 11], [35, -5, 10], [23, -29, 12], [-7, -35, 11], [13, -37, 9],
      [34, -33, 10], [-31, 23, 9], [-41, -8, 10], [41, -18, 11]
    ];
    for (var bi = 0; bi < bgSpots.length; bi++) {
      var bh = bgSpots[bi][2], bz2 = bgSpots[bi][1], bx2 = bgSpots[bi][0];
      var th = bh * 0.42, tr = 0.2 + Math.random() * 0.09;
      put(G.trunk, geoCyl(tr, tr * 1.6, th, 8), { x: bx2, y: th / 2, z: bz2, uv: 1.4 });
      var bn = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (var k2 = 0; k2 < bn; k2++) {
        put(G.bgLeaf, blob(bh * 0.17), {
          x: bx2 + (Math.random() - 0.5) * bh * 0.15,
          y: th + bh * 0.2 + k2 * bh * 0.15 + Math.random() * bh * 0.04,
          z: bz2 + (Math.random() - 0.5) * bh * 0.15, uv: 1
        });
      }
    }

    /* ---------------- 合并渲染 ---------------- */
    function merged(list, mat, cast) {
      if (!list.length) return null;
      var m = new THREE.Mesh(mergeGeoms(list), mat);
      m.castShadow = cast !== false;
      m.receiveShadow = true;
      scene.add(m);
      return m;
    }
    merged(G.brick, matBrick);
    merged(G.tile, matTile);
    merged(G.stone, matStone);
    merged(G.lattice, matLat);
    merged(G.wood, matWood);
    merged(G.paint, matPaint);
    merged(G.glaze, matGlaze);
    merged(G.water, matWater, false);
    merged(G.foliage, matFoliage);
    merged(G.trunk, matTrunk, false);      // 院外杂树不投影（在阴影相机范围外）
    merged(G.bgLeaf, matBgLeaf, false);
  }

  /* ================================================================== */
  /* 相机控制：拖动旋转 + 缓慢自转（不劫持滚轮，保证页面可滚动）           */
  /* ================================================================== */
  function createControls(canvas, reduceMotion) {
    var az = 0.62, el = 0.30;
    var tAz = az, tEl = el;
    var dragging = false, moved = false;
    var lastX = 0, lastY = 0, idle = 10;   // 初始即允许自转
    var baseDist = 27;

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
