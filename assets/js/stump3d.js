/* =====================================================================
 * stump3d.js —— 首页「触摸年轮」：3D 树桩横切面（three.js 建模）
 * ---------------------------------------------------------------------
 * · 与首页四合院开场同样走本地内置 three.js（window.THREE），
 *   经典脚本，file:// 双击打开也能显示。
 * · 完全程序化生成，无外部素材：
 *   - 树桩立体：上下两个「俯视横切面」圆盘 + 侧壁树皮，圆盘轮廓由
 *     逐段随机半径扰动生成，不是标准正圆；带年轮纹理与木裂纹。
 *   - 11 圈年轮：每圈一个可拾取的环带网格，颜色/宽度不同，略高于
 *     木面，悬停抬升高亮；点击进入对应年代页。
 *   - 裂纹：放射状 + 环形，作为独立窄条几何压在木面上。
 * · 交互：拖拽旋转 / 缓慢自转 / prefers-reduced-motion 静止；
 *   悬停年轮 → 环带高亮 + 浮现年份提示；点击 → 跳转对应年代。
 * · 无 WebGL 时优雅降级：退回 SVG 分层年轮（stump.js 的静态版），
 *   再不行则保留文字说明。
 * ===================================================================== */
(function () {
  'use strict';

  var THREE = window.THREE;
  var stage = document.getElementById('stumpStage');

  if (!stage) return;
  if (!THREE) { degrade('three.js 未加载'); return; }

  /* 尽早声明「本模块将接管树桩区域」：stump.js 看到此标记会等待 3D 结果，
     只有 3D 失败（WebGL 不可用 / 初始化异常）时才绘制 SVG 回退年轮。 */
  window.__stump3dIntent = true;

  var S = window.SITE;
  var esc = (window.UI && window.UI.esc) ? window.UI.esc : function (s) { return s; };

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { reduceMotion = false; }

  function degrade(msg) {
    if (window.console && console.warn) {
      console.warn('[stump3d] 已降级：' + msg);
    }
    window.__stump3dIntent = false;
    window.__stump3d = null;
    // 清理 init() 中途可能留下的 3D 画布与提示层，避免与 SVG 回退层叠加
    var junk = stage.querySelectorAll('.stump-canvas3d, .stump-3d-tip');
    for (var i = 0; i < junk.length; i++) {
      if (junk[i].parentNode) junk[i].parentNode.removeChild(junk[i]);
    }
    stage.classList.remove('stump3d-ready');
    stage.classList.add('stump-fallback');
  }

  /* 年轮配色（由内向外）：扎根 → 觉醒 → 播撒 → 回望 → 新芽 */
  var COLORS = [
    '#e6d2a6', '#dcc196', '#cbaa70', '#b98a55', '#a86a44',
    '#8c1f28', '#a33227', '#b5652f', '#c08a45', '#cf9b56', '#5f8c46'
  ];

  /* ================================================================== */
  /* 小工具                                                              */
  /* ================================================================== */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ================================================================== */
  /* 轮廓：逐段扰动半径 → 非正圆的横切面边界                              */
  /* ================================================================== */
  var SEG = 200;
  function wobbleProfile(seed, amp) {
    // 返回 [0..SEG) 的半径系数（≈1 ± amp），用几条正弦叠加，平滑且可复现
    var rnd = mulberry32(seed);
    var k1 = 2 + (rnd() * 3 | 0), k2 = 5 + (rnd() * 7 | 0), k3 = 11 + (rnd() * 13 | 0);
    var p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
    var a1 = amp * (0.5 + rnd() * 0.5), a2 = amp * (0.25 + rnd() * 0.35), a3 = amp * (0.1 + rnd() * 0.2);
    var arr = new Float32Array(SEG);
    for (var i = 0; i < SEG; i++) {
      var a = i / SEG * Math.PI * 2;
      arr[i] = 1 + a1 * Math.sin(a * k1 + p1) + a2 * Math.sin(a * k2 + p2) + a3 * Math.sin(a * k3 + p3);
    }
    return arr;
  }

  /* 安全取轮廓值：任意角度 a（可为负、可 > 2π）都映射到 [0, SEG) */
  function profileAt(profile, a) {
    var idx = Math.round(a / (Math.PI * 2) * SEG) % SEG;
    if (idx < 0) idx += SEG;
    return profile[idx];
  }

  /* ================================================================== */
  /* 木纹 / 年轮纹理（Canvas 程序化）                                     */
  /* ================================================================== */
  function makeWoodTexture(n, seed) {
    var SIZE = 1024;
    var cv = document.createElement('canvas');
    cv.width = cv.height = SIZE;
    var ctx = cv.getContext('2d');
    var rnd = mulberry32(seed);
    var c = SIZE / 2, R = SIZE / 2;

    var g = ctx.createRadialGradient(c, c, 0, c, c, R);
    g.addColorStop(0, '#ecdcb6');
    g.addColorStop(0.55, '#ddc79c');
    g.addColorStop(1, '#c9ab7f');
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();

    // 11 圈年轮色带（纹理层面）
    for (var i = 0; i < n; i++) {
      var r0 = R * (0.075 + 0.925 * (i / n));
      var r1 = R * (0.075 + 0.925 * ((i + 1) / n));
      ctx.beginPath(); ctx.arc(c, c, r1, 0, Math.PI * 2);
      ctx.arc(c, c, r0, 0, Math.PI * 2, true);
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.globalAlpha = 0.9;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(c, c, r1, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(78,50,28,.5)'; ctx.lineWidth = 2.2; ctx.stroke();
    }
    // 细密同心微纹
    for (var k = 0; k < 160; k++) {
      var rr = R * (0.1 + Math.pow(rnd(), 0.7) * 0.9);
      ctx.beginPath(); ctx.arc(c, c, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(74,48,28,' + (0.04 + rnd() * 0.06).toFixed(3) + ')';
      ctx.lineWidth = 0.8 + rnd() * 1.2; ctx.stroke();
    }
    // 木射线
    for (var m = 0; m < 120; m++) {
      var a = rnd() * Math.PI * 2, l = R * (0.3 + rnd() * 0.68);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * R * 0.1, c + Math.sin(a) * R * 0.1);
      ctx.lineTo(c + Math.cos(a) * l, c + Math.sin(a) * l);
      ctx.strokeStyle = 'rgba(96,66,40,' + (0.04 + rnd() * 0.07).toFixed(3) + ')';
      ctx.lineWidth = 0.6 + rnd() * 1.1; ctx.stroke();
    }
    return new THREE.CanvasTexture(cv);
  }

  function makeBarkTexture(seed) {
    var W = 1024, H = 256;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var rnd = mulberry32(seed);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#4a3220'); g.addColorStop(0.5, '#6b4a2f'); g.addColorStop(1, '#3d2a1a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < 320; i++) {
      var x = rnd() * W, y0 = rnd() * H, h = H * (0.2 + rnd() * 0.8);
      ctx.beginPath(); ctx.moveTo(x, y0);
      ctx.bezierCurveTo(x + (rnd() - 0.5) * 16, y0 + h * 0.35,
        x + (rnd() - 0.5) * 16, y0 + h * 0.7,
        x + (rnd() - 0.5) * 10, y0 + h);
      ctx.strokeStyle = rnd() < 0.5
        ? 'rgba(32,20,12,' + (0.14 + rnd() * 0.26).toFixed(3) + ')'
        : 'rgba(150,112,72,' + (0.08 + rnd() * 0.14).toFixed(3) + ')';
      ctx.lineWidth = 1 + rnd() * 3.4; ctx.lineCap = 'round'; ctx.stroke();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(4, 1);
    return tex;
  }

  /* 接地阴影贴图：径向渐隐的暗斑，让树桩「落在」地面上 */
  function makeGroundShadowTexture() {
    var S = 512;
    var cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var ctx = cv.getContext('2d');
    var c = S / 2;
    var g = ctx.createRadialGradient(c, c, S * 0.10, c, c, S * 0.5);
    g.addColorStop(0, 'rgba(38,24,14,0.42)');
    g.addColorStop(0.55, 'rgba(38,24,14,0.20)');
    g.addColorStop(1, 'rgba(38,24,14,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    var tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace && tex.colorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* ================================================================== */
  /* 主流程                                                              */
  /* ================================================================== */
  function init() {
    var probe = document.createElement('canvas');
    var gl = probe.getContext('webgl2') || probe.getContext('webgl') ||
      probe.getContext('experimental-webgl');
    if (!gl) throw new Error('当前环境不支持 WebGL');

    var eras = S.ERAS;
    var n = eras.length;
    var small = (window.innerWidth || 999) < 700;

    var canvas = document.createElement('canvas');
    canvas.className = 'stump-canvas3d';
    canvas.setAttribute('aria-label',
      '枣树树桩 3D 横切面：11 圈年轮，由树心（清初）到最外圈（2024），点击某一圈进入对应年代');
    stage.appendChild(canvas);

    var tip = document.createElement('div');
    tip.className = 'stump-3d-tip';
    stage.appendChild(tip);

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    var focus = new THREE.Vector3(0, 0, 0);

    /* ---------------- 光照：暖木光 + 冷天光 ---------------- */
    scene.add(new THREE.HemisphereLight(0xf3f6ff, 0x40301f, 1.0));
    var key = new THREE.DirectionalLight(0xffe9c4, 2.2);
    key.position.set(3.2, 5.4, 3.6);
    key.castShadow = true;
    key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -2.4; key.shadow.camera.right = 2.4;
    key.shadow.camera.top = 2.4; key.shadow.camera.bottom = -2.4;
    key.shadow.bias = -0.0008;
    scene.add(key);
    var rim = new THREE.DirectionalLight(0xc2d8ff, 0.5);
    rim.position.set(-3.2, 2.0, -3.6);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xdfefff, 0.18));

    /* ---------------- 尺寸参数（场景单位） ---------------- */
    var R = 1.0;                 // 木墩顶面半径
    var THICK = 0.30;            // 木墩厚度（截面以上保留的墩身）
    var TRUNK_H = 1.05;          // 截面之上继续生长的树干高度
    var CORE_R = 0.075 * R;
    var ROOT_R = 1.46;           // 根系外缘（比木墩大，向外抓地）
    // 整体包围球半径（用于相机取景）：横向取根系，纵向取树干顶
    var SCENE_R = Math.max(ROOT_R, TRUNK_H * 0.75 + THICK * 0.5 + 0.25) * 1.04;

    var root = new THREE.Group();
    scene.add(root);

    /* 轮廓（顶/底略微不同的扰动） */
    var profTop = wobbleProfile(20241020, 0.018);
    var profBottom = wobbleProfile(77123, 0.02);

    /* ---------------- 材质 ---------------- */
    var woodTex = makeWoodTexture(n, 4242);
    var woodTexB = makeWoodTexture(n, 9911);
    var barkTex = makeBarkTexture(31337);
    [woodTex, woodTexB, barkTex].forEach(function (t) {
      if (THREE.SRGBColorSpace && t.colorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities && renderer.capabilities.getMaxAnisotropy
        ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    });

    var woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.86, metalness: 0 });
    var woodMatB = new THREE.MeshStandardMaterial({ map: woodTexB, roughness: 0.88, metalness: 0 });
    var barkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.97, metalness: 0 });
    // 裂缝内壁：深色粗糙木芯（不是纯黑线条，是被撬开露出的内层木质）
    var innerMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 1, metalness: 0 });
    var cortexMat = new THREE.MeshStandardMaterial({ color: 0x6d4a2c, roughness: 0.98, metalness: 0 });

    /* ---------------- 裂纹把树体分成若干块（真实裂开的缝） ---------------- */
    // 生成 5 条放射裂缝：角度 + 每条的蜿蜒偏移，把圆盘切成 5 个不规则楔块
    var cracksSpec = buildCrackSpecs(5, 20241020);
    var sectors = [];
    for (var si = 0; si < cracksSpec.length; si++) {
      var a0 = cracksSpec[si].a;
      var a1 = cracksSpec[(si + 1) % cracksSpec.length].a + (si === cracksSpec.length - 1 ? Math.PI * 2 : 0);
      sectors.push({ a0: a0, a1: a1 });
    }

    /* ---------------- 树桩主体：按块拆分，块间留缝 ---------------- */
    var ringBaseY = THICK / 2;
    var relief = buildRingRelief(n, R, CORE_R);   // 年轮高低起伏曲线

    /* 内芯：一个完整的实心圆柱体，塞在分块之间。
       分块之间的裂缝只会露出这层实心木芯，不会看到「中空的内部」。 */
    var coreProf = wobbleProfile(5150, 0.012);
    var trunkProfile = wobbleProfile(8321, 0.05);   // 树干侧影起伏
    var coreMesh = new THREE.Mesh(
      trunkBodyGeometry(TRUNK_H, R * 1.005, coreProf, trunkProfile, THICK / 2,
        THICK / 2 + TRUNK_H, 1),
      barkMat);
    coreMesh.castShadow = true; coreMesh.receiveShadow = true;
    root.add(coreMesh);

    for (var q = 0; q < sectors.length; q++) {
      var sec = sectors[q];
      var gap = 0.010 + (q % 3) * 0.004;        // 每块之间的缝宽（不规则）
      var sA = sec.a0 + gap, sB = sec.a1 - gap;

      // 顶面：带年轮起伏的扇形块（略低于年轮脊，避免共面闪烁，缝隙处露出的就是这一层）
      var topGeo = sectorTopGeometry(sA, sB, profTop, R, THICK / 2 - 0.006, relief, n, CORE_R);
      var top = new THREE.Mesh(topGeo, woodMat);
      top.castShadow = true; top.receiveShadow = true;
      root.add(top);

      // 底面
      var botGeo = sectorDiscGeometry(sA, sB, profBottom, R, -THICK / 2);
      var bot = new THREE.Mesh(botGeo, woodMatB);
      bot.castShadow = true; bot.receiveShadow = true;
      root.add(bot);

      // 外侧树皮墙（含纵向开裂）
      var wallGeo = sideWallSectorGeometry(sA, sB, profTop, R, THICK, q);
      var wall = new THREE.Mesh(wallGeo, barkMat);
      wall.castShadow = true; wall.receiveShadow = true;
      root.add(wall);

      // 两条裂缝的内壁（让缝隙看起来深）
      [sec.a0, sec.a1].forEach(function (ca, k) {
        var iw = crackWallGeometry(ca, gap, profTop, R, THICK, k === 0 ? 1 : -1);
        var iwm = new THREE.Mesh(iw, innerMat);
        iwm.receiveShadow = true;
        root.add(iwm);
      });
    }

    /* ---------------- 11 圈年轮（凸起的脊，可拾取） ---------------- */
    var ringMeshes = [];
    for (var i = 0; i < n; i++) {
      var r0 = CORE_R + (R - CORE_R) * (i / n);
      var r1 = CORE_R + (R - CORE_R) * ((i + 1) / n);
      var col = new THREE.Color(COLORS[i % COLORS.length]);
      // 每块年轮独立成 mesh（跟随块间裂缝断开）
      for (var s2 = 0; s2 < sectors.length; s2++) {
        var sc = sectors[s2];
        var g2 = 0.010 + (s2 % 3) * 0.004;
        var rg = raisedRingGeometry(r0, r1, sc.a0 + g2, sc.a1 - g2, profTop, relief, i, n);
        var mat = new THREE.MeshStandardMaterial({
          color: col, roughness: 0.8, metalness: 0,
          emissive: new THREE.Color(0x000000)
        });
        var rm = new THREE.Mesh(rg, mat);
        rm.receiveShadow = true; rm.castShadow = true;
        rm.position.y = ringBaseY;
        rm.userData = { index: i, sector: s2, baseY: ringBaseY };
        root.add(rm);
        ringMeshes.push(rm);
      }
    }

    /* 树心：略微隆起的芯材 */
    for (var s3 = 0; s3 < sectors.length; s3++) {
      var sc3 = sectors[s3];
      var g3 = 0.010 + (s3 % 3) * 0.004;
      var cg = raisedRingGeometry(0, CORE_R * 0.9, sc3.a0 + g3, sc3.a1 - g3, profTop, relief, 0, n);
      var cm = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({
        color: 0xc9a877, roughness: 0.84, metalness: 0
      }));
      cm.position.y = ringBaseY + 0.004;
      cm.userData = { index: -1, sector: s3, baseY: ringBaseY + 0.004 };
      root.add(cm);
    }

    /* ---------------- 树根：从墩底向外抓地 ---------------- */
    buildRoots(root, R, THICK, ROOT_R, barkMat, cortexMat, 20241020);

    /* ---------------- 接影地面：让树根「落地」 ---------------- */
    var groundTex = makeGroundShadowTexture();
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOT_R * 3.4, ROOT_R * 3.4),
      new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, depthWrite: false })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -THICK / 2 - 0.30;
    scene.add(ground);

    /* ---------------- 相机控制 ---------------- */
    var ctrl = createControls(canvas, reduceMotion);

    function resize() {
      var w = stage.clientWidth || 560;
      var wrap = stage.parentNode;
      // 让树桩铺满 .stump-wrap 的高度（上限 900，避免超大屏拉太长）
      var wrapH = wrap && wrap.clientHeight ? wrap.clientHeight : 0;
      // 正方形容器：树桩是圆形，方形容器能把它撑到最大、左右不留大片空白
      var side = Math.max(320, Math.min(900, Math.min(w, wrapH || w)));
      var h = side;
      w = Math.min(w, side);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // 依据纵横比让「树干 + 树桩 + 根系」整体完整入画
      var fit = SCENE_R / Math.tan(camera.fov * Math.PI / 360);
      ctrl.baseDist = fit / Math.min(1, camera.aspect) * 1.18;
      camera.updateProjectionMatrix();
    }
    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(stage);
      if (stage.parentNode) new ResizeObserver(resize).observe(stage.parentNode);
    }
    window.addEventListener('resize', resize);
    resize();

    // 视线焦点上移到「树干根部 + 墩面」之间，根系与树干都能进画面
    focus.set(0, TRUNK_H * 0.30, 0);

    /* ---------------- 拾取 / 悬停 ---------------- */
    var ray = new THREE.Raycaster();
    var ndc = new THREE.Vector2();
    var hover = -1;

    function pick(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      var hits = ray.intersectObjects(ringMeshes, false);
      return hits.length ? hits[0].object.userData.index : -1;
    }

    function setHover(i) {
      if (hover === i) return;
      hover = i;
      for (var k = 0; k < ringMeshes.length; k++) {
        var m = ringMeshes[k];
        var on = (m.userData.index === i);
        m.material.emissive.setHex(on ? 0x8c1f28 : 0x000000);
        m.material.emissiveIntensity = on ? 0.55 : 0;
        m.position.y = m.userData.baseY + (on ? 0.02 : 0);   // 悬停抬升
        m.material.opacity = (i >= 0 && !on) ? 0.45 : 1;
        m.material.transparent = (i >= 0 && !on);
      }
    }

    function showTip(i, e) {
      var era = eras[i];
      tip.innerHTML = '<b>' + esc(era.year) + '　' + esc(era.title) + '</b><span>' + esc(era.event) + '</span>';
      tip.classList.add('on');
      var rect = stage.getBoundingClientRect();
      var x = clamp(e.clientX - rect.left, 110, rect.width - 110);
      var y = Math.max(56, e.clientY - rect.top);
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }
    function hideTip() { tip.classList.remove('on'); }

    function go(era) { location.href = 'era.html?era=' + era.id; }

    canvas.addEventListener('pointermove', function (e) {
      if (ctrl.dragging()) { hideTip(); return; }
      var i = pick(e.clientX, e.clientY);
      canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
      if (i !== hover) { setHover(i); }
      if (i >= 0) showTip(i, e); else hideTip();
    });
    canvas.addEventListener('pointerleave', function () {
      if (!ctrl.dragging()) { setHover(-1); hideTip(); }
    });
    canvas.addEventListener('click', function (e) {
      if (ctrl.moved()) return;
      var i = pick(e.clientX, e.clientY);
      if (i >= 0) go(eras[i]);
    });

    /* ---------------- 渲染循环 ---------------- */
    var clock = new THREE.Clock();
    var intro = reduceMotion ? 1 : 0;      // 生长/入镜进度
    function frame() {
      var dt = Math.min(clock.getDelta(), 0.05);
      if (intro < 1) {
        intro = Math.min(1, intro + dt / 1.1);
        var e = 1 - Math.pow(1 - intro, 3);
        root.scale.setScalar(0.86 + 0.14 * e);
        root.position.y = (1 - e) * 0.25;
      }
      ctrl.update(dt);
      ctrl.apply(camera, focus);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    /* ---------------- 上下文丢失自恢复 ---------------- */
    canvas.addEventListener('webglcontextlost', function (e) {
      if (e && e.preventDefault) e.preventDefault();
    }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      woodTex.needsUpdate = true; woodTexB.needsUpdate = true; barkTex.needsUpdate = true;
    }, false);

    stage.classList.add('stump3d-ready');

    // 便于自动化检查（无副作用）
    window.__stump3d = {
      THREE: THREE, renderer: renderer, scene: scene, camera: camera,
      rings: ringMeshes.length,
      get hover() { return hover; },
      setHover: setHover,
      goIndex: function (i) { if (eras[i]) go(eras[i]); }
    };
  }

  /* ================================================================== */
  /* 裂缝规格：把圆周切成若干不规则楔块                                   */
  /* ================================================================== */
  function buildCrackSpecs(count, seed) {
    var rnd = mulberry32(seed);
    var out = [];
    var weights = [];
    var sum = 0;
    for (var i = 0; i < count; i++) { var w = 0.7 + rnd() * 0.9; weights.push(w); sum += w; }
    var acc = rnd() * Math.PI * 2;
    var base = [];
    for (var j = 0; j < count; j++) { base.push(acc); acc += (weights[j] / sum) * Math.PI * 2; }
    for (var k = 0; k < count; k++) {
      out.push({
        a: base[k],
        wob: 0.018 + rnd() * 0.03,
        wobK: 3 + ((rnd() * 5) | 0),
        wobP: rnd() * 6.28,
        jag: 0.006 + rnd() * 0.014
      });
    }
    return out;
  }

  /* ================================================================== */
  /* 年轮起伏：每圈是一条凸起的脊，圈与圈之间不规则凹陷                    */
  /* ================================================================== */
  function buildRingRelief(n, R, CORE_R) {
    var rnd = mulberry32(551122);
    var bands = [];
    for (var i = 0; i < n; i++) {
      bands.push({
        peak: 0.028 + rnd() * 0.022,     // 该圈脊的凸起高度
        skew: rnd() * 0.5 - 0.25,        // 脊峰偏向环带内的位置（不规则）
        dip: 0.012 + rnd() * 0.016       // 与下一圈之间的凹陷深度
      });
    }
    return function (r) {
      if (!isFinite(r)) return 0;
      var t = (r - CORE_R) / (R - CORE_R);
      if (t <= 0) return 0.02;
      if (t >= 1) { t = 1; }
      var idx = t * n;                 // 0..n
      var bi = Math.min(n - 1, Math.floor(idx));
      var f = Math.min(0.999, Math.max(0, idx - bi));
      var band = bands[bi];
      var peakAt = 0.5 + band.skew;
      var ridge = Math.exp(-Math.pow((f - peakAt) / 0.30, 2)) * band.peak;
      var groove = -band.dip * (1 - Math.exp(-Math.pow((f - peakAt) / 0.34, 2)));
      return ridge + groove;
    };
  }

  /* ================================================================== */
  /* 扇形顶面 / 底面 / 凸起年轮脊 / 树皮墙 / 裂缝内壁                      */
  /* ================================================================== */
  function sectorTopGeometry(a0, a1, profile, R, y, relief, n, CORE_R) {
    var RINGS = 26;
    var positions = [], normals = [], uvs = [], indices = [];
    var steps = Math.max(6, Math.round((a1 - a0) / (Math.PI * 2) * SEG));
    for (var ri = 0; ri <= RINGS; ri++) {
      var rr = CORE_R * 0.2 + (R - CORE_R * 0.2) * (ri / RINGS);
      for (var ai = 0; ai <= steps; ai++) {
        var a = a0 + (a1 - a0) * (ai / steps);
        var k = profileAt(profile, a);
        var rEff = rr < R * 0.94 ? rr : rr * k;
        var h = relief(rEff);
        positions.push(Math.cos(a) * rEff, y + h, Math.sin(a) * rEff);
        normals.push(0, 1, 0);
        uvs.push(ai / steps, ri / RINGS);
      }
    }
    var rowLen = steps + 1;
    for (var ri2 = 0; ri2 < RINGS; ri2++) {
      for (var ai2 = 0; ai2 < steps; ai2++) {
        var b = ri2 * rowLen + ai2;
        indices.push(b, b + 1, b + rowLen, b + 1, b + rowLen + 1, b + rowLen);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  function sectorDiscGeometry(a0, a1, profile, R, y) {
    var positions = [], normals = [], uvs = [], indices = [];
    var steps = Math.max(6, Math.round((a1 - a0) / (Math.PI * 2) * SEG));
    for (var ai = 0; ai <= steps; ai++) {
      var a = a0 + (a1 - a0) * (ai / steps);
      var k = profileAt(profile, a);
      positions.push(0, y, 0);
      positions.push(Math.cos(a) * R * k, y, Math.sin(a) * R * k);
      normals.push(0, -1, 0, 0, -1, 0);
      uvs.push(0.5, 0.5, ai / steps, 1);
    }
    for (var ai2 = 0; ai2 < steps; ai2++) {
      var b = ai2 * 2;
      indices.push(b, b + 3, b + 1, b + 1, b + 3, b + 2);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  function raisedRingGeometry(r0, r1, a0, a1, profile, relief, bandIndex, n) {
    var RADIAL = 6;
    var positions = [], normals = [], uvs = [], indices = [];
    var steps = Math.max(5, Math.round((a1 - a0) / (Math.PI * 2) * SEG));
    for (var ri = 0; ri <= RADIAL; ri++) {
      var rr = r0 + (r1 - r0) * (ri / RADIAL);
      var h = relief(rr);
      for (var ai = 0; ai <= steps; ai++) {
        var a = a0 + (a1 - a0) * (ai / steps);
        positions.push(Math.cos(a) * rr, h, Math.sin(a) * rr);
        normals.push(0, 1, 0);
        uvs.push(ai / steps, ri / RADIAL);
      }
    }
    var rowLen = steps + 1;
    for (var ri2 = 0; ri2 < RADIAL; ri2++) {
      for (var ai2 = 0; ai2 < steps; ai2++) {
        var b = ri2 * rowLen + ai2;
        indices.push(b, b + 1, b + rowLen, b + 1, b + rowLen + 1, b + rowLen);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  /* ================================================================== */
  /* 树干：截面之上继续生长的实心躯干（含树心内芯）                        */
  /* ------------------------------------------------------------------ */
  /* 这个几何体同时承担两个作用：
     1. 从树桩顶面往上长出一段真实树干，让「树桩」看起来属于一棵树；
     2. 它比木墩略大一点、填满分块之间的缝隙，
        这样裂缝里露出来的是实心木芯，而不是里面空心的「内壁」。 */
  function trunkBodyGeometry(height, radius, feetProfile, sideProfile, yBase, yTop, inner) {
    var positions = [], normals = [], uvs = [], indices = [];
    var VSEG = 10;
    var flare = 0.06;                 // 根部外扩
    for (var ai = 0; ai <= SEG; ai++) {
      var a = ai / SEG * Math.PI * 2;
      var kf = profileAt(feetProfile, a);
      var ks = profileAt(sideProfile, a);
      for (var vi = 0; vi <= VSEG; vi++) {
        var f = vi / VSEG;
        // 底部外扩（板根过渡），往上收细并带纵向起伏
        var r = radius * kf * ks * (1 + flare * Math.pow(1 - f, 2.2) - 0.10 * f);
        var y = lerp(yBase, yTop, f);
        positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
        normals.push(Math.cos(a), 0.12, Math.sin(a));
        uvs.push(ai / SEG * 3, f * 2.2);
      }
    }
    var rowLen = VSEG + 1;
    for (var ai2 = 0; ai2 < SEG; ai2++) {
      for (var vi2 = 0; vi2 < VSEG; vi2++) {
        var b = ai2 * rowLen + vi2;
        indices.push(b, b + rowLen, b + 1, b + 1, b + rowLen, b + rowLen + 1);
      }
    }
    // 顶盖：封闭树干顶端，避免从上往下看穿中空
    var capBase = positions.length / 3;
    positions.push(0, yTop, 0);
    normals.push(0, 1, 0);
    uvs.push(0.5, 0.5);
    for (var ai3 = 0; ai3 <= SEG; ai3++) {
      var a3 = ai3 / SEG * Math.PI * 2;
      var kf3 = profileAt(feetProfile, a3), ks3 = profileAt(sideProfile, a3);
      var r3 = radius * kf3 * ks3 * (1 - 0.10);
      positions.push(Math.cos(a3) * r3, yTop, Math.sin(a3) * r3);
      normals.push(0, 1, 0);
      uvs.push(0.5 + Math.cos(a3) * 0.5, 0.5 + Math.sin(a3) * 0.5);
    }
    for (var ai4 = 0; ai4 < SEG; ai4++) {
      indices.push(capBase, capBase + 1 + ai4, capBase + 2 + ai4);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  function sideWallSectorGeometry(a0, a1, profile, R, thickness, seed) {
    var VSEG = 5;
    var rnd = mulberry32(9000 + seed * 131);
    var positions = [], normals = [], uvs = [], indices = [];
    var steps = Math.max(5, Math.round((a1 - a0) / (Math.PI * 2) * SEG));
    var y0 = -thickness / 2, y1 = thickness / 2;
    var bumps = [];
    for (var t = 0; t <= steps; t++) bumps.push((rnd() - 0.5) * 0.028);
    for (var ai = 0; ai <= steps; ai++) {
      var a = a0 + (a1 - a0) * (ai / steps);
      var k = profileAt(profile, a);
      var bump = bumps[ai];
      for (var vi = 0; vi <= VSEG; vi++) {
        var f = vi / VSEG;
        var y = lerp(y0, y1, f);
        var mid = Math.sin(f * Math.PI) * 0.5 + 0.5;
        var r = (R * k + bump * mid);
        positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
        normals.push(Math.cos(a), 0, Math.sin(a));
        uvs.push(ai / steps, f);
      }
    }
    var rowLen = VSEG + 1;
    for (var ai2 = 0; ai2 < steps; ai2++) {
      for (var vi2 = 0; vi2 < VSEG; vi2++) {
        var b = ai2 * rowLen + vi2;
        indices.push(b, b + rowLen, b + 1, b + 1, b + rowLen, b + rowLen + 1);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  function crackWallGeometry(baseAngle, gap, profile, R, thickness, dir) {
    var positions = [], normals = [], uvs = [], indices = [];
    var y0 = -thickness / 2, y1 = thickness / 2;
    var a = baseAngle + (dir > 0 ? gap * 0.5 : -gap * 0.5);
    var r0 = R * 0.02, r1 = R * 1.0;
    var steps = 10;
    for (var i = 0; i <= steps; i++) {
      var f = i / steps;
      var r = lerp(r0, r1, f);
      var x = Math.cos(a) * r, z = Math.sin(a) * r;
      positions.push(x, y0, z);
      positions.push(x, y1, z);
      var nx = -Math.sin(a) * dir, nz = Math.cos(a) * dir;
      normals.push(nx, 0, nz, nx, 0, nz);
      uvs.push(f, 0, f, 1);
    }
    for (var j = 0; j < steps; j++) {
      var b = j * 2;
      indices.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  /* ================================================================== */
  /* 树根：从墩底向外抓地的锥形根 + 隆起根盘                              */
  /* ------------------------------------------------------------------ */
  /* 不用固定条数、不用均分角度：数量随机 7—11 条，角度带较大抖动，
     粗细/长短/下探/弯曲各不相同，并让相邻根在根部互相交叠，
     看起来是一圈自然生长的板根，而不是「一圈等分的爪子」。 */
  function buildRoots(root, R, THICK, ROOT_R, barkMat, cortexMat, seed) {
    var rnd = mulberry32(seed + 7);
    var yBase = -THICK / 2;

    var collar = new THREE.Mesh(
      rootCollarGeometry(R * 0.96, ROOT_R * 0.80, yBase, 0.11, seed), barkMat);
    collar.castShadow = true; collar.receiveShadow = true;
    root.add(collar);

    // 主根：条数随机，角度不均匀分布
    var mainCount = 7 + Math.floor(rnd() * 5);      // 7—11 条
    var angles = [];
    for (var i = 0; i < mainCount; i++) {
      // 基准均分 + 大抖动，再整体随机旋转一次
      var base = (i / mainCount) * Math.PI * 2 + (rnd() - 0.5) * 1.15;
      angles.push(base + (rnd() - 0.5) * 0.4);
    }
    for (var m = 0; m < mainCount; m++) {
      var a = angles[m];
      var lenJit = 0.72 + rnd() * 0.55;             // 长短差异明显
      var geo = rootTendrilGeometry(a, R * (0.86 + rnd() * 0.14), ROOT_R * lenJit,
        yBase + (rnd() - 0.5) * 0.03, rnd, 0.82 + rnd() * 0.5);
      var mesh = new THREE.Mesh(geo, rnd() < 0.55 ? barkMat : cortexMat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      root.add(mesh);
    }
    // 次级细根：数量也随机，插在主根之间、更细更短
    var secCount = 4 + Math.floor(rnd() * 5);
    for (var k = 0; k < secCount; k++) {
      var a2 = rnd() * Math.PI * 2;
      var geo2 = rootTendrilGeometry(a2, R * (0.45 + rnd() * 0.25),
        ROOT_R * (0.55 + rnd() * 0.5), yBase - 0.02 - rnd() * 0.04, rnd,
        0.34 + rnd() * 0.3);
      var m2 = new THREE.Mesh(geo2, barkMat);
      m2.castShadow = true;
      root.add(m2);
    }
  }

  function rootCollarGeometry(rIn, rOut, y, drop, seed) {
    var positions = [], normals = [], uvs = [], indices = [];
    var rnd = mulberry32(1234 + (seed || 0));
    // 根盘外缘也不是正圆：叠加多条低频扰动
    var p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
    var k1 = 3 + Math.floor(rnd() * 3), k2 = 6 + Math.floor(rnd() * 5), k3 = 12 + Math.floor(rnd() * 6);
    var a1 = 0.07 + rnd() * 0.05, a2 = 0.035 + rnd() * 0.03, a3 = 0.015 + rnd() * 0.02;
    for (var i = 0; i <= SEG; i++) {
      var a = i / SEG * Math.PI * 2;
      var ca = Math.cos(a), sa = Math.sin(a);
      var wob = 1 + a1 * Math.sin(a * k1 + p1) + a2 * Math.sin(a * k2 + p2) + a3 * Math.sin(a * k3 + p3);
      var dropJit = drop * (0.7 + 0.6 * Math.abs(Math.sin(a * 2.3 + p1)));
      positions.push(ca * rIn, y + 0.01, sa * rIn);
      positions.push(ca * rOut * wob, y - dropJit, sa * rOut * wob);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(i / SEG, 0, i / SEG, 1);
    }
    for (var j = 0; j < SEG; j++) {
      var b = j * 2;
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  function rootTendrilGeometry(angle, rStart, rEnd, yBase, rnd, scale) {
    scale = scale || 1;
    var LEN = 16, CROSS = 7;
    var positions = [], normals = [], uvs = [], indices = [];
    var yDrop = (0.24 + rnd() * 0.16) * scale;
    // 左右摆动 + 上下起伏，让根不是一条笔直的光滑锥
    var wob = (rnd() - 0.5) * 0.9;
    var wob2 = (rnd() - 0.5) * 1.7;
    var bobAmp = (rnd() - 0.5) * 0.09;
    var thick0 = (0.055 + rnd() * 0.055) * scale;
    var thick1 = thick0 * (0.18 + rnd() * 0.16);
    var path = [];
    for (var i = 0; i <= LEN; i++) {
      var f = i / LEN;
      path.push({
        r: lerp(rStart, rEnd, Math.pow(f, 0.78 + rnd() * 0.12)),
        a: angle + wob * f * f + wob2 * Math.pow(f, 2.6),
        y: yBase - Math.pow(f, 1.25) * yDrop + Math.sin(f * 5.2) * bobAmp,
        t: lerp(thick0, thick1, Math.pow(f, 0.9)) * (1 + 0.18 * Math.sin(f * 7.3))
      });
    }
    for (var s = 0; s <= LEN; s++) {
      var p = path[s];
      var prev = path[Math.max(0, s - 1)], next = path[Math.min(LEN, s + 1)];
      var tx = Math.cos(next.a) * next.r - Math.cos(prev.a) * prev.r;
      var tz = Math.sin(next.a) * next.r - Math.sin(prev.a) * prev.r;
      var ty = next.y - prev.y;
      var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      var bx = tz, by = 0, bz = -tx;                    // 水平法向
      var bl = Math.sqrt(bx * bx + bz * bz) || 1; bx /= bl; bz /= bl;
      var cx = ty * bz - tz * by, cy = tz * bx - tx * bz, cz = tx * by - ty * bx;
      var px = Math.cos(p.a) * p.r, pz = Math.sin(p.a) * p.r;
      for (var k = 0; k <= CROSS; k++) {
        var ang = k / CROSS * Math.PI * 2;
        var ox = Math.cos(ang) * bx + Math.sin(ang) * cx;
        var oy = Math.cos(ang) * by + Math.sin(ang) * cy;
        var oz = Math.cos(ang) * bz + Math.sin(ang) * cz;
        positions.push(px + ox * p.t, p.y + oy * p.t, pz + oz * p.t);
        normals.push(ox, oy, oz);
        uvs.push(s / LEN, k / CROSS);
      }
    }
    var rowLen = CROSS + 1;
    for (var s2 = 0; s2 < LEN; s2++) {
      for (var k2 = 0; k2 < CROSS; k2++) {
        var b2 = s2 * rowLen + k2;
        indices.push(b2, b2 + rowLen, b2 + 1, b2 + 1, b2 + rowLen, b2 + rowLen + 1);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  /* ================================================================== */
  /* 相机控制：拖拽环绕（不自动旋转）                                    */
  /* ================================================================== */
  function createControls(canvas, reduceMotion) {
    var az = -0.5, el = 0.62;          // 俯视角稍大：能看清年轮面，又不会被缝隙「看穿」内部
    var tAz = az, tEl = el;
    var dragging = false, moved = false;
    var lastX = 0, lastY = 0, idle = 10;
    var baseDist = 3.4;

    canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';

    canvas.addEventListener('pointerdown', function (e) {
      dragging = true; moved = false; idle = 0;
      lastX = e.clientX; lastY = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
      tAz -= dx * 0.005;
      tEl = clamp(tEl + dy * 0.004, 0.12, 1.32);
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
      // 不自动旋转：机位固定，仅响应拖拽
      az += (tAz - az) * Math.min(1, dt * 3.4);
      el += (tEl - el) * Math.min(1, dt * 3.4);
    }
    function apply(camera, focus) {
      var d = baseDist, ce = Math.cos(el);
      camera.position.set(
        focus.x + Math.sin(az) * ce * d,
        focus.y + Math.sin(el) * d,
        focus.z + Math.cos(az) * ce * d
      );
      camera.lookAt(focus);
    }
    return {
      update: update, apply: apply,
      dragging: function () { return dragging; },
      moved: function () { return moved; },
      get baseDist() { return baseDist; },
      set baseDist(v) { baseDist = v; }
    };
  }

  /* ================================================================== */
  /* 启动                                                                */
  /* ================================================================== */
  function boot() {
    try {
      init();
    } catch (e) {
      degrade(e && e.message ? e.message : '初始化失败');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
