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

  /* 固定随机种子：每次加载生成的树形/院落完全一致，便于演示与录屏 */
  var _seed = 20261019;
  function rnd() {
    _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
    var t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

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
    scene.fog = new THREE.Fog(0x120d08, 44, 150);

    var camera = new THREE.PerspectiveCamera(52, 1, 0.08, 220);
    var focus = new THREE.Vector3(0, 6.3, -4.0);

    /* ---------------- 光照：晴天，暖阳 + 冷天光 ---------------- */
    var hemi = new THREE.HemisphereLight(0xdcecff, 0x4a3a24, 1.05);
    scene.add(hemi);

    var sun = new THREE.DirectionalLight(0xffe9c4, 2.65);
    sun.position.set(9, 21, 13);
    sun.castShadow = true;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
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
    var amb = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(amb);

    /* ---------------- 程序化纹理 ---------------- */
    var detail = window.NIANLUN_MODULES.courtyardDetail;
    var bark = detail.barkTextures(function(maps){backupTexture(maps.color);backupTexture(maps.bump);});
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

    // Twin, asymmetric trunks follow the team's P300 field photograph.
    var leftTrunk = addCurvedBranch([
      new THREE.Vector3(0,-0.07,0),new THREE.Vector3(-.17,.8,.03),
      new THREE.Vector3(-.13,1.8,.1),new THREE.Vector3(-.22,2.9,.15),
      new THREE.Vector3(-.18,3.75,.08),new THREE.Vector3(-.28,4.3,.1)
    ],.76,.34,store.bark,0);
    var rightTrunk = addCurvedBranch([
      new THREE.Vector3(.15,.05,0),new THREE.Vector3(.45,.9,.04),
      new THREE.Vector3(.95,1.8,.02),new THREE.Vector3(1.5,2.45,-.05),
      new THREE.Vector3(1.75,3.2,.02),new THREE.Vector3(1.85,3.95,-.03)
    ],.5,.24,store.bark,0);
    growBranch({start:leftTrunk.getPointAt(.975),dir:leftTrunk.getTangentAt(1),
      length:2.45,radius:.35,depth:1,store:store});
    growBranch({start:rightTrunk.getPointAt(.975),dir:rightTrunk.getTangentAt(1),
      length:2.35,radius:.26,depth:1,store:store});
    // Low lateral boughs make the silhouette broad rather than conical.
    growBranch({start:new THREE.Vector3(-.2,3.0,.15),dir:new THREE.Vector3(-.85,.7,-.1).normalize(),
      length:2.45,radius:.22,depth:2,store:store});
    growBranch({start:new THREE.Vector3(1.7,3.12,.03),dir:new THREE.Vector3(.8,.65,.35).normalize(),
      length:2.2,radius:.19,depth:2,store:store});

    var barkMat = new THREE.MeshStandardMaterial({
      map: bark.color, bumpMap: bark.bump, bumpScale: 0.045,
      color: 0xf0ede5, roughness: 0.94, metalness: 0.0
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
    // Woody branches stay attached; wind is confined to flexible leaves.
    treeGroup.add(twigMesh);

    /* ---------------- 叶片 ---------------- */
    var leaves = buildLeaves(store.tips, leafTex, wind);
    treeGroup.add(leaves);

    /* ---------------- 枣果 ---------------- */
    var fruits = buildFruits(store.tips);
    treeGroup.add(fruits);

    // Roots taper below soil instead of ending as constant-width pipes.
    var roots=[];
    for(var ri=0;ri<9;ri++){
      var ra=ri/9*Math.PI*2,reach=1.3+(ri%3)*.17;
      addCurvedBranch([
        new THREE.Vector3(Math.cos(ra)*.36,.42,Math.sin(ra)*.36),
        new THREE.Vector3(Math.cos(ra)*.79,.17,Math.sin(ra)*.79),
        new THREE.Vector3(Math.cos(ra)*reach,-.06,Math.sin(ra)*reach)
      ],.20,.012,roots,1);
    }
    var rootMesh=new THREE.Mesh(mergeGeoms(roots),barkMat);
    roots.forEach(function(g){g.dispose();});rootMesh.castShadow=rootMesh.receiveShadow=true;treeGroup.add(rootMesh);
    detail.supports(treeGroup);
    detail.treeBed(treeGroup);
    var edgingMat=new THREE.MeshStandardMaterial({color:0x9b9989,roughness:0.96});
    [[4.9,0.12,0.13,0,2.2],[4.9,0.12,0.13,0,-2.2],[0.13,0.12,4.4,2.4,0],[0.13,0.12,4.4,-2.4,0]].forEach(function(v){
      var m=new THREE.Mesh(new THREE.BoxGeometry(v[0],v[1],v[2]),edgingMat);m.position.set(v[3],0.06,v[4]);m.receiveShadow=true;treeGroup.add(m);
    });
    scene.add(treeGroup);

    /* ---------------- 院落（四合院：枣树位于一进院与二进院之间） ---------------- */
    treeGroup.position.set(-2.6, 0, -4.2);
    buildCourtyard(scene);
    detail.plants(scene,wind,small);
    detail.sky(scene,wind);

    // 灰砖铺地与完整院界统一由 buildCourtyard 创建。移除院外的土色圆盘。
    // 保留前面的旧纹理生成调用，使古枣树的固定随机种子序列保持一致。
    canvas.dataset.architecture = 'courtyard-joined-branches-20261021';

    /* 院内探索与树干拾取；古枣树始终保持完整。 */
    var rings = null, controls = null;
    function askTree() {
      if (window.NIANLUN_AGENT && window.NIANLUN_AGENT.openWith) {
        window.NIANLUN_AGENT.openWith('这棵枣树的树龄和来历有哪些资料依据？',
          { eraId: 'qingchu', object: '庭院中的古枣树' });
      }
    }
    // One CSS-pixel snapshot gives blocked view changes a true dissolve, without a second 3D render loop.
    var viewSnapshot = document.createElement('canvas');
    viewSnapshot.className = 'scene-view-snapshot'; viewSnapshot.hidden = true;
    viewSnapshot.setAttribute('aria-hidden', 'true');
    canvas.insertAdjacentElement('afterend', viewSnapshot);
    var viewBuffer = document.createElement('canvas');
    function captureView() {
      var heldOpacity = viewSnapshot.hidden ? 0 : Number(viewSnapshot.style.opacity);
      if (heldOpacity > 0) {
        viewBuffer.width = viewSnapshot.width; viewBuffer.height = viewSnapshot.height;
        viewBuffer.getContext('2d').drawImage(viewSnapshot, 0, 0);
      }
      viewSnapshot.width = Math.max(1, section.clientWidth);
      viewSnapshot.height = Math.max(1, section.clientHeight);
      renderer.render(scene, camera);
      var context = viewSnapshot.getContext('2d', { alpha: false });
      context.drawImage(canvas, 0, 0, viewSnapshot.width, viewSnapshot.height);
      if (heldOpacity > 0) {
        context.globalAlpha = heldOpacity;
        context.drawImage(viewBuffer, 0, 0, viewSnapshot.width, viewSnapshot.height);
        context.globalAlpha = 1; viewBuffer.width = viewBuffer.height = 1;
      }
      viewSnapshot.style.opacity = '1'; viewSnapshot.hidden = false;
    }
    function blendView(progress) {
      viewSnapshot.hidden = progress >= 1;
      viewSnapshot.style.opacity = String(1 - progress);
    }
    var interaction = window.NIANLUN_MODULES.createInteraction({
      THREE: THREE, camera: camera, canvas: canvas, reducedMotion: reduceMotion,
      obstacles: detail.obstacles(), treeView: detail.layout.treeView,
      targets: [{ object: barkMesh, id: 'tree', label: '古枣树' }],
      callbacks: {
        onCapture: captureView,
        onBlend: blendView,
        onSelect: askTree,
        onState: function (state) {
          var label = document.getElementById('sceneLocation');
          if (label) label.textContent = state.location;
          document.querySelectorAll('[data-view]').forEach(function (b) {
            b.setAttribute('aria-pressed', String(state.walking ? b.dataset.view !== 'overview' && b.textContent.trim() === state.location : b.dataset.view === 'overview'));
          });
        }
      }
    });
    document.getElementById('sceneAsk').addEventListener('click', askTree);
    var motionPaused = reduceMotion;
    var motionButton = document.getElementById('sceneMotion');
    function syncMotion() {
      motionButton.textContent = motionPaused ? '开启风动' : '暂停风动';
      motionButton.setAttribute('aria-pressed', String(!motionPaused));
    }
    motionButton.addEventListener('click', function () { motionPaused = !motionPaused; syncMotion(); });
    syncMotion();
    var hotspot = document.getElementById('treeHotspot');
    hotspot.addEventListener('click', askTree);
    var hotspotWorld = new THREE.Vector3(-2.6, 2.6, -4.2), projected = new THREE.Vector3();

    /* ---------------- 院落导航牌：贴在建筑 / 门 / 石桌上的三个入口 ----------------
     * 每块牌子在 DOM 里是一个普通链接，data-pos 写世界坐标；
     * 每帧投影到屏幕上跟随建筑。转到背面、被开场文字卡压住、
     * 或和右下角的行走方向键撞上时，自动收起。 */
    var plaques = [];
    Array.prototype.forEach.call(section.querySelectorAll('.scene-plaque[data-pos]'), function (el) {
      var v = el.getAttribute('data-pos').split(',').map(Number);
      if (v.length === 3 && isFinite(v[0]) && isFinite(v[1]) && isFinite(v[2])) {
        plaques.push({ el: el, world: new THREE.Vector3(v[0], v[1], v[2]), w: 118, h: 33, on: null });
      }
    });
    function measurePlaques() {
      for (var i = 0; i < plaques.length; i++) {
        var el = plaques[i].el;
        if (el.offsetWidth) plaques[i].w = el.offsetWidth;
        if (el.offsetHeight) plaques[i].h = el.offsetHeight;
      }
    }
    measurePlaques();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(measurePlaques).catch(function () { });
    }

    var avoidSelectors = ['.opening-inner', '.scene-tools', '.scene-walk', '.scene-exit', '.scene-caption'];
    var avoidRects = [];
    function refreshAvoid() {
      avoidRects = [];
      for (var i = 0; i < avoidSelectors.length; i++) {
        var el = section.querySelector(avoidSelectors[i]);
        if (!el || el.offsetParent === null) continue;
        var r = el.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) avoidRects.push(r);
      }
    }
    var plaqueProjected = new THREE.Vector3(), plaqueTick = 0;
    function updatePlaques() {
      if (!plaques.length) return;
      if (plaqueTick % 30 === 0) { refreshAvoid(); measurePlaques(); }
      plaqueTick++;
      var w = section.clientWidth, h = section.clientHeight;
      var sr = section.getBoundingClientRect();
      for (var i = 0; i < plaques.length; i++) {
        var item = plaques[i];
        plaqueProjected.copy(item.world).project(camera);
        var on = plaqueProjected.z > -1 && plaqueProjected.z < 1 &&
          Math.abs(plaqueProjected.x) < 0.98 && Math.abs(plaqueProjected.y) < 0.96;
        var x = (plaqueProjected.x * 0.5 + 0.5) * w;
        var y = (-plaqueProjected.y * 0.5 + 0.5) * h;
        if (on && avoidRects.length) {
          var px = sr.left + x, py = sr.top + y;
          var hw = item.w / 2 + 6, hh = item.h / 2 + 6;
          for (var k = 0; k < avoidRects.length; k++) {
            var a = avoidRects[k];
            if (px + hw > a.left && px - hw < a.right && py + hh > a.top && py - hh < a.bottom) { on = false; break; }
          }
        }
        item.el.style.left = x + 'px';
        item.el.style.top = y + 'px';
        if (on !== item.on) {
          item.on = on;
          item.el.classList.toggle('is-shown', on);
        }
      }
    }
    // 点牌子进站时，先记一个标记，让目标页沿用现有的淡入过渡
    Array.prototype.forEach.call(section.querySelectorAll('.scene-plaque'), function (el) {
      el.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        try { sessionStorage.setItem('nav3d', '1'); } catch (err) { }
      });
    });

    /* ---------------- M03 集成补丁：氛围模块（无模块时行为完全不变） --------------
     * ?camfix=az,el,dist  固定机位（同机位对比/录屏用）
     * ?atmo=off           创建后立即 dispose，恢复原始光照（before 对照）
     * ?quality=low|medium|high  质量档位（默认窄屏 low，其余 high）
     * ?perf=1             帧率/draw calls 探针（由氛围模块绘制 HUD） */
    var camfixM = /[?&]camfix=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/.exec(location.search);
    if (camfixM && controls) controls.fix(+camfixM[1], +camfixM[2], +camfixM[3]);
    var atmo = null;
    if (window.NIANLUN_MODULES && window.NIANLUN_MODULES.createAtmosphere) {
      var qM = /[?&]quality=(low|medium|high)/.exec(location.search);
      atmo = window.NIANLUN_MODULES.createAtmosphere({
        THREE: THREE, scene: scene, renderer: renderer,
        anchors: null, materialSlots: null,          // 灰盒阶段：模块自动发现光照槽位
        quality: qM ? qM[1] : (small ? 'low' : 'high'),
        reducedMotion: reduceMotion,
        perfHud: /[?&]perf=1/.test(location.search)
      });
      if (/[?&]atmo=off/.test(location.search)) { atmo.dispose(); atmo = null; }
    }

    function headerSize() {
      var header=document.getElementById('topbar');
      document.documentElement.style.setProperty('--site-header',(header ? header.getBoundingClientRect().height : 60)+'px');
    }
    if ('ResizeObserver' in window) new ResizeObserver(headerSize).observe(document.getElementById('topbar'));
    headerSize();
    /* ---------------- 尺寸自适应 ---------------- */
    function resize() {
      var w = section.clientWidth || window.innerWidth;
      var h = section.clientHeight || Math.round(window.innerHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      // 轨道相机（降级路径）按水平视野反推距离；M04 滚轮镜头不依赖 baseDist
      if (controls) {
        var hf = Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
        controls.baseDist = Math.max(26, Math.min(64, 15 / Math.tan(hf)));
      }
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
      var elapsed = clock.getDelta(), dt = Math.min(elapsed, 0.05);
      if (!motionPaused) wind.value += dt;
      if (interaction) {
        interaction.update(dt, elapsed);
      } else if (controls) {
        controls.update(dt);
        controls.apply(camera, focus);
      }
      if (atmo && !motionPaused) atmo.update(dt);
      updatePlaques();
      projected.copy(hotspotWorld).project(camera);
      var showHotspot = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 0.9 && Math.abs(projected.y) < 0.85;
      hotspot.hidden = !showHotspot;
      if (showHotspot) {
        hotspot.style.left = ((projected.x * 0.5 + 0.5) * 100) + '%';
        hotspot.style.top = ((-projected.y * 0.5 + 0.5) * 100) + '%';
      }
      if (atmo && atmo.renderFrame) atmo.renderFrame(dt);
      else renderer.render(scene, camera);
      if (sceneActive && !document.hidden && !contextLost) frameId = requestAnimationFrame(frame);
      else frameId = null;
    }
    var sceneActive = true, contextLost = false, frameId = requestAnimationFrame(frame);
    function resume() {
      if (sceneActive && !document.hidden && !contextLost && frameId === null) { clock.getDelta(); frameId = requestAnimationFrame(frame); }
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { sceneActive = entries[0].isIntersecting; resume(); }).observe(section);
    }
    document.addEventListener('visibilitychange', resume);

    // WebGL 上下文丢失/恢复：自动用备份重建纹理，避免树叶等消失（不影响外观）
    canvas.addEventListener('webglcontextlost', function (e) {
      if (e && e.preventDefault) e.preventDefault(); contextLost = true;
    }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      restoreTextures(); contextLost = false; resume();
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
      restore: restoreTextures, backups: textureBackups.length,
      atmosphere: atmo,
      interaction: interaction, rings: rings
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

    var sub = depth === 0 ? 10 : (depth === 1 ? 5 : 2);
    var p = start.clone();
    var pathPoints = [p.clone()];
    var d = dir.clone().normalize();

    // 每根枝的随机弯曲轴向
    var bendAxis = new THREE.Vector3(
      rnd() - 0.5, rnd() - 0.5, rnd() - 0.5
    ).normalize();
    if (bendAxis.lengthSq() < 1e-6) bendAxis.set(1, 0, 0);
    var bend = (depth === 0 ? 0.11 : 0.16) * (rnd() * 0.8 + 0.4);
    var endRadius = radius * (depth === 0 ? 0.55 : 0.72);
    var isTwig = depth >= 3;

    for (var i = 0; i < sub; i++) {
      d.applyAxisAngle(bendAxis, bend * (i / sub + 0.35));
      d.y += depth === 0 ? 0.015 : 0.075;          // 向上生长偏置
      d.normalize();

      var segLen = length / sub;
      var p2 = p.clone().addScaledVector(d, segLen);
      var ra = lerp(radius, endRadius, i / sub);
      var rb = lerp(radius, endRadius, (i + 1) / sub);
      pathPoints.push(p2.clone());

      // 细枝中段也挂叶片锚点（让树冠更饱满）
      if (depth >= 4 && i === 0) {
        store.tips.push({ pos: p.clone().lerp(p2, 0.5), dir: d.clone(), r: rb });
      }
      p = p2;
    }

    addCurvedBranch(pathPoints, radius, endRadius, isTwig ? store.twig : store.bark, depth);

    // A rounded woody fork closes the open pipe end beneath the child branches.
    if (depth < MAX_DEPTH) {
      var fork = new THREE.SphereGeometry(endRadius * 1.04, depth <= 2 ? 12 : 6, depth <= 2 ? 8 : 4);
      fork.scale(1, 1.12, 1); fork.translate(p.x, p.y, p.z);
      (isTwig ? store.twig : store.bark).push(fork.toNonIndexed()); fork.dispose();
    }

    if (depth >= MAX_DEPTH) {
      store.tips.push({ pos: p.clone(), dir: d.clone(), r: endRadius });
      return;
    }

    var n = CHILDREN[depth] || 2;
    for (var k = 0; k < n; k++) {
      var azim = (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.95 + depth * 0.75;
      var tilt = THREE.MathUtils.degToRad(46 + rnd() * 30 - depth * 3.5);
      var childDir = rotateAway(d, azim, tilt);
      growBranch({
        start: p.clone().addScaledVector(d, -length * 0.07 * rnd()),
        dir: childDir,
        length: length * (0.66 + rnd() * 0.12),
        radius: endRadius * (depth === 0 ? 0.62 : 0.74),
        depth: depth + 1,
        store: store
      });
    }
  }

  // Continuous tapered branches: shared longitudinal rings and continuous UVs
  // prevent the previous stack of cylinders from showing horizontal seams.
  function addCurvedBranch(points, r0, r1, list, depth) {
    var curve = new THREE.CatmullRomCurve3(points);
    var segments = depth === 0 ? 64 : depth <= 2 ? 24 : 5;
    var radial = depth === 0 ? 64 : depth <= 2 ? 24 : 6;
    var frames = curve.computeFrenetFrames(segments, false);
    var positions = [], uvs = [], indices = [], center = new THREE.Vector3();
    for (var i = 0; i <= segments; i++) {
      var t = i / segments, r = lerp(r0, r1, t);
      curve.getPointAt(t, center);
      for (var j = 0; j <= radial; j++) {
        var a = j / radial * Math.PI * 2;
        var f = depth <= 1 ? 1 + Math.sin(a*5+t*2.1)*.065 + Math.sin(a*11+t*3)*.04 + Math.sin(a*23-t*7)*.018 : 1;
        if(depth===0)f+=Math.sin(a*3+t*5)*.055+Math.sin(t*19+a*7)*.018;
        var v = center.clone().addScaledVector(frames.normals[i], Math.cos(a)*r*f)
          .addScaledVector(frames.binormals[i],Math.sin(a)*r*f);
        positions.push(v.x,v.y,v.z); uvs.push(j/radial*Math.max(1,(r0+r1)*Math.PI/1.1),t*curve.getLength()/1.25);
        if (i < segments && j < radial) {
          var k=i*(radial+1)+j, next=k+radial+1;
          indices.push(k,k+1,next,next,k+1,next+1);
        }
      }
    }
    var g=new THREE.BufferGeometry();
    // Close both ends: a grazing view must never expose the hollow tube interior.
    for (var cap = 0; cap < 2; cap++) {
      curve.getPointAt(cap, center);
      var ci = positions.length / 3; positions.push(center.x, center.y, center.z); uvs.push(.5, .5);
      var ring = cap ? segments * (radial + 1) : 0;
      for (var edge = 0; edge < radial; edge++) {
        if (cap) indices.push(ci, ring + edge, ring + edge + 1);
        else indices.push(ci, ring + edge + 1, ring + edge);
      }
    }
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    g.setIndex(indices); g.computeVertexNormals(); list.push(g.toNonIndexed()); g.dispose();
    return curve;
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
    var perTip = small ? 10 : 18;
    var count = tips.length * perTip;

    var geo = new THREE.PlaneGeometry(0.17,0.24,2,3);
    var lp=geo.attributes.position;
    for(var li=0;li<lp.count;li++)lp.setZ(li,Math.sin((lp.getY(li)+.12)/.24*Math.PI)*.024-Math.abs(lp.getX(li))*.14);
    geo.computeVertexNormals();
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
    applyWind(mesh.customDepthMaterial, wind, false);

    var m = new THREE.Matrix4();
    var q = new THREE.Quaternion();
    var s = new THREE.Vector3();
    var pos = new THREE.Vector3();
    var e = new THREE.Euler();
    var jitter = 0.52;
    var idx = 0;

    for (var i = 0; i < tips.length; i++) {
      var tip = tips[i];
      for (var k = 0; k < perTip; k++) {
        pos.copy(tip.pos)
          .addScaledVector(tip.dir, 0.04 + rnd() * 0.16)
          .add(new THREE.Vector3(
            (rnd() - 0.5) * jitter,
            (rnd() - 0.5) * jitter,
            (rnd() - 0.5) * jitter
          ));
        // 叶片略向下垂
        e.set(
          Math.PI * 0.5 + (rnd() - 0.5) * 2.2,
          rnd() * Math.PI * 2,
          (rnd() - 0.5) * 1.2
        );
        q.setFromEuler(e);
        var sc = 0.85 + rnd() * 0.8;
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
    var geo = new THREE.SphereGeometry(0.045, 12, 10);
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
          (rnd() - 0.5) * 0.34,
          -0.12 - rnd() * 0.22,
          (rnd() - 0.5) * 0.34
        ));
      e.set(rnd() * 3, rnd() * 3, rnd() * 3);
      q.setFromEuler(e);
      var sc = 0.8 + rnd() * 0.55;
      s.set(sc, sc, sc);
      m.compose(pos, q, s);
      mesh.setMatrixAt(i, m);

      // 成熟度：多数暗红，少量青枣
      if (rnd() < 0.74) {
        col.setHSL(0.012 + rnd() * 0.02, 0.62, 0.29 + rnd() * 0.08);
      } else {
        col.setHSL(0.2, 0.5, 0.42 + rnd() * 0.1);
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
    var amp = isTwig ? 0.008 : 0.024;
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

    x.fillStyle = '#786e5f';
    x.fillRect(0, 0, w, h);

    // 纵向木纹
    var i, px, wdt, shade, y, xx;
    for (i = 0; i < 300; i++) {
      px = rnd() * w;
      wdt = 1 + rnd() * 5;
      shade = rnd();
      x.strokeStyle = shade < 0.52
        ? 'rgba(58,40,24,' + (0.08 + rnd() * 0.22) + ')'
        : 'rgba(196,170,132,' + (0.05 + rnd() * 0.16) + ')';
      x.lineWidth = wdt;
      x.beginPath();
      y = 0; xx = px;
      x.moveTo(xx, y);
      while (y < h) {
        y += 12 + rnd() * 30;
        xx += (rnd() - 0.5) * 10;
        x.lineTo(xx, y);
      }
      x.stroke();
    }

    // 树皮裂纹
    for (i = 0; i < 46; i++) {
      x.strokeStyle = 'rgba(38,24,13,' + (0.16 + rnd() * 0.3) + ')';
      x.lineWidth = 1 + rnd() * 2.2;
      x.beginPath();
      y = rnd() * h;
      xx = rnd() * w;
      x.moveTo(xx, y);
      for (var k = 0; k < 6; k++) {
        xx += (rnd() - 0.5) * 42;
        y += 10 + rnd() * 42;
        x.lineTo(xx, y);
      }
      x.stroke();
    }

    // 细噪点
    var img = x.getImageData(0, 0, w, h);
    var d = img.data;
    for (i = 0; i < d.length; i += 4) {
      var nn = (rnd() - 0.5) * 26;
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

    var L = s * 0.44, W = s * 0.34;
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
      var r = rnd() * 6 + 1.5;
      var g = rnd();
      x.fillStyle = g < 0.45
        ? 'rgba(120,106,78,0.45)'
        : (g < 0.82 ? 'rgba(154,140,109,0.4)' : 'rgba(96,104,62,0.42)');
      x.beginPath();
      x.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
      x.fill();
    }

    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(7, 7);            // 地面半径收拢到 34m，保持纹理密度
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
      n = (rnd() - 0.5) * amt;
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
        var g = 146 + (rnd() - 0.5) * 34;
        var cool = (rnd() - 0.5) * 7;
        x.fillStyle = 'rgb(' + Math.round(g - 5 + cool) + ',' + Math.round(g) +
          ',' + Math.round(g + 7 + cool * 0.5) + ')';
        var bx = b * bw - (r % 2) * bw / 2;
        x.fillRect(bx + 1.2, r * bh + 1.1, bw - 2.4, bh - 2.2);
        if (bx < 0) x.fillRect(bx + w + 1.2, r * bh + 1.1, bw - 2.4, bh - 2.2);
      }
    }
    for (i = 0; i < 260; i++) {                  // 斑驳
      x.fillStyle = 'rgba(' + (rnd() < 0.5 ? '58,60,56,' : '206,204,193,') +
        (0.03 + rnd() * 0.1) + ')';
      x.beginPath(); x.arc(rnd() * w, rnd() * h, 4 + rnd() * 28, 0, 6.2832); x.fill();
    }
    for (i = 0; i < 16; i++) {                   // 雨痕
      x.fillStyle = 'rgba(70,72,64,' + (0.04 + rnd() * 0.09) + ')';
      x.fillRect(rnd() * w, rnd() * h * 0.6, 2 + rnd() * 9, 60 + rnd() * 190);
    }
    addNoise(x, w, h, 16);
    return tex(c);
  }

  function makeRoofTexture() {
    // Physical barrel tiles carry the silhouette; the map supplies fired-clay variation only.
    var c = newCanvas(256, 256), x = ctx2d(c);
    x.fillStyle = '#62676a'; x.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 1000; i++) {
      x.fillStyle = i % 2 ? 'rgba(30,35,38,0.045)' : 'rgba(191,193,186,0.06)';
      x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 5, 1 + rnd() * 8);
    }
    addNoise(x, 256, 256, 10);
    return tex(c);
  }

  function makeStoneTexture() {                  // 一块贴图 ≈ 1m × 1m 石面
    var w = 512, h = 512, c = newCanvas(w, h), x = ctx2d(c), i, k;
    x.fillStyle = '#b2aea3'; x.fillRect(0, 0, w, h);
    for (i = 0; i < 9000; i++) {
      x.fillStyle = rnd() < 0.5
        ? 'rgba(86,84,78,' + (0.05 + rnd() * 0.24) + ')'
        : 'rgba(230,227,216,' + (0.05 + rnd() * 0.3) + ')';
      x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2.6, 1 + rnd() * 2.6);
    }
    for (k = 0; k < 12; k++) {                   // 石纹
      x.strokeStyle = 'rgba(118,114,104,' + (0.05 + rnd() * 0.12) + ')';
      x.lineWidth = 0.6 + rnd() * 1.9;
      var px = rnd() * w, py = rnd() * h;
      x.beginPath(); x.moveTo(px, py);
      for (i = 0; i < 7; i++) { px += (rnd() - 0.5) * 150; py += (rnd() - 0.5) * 150; x.lineTo(px, py); }
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
        var g = 136 + (rnd() - 0.5) * 30;
        x.fillStyle = 'rgb(' + Math.round(g - 4) + ',' + Math.round(g) + ',' + Math.round(g + 5) + ')';
        x.fillRect(b * s + 2, r * s + 2, s - 4, s - 4);
      }
    }
    for (i = 0; i < 220; i++) {                  // 苔痕 / 污渍
      x.fillStyle = 'rgba(' + (rnd() < 0.42 ? '84,94,60,' : '92,88,78,') +
        (0.04 + rnd() * 0.12) + ')';
      x.beginPath(); x.arc(rnd() * w, rnd() * h, 3 + rnd() * 22, 0, 6.2832); x.fill();
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
      x.strokeStyle = 'rgba(' + (rnd() < 0.5 ? '58,21,14,' : '162,86,64,') +
        (0.04 + rnd() * 0.14) + ')';
      x.lineWidth = 0.6 + rnd() * 3;
      px = rnd() * w; y = 0;
      x.beginPath(); x.moveTo(px, y);
      while (y < h) { y += 20 + rnd() * 42; px += (rnd() - 0.5) * 6; x.lineTo(px, y); }
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

    var matBrick = new THREE.MeshStandardMaterial({ map: texBrick, bumpMap: texBrick, bumpScale: 0.014, roughness: 0.95, metalness: 0 });
    var matTile = new THREE.MeshStandardMaterial({ map: texTile, roughness: 0.8, metalness: 0.02 });
    var matStone = new THREE.MeshStandardMaterial({ map: texStone, roughness: 0.9, metalness: 0 });
    var matLat = new THREE.MeshStandardMaterial({ color: 0x253031, roughness: 0.54, metalness: 0.06 });
    var matWood = new THREE.MeshStandardMaterial({ map: texWood, roughness: 0.6, metalness: 0.02 });
    var matFrame = new THREE.MeshStandardMaterial({ color: 0x2f4038, roughness: 0.73 });
    var matTrim = new THREE.MeshStandardMaterial({ color: 0x9c8861, roughness: 0.85 });
    var matPaint = new THREE.MeshStandardMaterial({ color: 0x2f6b53, roughness: 0.62, metalness: 0.03 });
    var matGlaze = new THREE.MeshStandardMaterial({ color: 0x3d5044, roughness: 0.26, metalness: 0.08 });
    var matWater = new THREE.MeshStandardMaterial({ color: 0x2b4450, roughness: 0.08, metalness: 0.4 });
    var matFoliage = new THREE.MeshStandardMaterial({ color: 0x5c7a3c, roughness: 0.92, metalness: 0 });
    var matTrunk = new THREE.MeshStandardMaterial({ color: 0x6d5c46, roughness: 0.96, metalness: 0 });
    var matBgLeaf = new THREE.MeshStandardMaterial({ color: 0x6b7c58, roughness: 0.96, metalness: 0 });
    var matPave = new THREE.MeshStandardMaterial({ map: texPave, roughness: 1, metalness: 0 });

    var G = {
      brick: [], tile: [], stone: [], lattice: [], wood: [],
      frame: [], trim: [], paint: [], glaze: [], water: [], foliage: [], trunk: [], bgLeaf: []
    };

    /* ---------------- 垌地（灰砖墁地，覆盖一进院 + 二进院） ---------------- */
    var pave = new THREE.Mesh(new THREE.PlaneGeometry(28.8, 38.6), matPave);
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(0, 0.004, -3.5);
    pave.name = 'courtyard-grey-paving';
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
      for (i = 0; i < segs.length; i++) {
        a = segs[i][0]; b = segs[i][1];
        if (b - a > 0.05) put(G.stone, geoBox(b - a, 0.16, t + 0.05), {x:(a+b)/2, y:0.08, z:z, uv:1.2});
      }
      put(G.brick, geoBox(x1-x0, 0.12, t+0.08), {x:(x0+x1)/2,y:h-0.07,z:z,uv:2});
      capX(x0, x1, z, h, t);
    }

    function wallZ(z0, z1, x, h, t) {
      var halfW = t / 2 + 0.16, rise = 0.16, len = z1 - z0;
      var ang = Math.atan2(rise, halfW), sl = Math.sqrt(halfW * halfW + rise * rise);
      var cz = (z0 + z1) / 2;
      put(G.stone, geoBox(t + 0.05, 0.16, len), {x:x,y:0.08,z:cz,uv:1.2});
      put(G.brick, geoBox(t + 0.08, 0.12, len), {x:x,y:h-0.07,z:cz,uv:2});
      put(G.brick, geoBox(t, h, len), { x: x, y: h / 2, z: cz, uv: 2 });
      put(G.tile, geoBox(sl, 0.1, len), { x: x + halfW / 2, y: h + rise / 2, z: cz, rz: -ang, uv: 1.2 });
      put(G.tile, geoBox(sl, 0.1, len), { x: x - halfW / 2, y: h + rise / 2, z: cz, rz: ang, uv: 1.2 });
    }

    wallX(-14, 14, 15, 2.8, WT, null);      // 南墙（较低）+ 门洞
    wallX(-9.5, 9.5, -9.5, WH, WT, { c: 3.4, w: 2.8, h: 2.4 });   // 隔墙 + 垂花门（一进院/二进院之界）
    wallX(-12, 12, -20, WH, WT, null);                            // 北墙
    wallZ(4.6, 8.5, -12, 2.2, WT); wallZ(4.6, 8.5, 12, 2.2, WT);  // 一进院南侧补墙
    wallZ(-20, -9.5, -12, WH, WT); wallZ(-20, -9.5, 12, WH, WT);  // 二进院侧墙

    // 全景机位在旧南墙之外：把前场纳入有围墙的灰砖院落，所有可达机位均在院界内。
    wallZ(-22, 15, -14, WH, WT); wallZ(-22, 15, 14, WH, WT);
    wallX(-14, 14, -22, WH, WT, null);

    /* ---------------- 屋面 / 山墙 ---------------- */
    // 硬山屋面保持收敛的直山轮廓；轻微凹曲表现举折，避免夸张的飞檐。
    function roofY(t, E, R) { return R + (E - R) * t - 0.13 * Math.sin(Math.PI * t); }

    function roofStrip(x0, x1, half, E, R, side, barrel) {
      var pos = [], uv = [], ix = [], across = barrel ? 6 : 1, along = 10;
      for (var j = 0; j <= along; j++) {
        var t = j / along;
        for (var k = 0; k <= across; k++) {
          var u = k / across;
          pos.push(lerp(x0, x1, u), roofY(t, E, R) + (barrel ? Math.sin(Math.PI*u)*0.075 + 0.035 : 0), side*half*t);
          uv.push(lerp(x0,x1,u)/1.2, t*half/1.2);
          if (j < along && k < across) {
            var a = j*(across+1)+k, b = a+across+1;
            if (side > 0) ix.push(a,b,a+1,b,b+1,a+1);
            else ix.push(a,a+1,b,b,a+1,b+1);
          }
        }
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
      g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      g.setIndex(ix); g.computeVertexNormals(); return g;
    }

    function ridgeEnd(sign, x, R, W) {
      // 简化的大吻轮廓，用于示意；不把装饰细节宣称为实物测绘结果。
      var p = new THREE.Shape();
      [[-0.14,0],[0.15,0],[0.25,0.22],[0.23,0.43],[0.12,0.62],
       [-0.02,0.67],[-0.09,0.55],[0.04,0.47],[0.02,0.31],[-0.14,0.19]].forEach(function(v,i){
        if(i) p.lineTo(sign*v[0],R+0.18+v[1]*0.72); else p.moveTo(sign*v[0],R+0.18+v[1]*0.72);
      }); p.closePath();
      var g = new THREE.ExtrudeGeometry(p,{depth:0.22,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:0.025,bevelThickness:0.025});
      g.translate(x,0,-0.11); put(G.tile,g,mix({uv:1},W));
    }

    function addRoof(L, D, E, R, og, gg, W) {
      var half = D/2+og, len = L+2*gg, count = Math.ceil(len/0.25), step = len/count;
      [-1,1].forEach(function(side){
        put(G.tile,roofStrip(-len/2,len/2,half,E,R,side,false),mix({uv:false},W));
        var underside=roofStrip(-len/2,len/2,half,E,R,side,false);
        var indices=underside.index.array;
        for(var f=0;f<indices.length;f+=3){var swap=indices[f+1];indices[f+1]=indices[f+2];indices[f+2]=swap;}
        underside.computeVertexNormals(); underside.translate(0,-0.095,0);
        put(G.wood,underside,mix({uv:1.2},W));
        for(var i=0;i<count;i++) {
          var x = -len/2+(i+0.5)*step;
          put(G.tile,roofStrip(x-step*0.35,x+step*0.35,half,E,R,side,true),mix({uv:false},W));
          // 瓦当端面与滴水缘；真实几何在檐口形成清晰的筒瓦轮廓。
          var end = new THREE.CircleGeometry(step*0.35,8,0,Math.PI);
          if(side<0) end.rotateY(Math.PI);
          put(G.tile,end,mix({x:x,y:E+0.035,z:side*(half+0.006),uv:1},W));
        }
        // 分段搭接：横向窄缘沿曲面布置，避免整面只有一张条纹贴图。
        for(var j=1;j<9;j++) {
          var t=j/9, slope=(roofY(Math.min(1,t+0.01),E,R)-roofY(Math.max(0,t-0.01),E,R))/(0.02*half);
          put(G.tile,geoBox(len,0.025,0.045),mix({y:roofY(t,E,R)+0.028,z:side*half*t,rx:-side*Math.atan(slope),uv:1.2},W));
        }
        put(G.wood,geoBox(len,0.15,0.11),mix({y:E-0.12,z:side*(half-0.04),uv:1},W));
        // 外露椽头位于瓦层下面，沿整条檐口等距排布。
        var nr=Math.ceil(L/0.38);
        for(var q=0;q<=nr;q++) {
          put(G.wood,geoBox(0.07,0.09,0.48),mix({x:-L/2+q*L/nr,y:E-0.17,z:side*(half-0.2),rx:side*0.12,uv:1},W));
        }
      });
      put(G.tile,geoBox(len+0.12,0.18,0.35),mix({y:R+0.13,uv:1.2},W));
      put(G.tile,geoCyl(0.115,0.115,len+0.16,10),mix({y:R+0.26,rz:Math.PI/2,uv:1.2},W));
      ridgeEnd(-1,-len/2+0.12,R,W); ridgeEnd(1,len/2-0.12,R,W);
      // 硬山两端的排山与压顶随坡折线走向，露出砖山墙而非悬空薄片。
      [-1,1].forEach(function(end){ [-1,1].forEach(function(side){
        for(var j=0;j<10;j++) {
          var t0=j/10,t1=(j+1)/10,dy=roofY(t1,E,R)-roofY(t0,E,R),dz=half/10;
          put(G.tile,geoBox(0.16,0.12,Math.sqrt(dy*dy+dz*dz)+0.025),mix({x:end*(len/2-0.01),y:(roofY(t0,E,R)+roofY(t1,E,R))/2+0.07,z:side*half*(t0+t1)/2,rx:-side*Math.atan2(dy,dz),uv:1.2},W));
        }
      }); });
    }

    function gableGeo(D, E, R, T) {
      var s = new THREE.Shape(); s.moveTo(-D/2,E); s.lineTo(D/2,E);
      var roofHalf=D/2+0.55, edgeT=(D/2)/roofHalf;
      for(var j=10;j>=0;j--) {var t=j/10;s.lineTo(D/2*t,roofY(t*edgeT,E,R)-0.015);}
      for(var k=1;k<=10;k++) {var u=k/10;s.lineTo(-D/2*u,roofY(u*edgeT,E,R)-0.015);}
      s.closePath();
      var g=nidx(new THREE.ExtrudeGeometry(s,{depth:T,bevelEnabled:false}));
      g.translate(0,0,-T/2); g.rotateY(Math.PI/2); return g;
    }

    function framedOpening(cx, bottom, width, height, z, door, W) {
      // 暗色内退面 + 独立框、棂、裙板，近看也有真正的遮挡与厚度。
      put(G.lattice,geoBox(width,height,0.08),mix({x:cx,y:bottom+height/2,z:z-0.13,uv:1},W));
      var frame=0.065, lower=door?0.66:0.17;
      [-1,1].forEach(function(side){
        put(G.wood,geoBox(frame,height+0.1,0.14),mix({x:cx+side*width/2,y:bottom+height/2,z:z,uv:1},W));
      });
      [bottom,bottom+height,bottom+lower].forEach(function(y){
        put(G.wood,geoBox(width+0.1,frame,0.14),mix({x:cx,y:y,z:z,uv:1},W));
      });
      var sash=width/2, glassH=height-lower;
      for(var n=0;n<2;n++) {
        var left=cx-width/2+n*sash;
        put(G.frame,geoBox(0.045,height,0.11),mix({x:left+sash/2,y:bottom+height/2,z:z+0.025,uv:1},W));
        for(var a=0;a<=4;a++) put(G.frame,geoBox(0.023,glassH,0.065),mix({x:left+a*sash/4,y:bottom+lower+glassH/2,z:z+0.04,uv:1},W));
        for(var b=1;b<8;b++) put(G.frame,geoBox(sash,0.023,0.065),mix({x:left+sash/2,y:bottom+lower+b*glassH/8,z:z+0.04,uv:1},W));
        put(G.wood,geoBox(sash-0.09,lower-0.07,0.09),mix({x:left+sash/2,y:bottom+lower/2,z:z-0.015,uv:1},W));
        if(door) {
          put(G.frame,geoBox(sash-0.22,0.025,0.045),mix({x:left+sash/2,y:bottom+0.15,z:z+0.04,uv:1},W));
          put(G.frame,geoBox(sash-0.22,0.025,0.045),mix({x:left+sash/2,y:bottom+lower-0.15,z:z+0.04,uv:1},W));
          put(G.trim,geoCyl(0.025,0.025,0.085,8),mix({x:cx+(n?0.09:-0.09),y:bottom+0.95,z:z+0.1,rx:Math.PI/2,uv:1},W));
        }
      }
      if(!door) put(G.stone,geoBox(width+0.23,0.09,0.25),mix({x:cx,y:bottom-0.035,z:z,uv:1.1},W));
    }

    /* ---------------- 房屋：分间立面、内退格窗、石台基、柱础、梁枋 ---------------- */
    function addHall(c) {
      var L=c.len,D=c.dep,E=c.eave,R=c.ridge,deck=c.deck||0;
      var W={wx:c.x,wz:c.z,ry:c.ry||0}, front=D/2;
      put(G.stone,geoBox(L+0.65,deck,D+0.7),mix({y:deck/2,uv:1.1},W));
      put(G.stone,geoBox(L+0.72,0.09,D+0.77),mix({y:deck-0.015,uv:1.1},W));
      put(G.stone,geoBox(2.5,0.12,0.42),mix({y:0.06,z:front+0.54,uv:1.1},W));
      if(deck>0.25) put(G.stone,geoBox(2.8,0.1,0.35),mix({y:0.05,z:front+0.86,uv:1.1},W));
      // 后墙及两侧墙；正面按开间留出真正的窗洞。
      put(G.brick,geoBox(L,E-deck,0.3),mix({y:(E+deck)/2,z:-D/2+0.15,uv:2},W));
      [-1,1].forEach(function(side){
        put(G.brick,geoBox(0.34,E-deck,D),mix({x:side*(L/2-0.17),y:(E+deck)/2,uv:2},W));
      });
      var bays=5, bay=(L-0.64)/bays;
      for(var i=0;i<bays;i++) {
        var cx=-L/2+0.32+(i+0.5)*bay, door=i===2;
        var bottom=door?deck+0.07:deck+0.77, top=E-0.5;
        put(G.brick,geoBox(bay,0.5,0.32),mix({x:cx,y:E-0.25,z:front-0.16,uv:2},W));
        if(!door) put(G.brick,geoBox(bay,0.77,0.32),mix({x:cx,y:deck+0.385,z:front-0.16,uv:2},W));
        framedOpening(cx,bottom,bay-0.27,top-bottom,front+0.015,door,W);
      }
      for(var j=0;j<=bays;j++) {
        var x=-L/2+0.32+j*bay;
        put(G.brick,geoBox(0.17,E-deck,0.34),mix({x:x,y:(E+deck)/2,z:front-0.17,uv:2},W));
        put(G.stone,geoCyl(0.17,0.19,0.16,12),mix({x:x,y:deck+0.08,z:front+0.24,uv:1},W));
        put(G.wood,geoCyl(0.105,0.12,E-deck-0.16,16),mix({x:x,y:(E+deck+0.16)/2,z:front+0.24,uv:1},W));
        put(G.wood,geoBox(0.28,0.12,0.42),mix({x:x,y:E-0.24,z:front+0.27,uv:1},W));
        put(G.paint,geoBox(0.36,0.1,0.55),mix({x:x,y:E-0.13,z:front+0.27,uv:1},W));
      }
      put(G.wood,geoBox(L,0.22,0.23),mix({y:E-0.29,z:front+0.22,uv:1},W));
      put(G.paint,geoBox(L-0.2,0.1,0.035),mix({y:E-0.28,z:front+0.35,uv:1},W));
      [-1,1].forEach(function(side){
        put(G.trim,geoBox(L-0.2,0.013,0.035),mix({y:E-0.28+side*0.05,z:front+0.374,uv:1},W));
        put(G.brick,gableGeo(D,E,R,0.32),mix({x:side*(L/2-0.1),uv:2},W));
      });
      addRoof(L,D,E,R,c.og==null?0.55:c.og,0.2,W);
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

    // 垂花门木构补充柱础、雀替、梁枋细边，保持中间通道净空。
    [-1,1].forEach(function(side){
      put(G.stone,geoCyl(0.21,0.23,0.19,16),{x:gx+side*1.2,y:0.095,z:gz,uv:1});
      put(G.wood,geoBox(0.38,0.12,0.5),{x:gx+side*1.2,y:2.45,z:gz+0.08,uv:1});
      put(G.paint,geoBox(0.45,0.1,0.62),{x:gx+side*1.2,y:2.83,z:gz+0.08,uv:1});
      put(G.trim,geoBox(2.68,0.018,0.035),{x:gx,y:2.62+side*0.12,z:gz+0.17,uv:1});
    });

    /* ---------------- 有倒角、鼓形凳身和石材微表面的桌凳 ---------------- */
    window.NIANLUN_MODULES.courtyardDetail.furniture(scene,texStone);

    /* ---------------- 水缸（防火） + 花盆 ---------------- */
    var jarProf = [
      new THREE.Vector2(0.05, 0), new THREE.Vector2(0.36, 0.02), new THREE.Vector2(0.42, 0.12),
      new THREE.Vector2(0.53, 0.3), new THREE.Vector2(0.6, 0.5), new THREE.Vector2(0.58, 0.68),
      new THREE.Vector2(0.52, 0.82), new THREE.Vector2(0.5, 0.92), new THREE.Vector2(0.52, 0.95)
    ];
    put(G.glaze, geoLathe(jarProf, 24), { wx: 7.2, wz: -5.4, uv: 1 });
    put(G.water, geoCyl(0.47, 0.47, 0.02, 22), { y: 0.86, wx: 7.2, wz: -5.4, uv: 1 });

    // Potted shrubs now have hollow pots, soil, stems and solid curved leaves.
    // Their geometry is built by courtyard-detail.js and shared with collision placement.

    /* ---------------- 合并渲染 ---------------- */
    function merged(list, mat, cast) {
      if (!list.length) return null;
      var m = new THREE.Mesh(mergeGeoms(list), mat);
      m.name = 'courtyard-' + Object.keys(G).filter(function(key){return G[key]===list;})[0];
      list.forEach(function(g){g.dispose();});
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
    merged(G.frame, matFrame);
    merged(G.trim, matTrim);
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
      // 未交互 1.2 秒后缓慢自转（camfix 固定机位时停用）
      if (!fixed && !reduceMotion && !dragging && idle > 1.2) tAz += dt * 0.05;
      az += (tAz - az) * Math.min(1, dt * 3.4);
      el += (tEl - el) * Math.min(1, dt * 3.4);
    }

    /* M03 集成补丁：固定机位（供同机位 before/after 对比与录屏） */
    var fixed = false;
    function fix(azimuth, elevation, dist) {
      fixed = true;
      az = tAz = azimuth;
      el = tEl = clamp(elevation, 0.03, 1.05);
      baseDist = dist;
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
      update: update, apply: apply, fix: fix,
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
      var j = Math.floor(rnd() * (i + 1));
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
