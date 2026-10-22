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
    g.addColorStop(0, '#6b4a30'); g.addColorStop(0.5, '#8a6440'); g.addColorStop(1, '#5a3d26');
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
    var g = ctx.createRadialGradient(c, c, S * 0.06, c, c, S * 0.42);
    g.addColorStop(0, 'rgba(38,24,14,0.30)');
    g.addColorStop(0.45, 'rgba(38,24,14,0.13)');
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

    /* 年轮指示线 + 年份标签的浮层（覆盖在画布上，坐标由 3D 投影逐帧更新） */
    var labelWrap = document.createElement('div');
    labelWrap.className = 'stump-labels';
    stage.appendChild(labelWrap);
    var svgNS = 'http://www.w3.org/2000/svg';
    var leaderSvg = document.createElementNS(svgNS, 'svg');
    leaderSvg.setAttribute('class', 'stump-leaders');
    leaderSvg.setAttribute('aria-hidden', 'true');
    labelWrap.appendChild(leaderSvg);
    var ringLabels = [];
    var canvasW = 0, canvasH = 0;

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
    // 正面补光：树皮侧壁朝向镜头时不至于发黑
    var fill = new THREE.DirectionalLight(0xfff1dc, 0.95);
    fill.position.set(-3.4, 2.4, 4.6);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xdfefff, 0.18));

    /* ---------------- 尺寸参数（场景单位） ---------------- */
    /* 照实物做：一截被锯断的老枣树桩——
       · 粗壮的树皮侧壁（底部更粗、带纵向沟壑与几道竖裂）
       · 顶面就是年轮切面（模型最高处，上面不再有任何东西）
       · 底部大板根向四周铺在草地上 */
    var R = 1.0;                 // 切面半径（不含底部外扩）
    var H = 1.02;                // 树桩高度：地面 y=0 → 年轮切面 y=H
    var TOP_Y = H;               // 年轮切面（模型最高处）
    var CAP_Y = TOP_Y - 0.082;   // 切面底板：低于年轮脊的沟底，裂缝里看到的就是它
    var RING_Y = TOP_Y - 0.050;  // 年轮脊的基准面（最高一圈脊与树皮口沿齐平）
    var CORE_R = 0.075 * R;
    var BARK_W = 0.075;          // 树皮厚度（顶面外圈那一圈树皮的宽度）
    var ROOT_R = 1.86;           // 板根最外缘
    var RS = R * 0.97;           // 树桩顶端半径（侧壁略向上收）
    var SCENE_R = Math.sqrt(ROOT_R * ROOT_R + (H * 0.62) * (H * 0.62)) * 1.02;

    var root = new THREE.Group();
    scene.add(root);

    /* 轮廓：树桩不是正圆（侧壁与切面共用同一套，保证接缝严丝合缝） */
    var profSide = wobbleProfile(20241020, 0.055);

    /* ---------------- 材质 ---------------- */
    var woodTex = makeWoodTexture(n, 4242);
    var barkTex = makeBarkTexture(31337);
    [woodTex, barkTex].forEach(function (t) {
      if (THREE.SRGBColorSpace && t.colorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities && renderer.capabilities.getMaxAnisotropy
        ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    });

    // 切面木色：年轮底色偏暖，接近实物锯口的浅褐
    var cutMat = new THREE.MeshStandardMaterial({
      map: woodTex, color: 0xe4c9a2, roughness: 0.74, metalness: 0,
      side: THREE.DoubleSide
    });
    // 树皮：颜色偏灰褐、粗糙
    var barkMat = new THREE.MeshStandardMaterial({
      map: barkTex, color: 0xcbb59a, roughness: 0.98, metalness: 0,
      side: THREE.DoubleSide
    });
    var cortexMat = new THREE.MeshStandardMaterial({ color: 0x6d4a2c, roughness: 0.98, metalness: 0 });

    /* ---------------- 裂纹：把切面分成若干块（真实裂缝，不是画上去的线） ---------------- */
    var cracksSpec = buildCrackSpecs(5, 20241020);
    var sectors = [];
    for (var si = 0; si < cracksSpec.length; si++) {
      var a0 = cracksSpec[si].a;
      var a1 = cracksSpec[(si + 1) % cracksSpec.length].a + (si === cracksSpec.length - 1 ? Math.PI * 2 : 0);
      sectors.push({ a0: a0, a1: a1 });
    }
    var crackAngles = cracksSpec.map(function (c) { return c.a; });

    /* ---------------- 桩身：实心侧壁（树皮） ---------------- */
    var ringBaseY = RING_Y;
    var RING_OUT = RS - BARK_W;                   // 切面（木芯）外缘 = 树皮内缘
    var relief = buildRingRelief(n, RING_OUT, CORE_R);   // 年轮高低起伏曲线

    var bodyMesh = new THREE.Mesh(
      stumpBodyGeometry(RS, H, profSide, crackAngles, buildRootAngles(20241020), 20241020), barkMat);
    bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
    root.add(bodyMesh);

    /* 树皮口沿：切面外圈的一圈树皮，略高于木芯 —— 真实树桩锯断后就是这样 */
    var rimMesh = new THREE.Mesh(
      barkRimGeometry(RS, BARK_W, TOP_Y, profSide, 20241020), barkMat);
    rimMesh.castShadow = true; rimMesh.receiveShadow = true;
    root.add(rimMesh);

    /* ---------------- 切面底板：一个完整的实心圆盘，封住顶面 ---------------- */
    /* 它低于年轮脊，因此块与块之间的裂缝里露出的是这层木芯，
       绝不会看穿到树桩内部；同时给年轮沟底一个有质感的底。 */
    var capMesh = new THREE.Mesh(
      capDiscGeometry(RING_OUT * 0.999, CAP_Y, profSide, 20241020), cutMat);
    capMesh.receiveShadow = true;
    root.add(capMesh);

    /* ---------------- 11 圈年轮（凸起的脊，可拾取） ---------------- */
    var ringMeshes = [];
    for (var i = 0; i < n; i++) {
      var r0 = CORE_R + (RING_OUT - CORE_R) * (i / n);
      var r1 = CORE_R + (RING_OUT - CORE_R) * ((i + 1) / n);
      var col = new THREE.Color(COLORS[i % COLORS.length]);
      // 每块年轮独立成 mesh（跟随块间裂缝断开）
      for (var s2 = 0; s2 < sectors.length; s2++) {
        var sc = sectors[s2];
        var g2 = 0.012 + (s2 % 3) * 0.005;
        var rg = raisedRingGeometry(r0, r1, sc.a0 + g2, sc.a1 - g2, profSide, relief, i, n, RING_OUT, CORE_R);
        var mat = new THREE.MeshStandardMaterial({
          color: col, roughness: 0.82, metalness: 0,
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
      var g3 = 0.012 + (s3 % 3) * 0.005;
      var cg = raisedRingGeometry(0, CORE_R * 0.9, sc3.a0 + g3, sc3.a1 - g3, profSide, relief, 0, n, RING_OUT, CORE_R);
      var cm = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({
        color: 0xc9a877, roughness: 0.86, metalness: 0
      }));
      cm.position.y = ringBaseY + 0.004;
      cm.userData = { index: -1, sector: s3, baseY: ringBaseY + 0.004 };
      root.add(cm);
    }

    /* ---------------- 板根：从桩底向四周铺在草地上 ---------------- */
    buildRoots(root, RS, H, ROOT_R, barkMat, cortexMat, crackAngles, 20241020);

    /* ---------------- 接影地面：让树桩「落在草地上」 ---------------- */
    var groundTex = makeGroundShadowTexture();
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOT_R * 2.5, ROOT_R * 2.5),
      new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, depthWrite: false })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.004;
    scene.add(ground);

    /* ---------------- 每圈年轮一根指示线 + 年份标签 ---------------- */
    /* 标签用 HTML（文字清晰、可点），指示线用 SVG；
       两者的坐标每帧由 3D 投影算出来，所以拖动转动树桩时会跟着走。 */
    for (var li = 0; li < n; li++) {
      (function (idx) {
        var halo = document.createElementNS(svgNS, 'polyline');
        halo.setAttribute('class', 'stump-leader-halo');
        leaderSvg.appendChild(halo);

        var line = document.createElementNS(svgNS, 'polyline');
        line.setAttribute('class', 'stump-leader');
        leaderSvg.appendChild(line);

        var dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('class', 'stump-leader-dot');
        dot.setAttribute('r', '2.6');
        leaderSvg.appendChild(dot);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'stump-label';
        btn.textContent = eras[idx].year;
        btn.setAttribute('title', eras[idx].year + '　' + eras[idx].title);
        btn.setAttribute('aria-label',
          eras[idx].year + '　' + eras[idx].title + '：进入这一年的故事');
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          go(eras[idx], idx);
        });
        btn.addEventListener('pointerenter', function () { setHover(idx); });
        btn.addEventListener('pointerleave', function () { setHover(-1); });
        labelWrap.appendChild(btn);

        ringLabels.push({
          i: idx,
          el: btn,
          line: line,
          halo: halo,
          dot: dot,
          // 每圈取一个固定方位角，11 圈均匀散开，转动时跟着木头一起转
          ang: -Math.PI / 2 + (idx / n) * Math.PI * 2 + 0.28,
          rMid: CORE_R + (RING_OUT - CORE_R) * ((idx + 0.5) / n)
        });
      })(li);
    }

    /* ---------------- 相机控制 ---------------- */
    var ctrl = createControls(canvas, reduceMotion);

    // 视线焦点放在桩身中下部：在画布里把树桩整体往上抬，板根不会被切出画外
    // （必须在 resize() 之前设置，resize 会据此计算取景距离）
    focus.set(0, H * 0.10, 0);

    function resize() {
      var w = stage.clientWidth || 560;
      var wrap = stage.parentNode;
      var wrapH = wrap && wrap.clientHeight ? wrap.clientHeight : 0;
      // 画布取「横向长一点」的矩形：树桩是扁宽的，方画布上下会浪费一大截
      var cw = Math.min(w, 1020);
      var ch = Math.round(cw * 0.70);
      if (wrapH && ch > wrapH) {
        ch = Math.round(wrapH);
        cw = Math.round(ch / 0.70);
      }
      cw = Math.max(320, Math.min(cw, w));
      canvas.style.width = cw + 'px';
      canvas.style.height = ch + 'px';
      canvasW = cw; canvasH = ch;
      // 浮层与画布严格对齐（画布在 stage 里水平居中）
      labelWrap.style.left = Math.round((w - cw) / 2) + 'px';
      labelWrap.style.top = '0px';
      labelWrap.style.width = cw + 'px';
      labelWrap.style.height = ch + 'px';
      // 先把标签量一遍尺寸（此时浮层还可见），再做窄屏隐藏判断
      for (var q = 0; q < ringLabels.length; q++) {
        ringLabels[q].w = ringLabels[q].el.offsetWidth || 46;
        ringLabels[q].h = ringLabels[q].el.offsetHeight || 22;
      }
      labelWrap.classList.toggle('stump-labels-off', cw < 620 || !ringLabels.length);
      renderer.setSize(cw, ch, false);
      camera.aspect = cw / ch;
      // 取景：按树桩实际的横向/纵向半尺寸算距离，横竖都不要出画
      var tanV = Math.tan(camera.fov * Math.PI / 360);
      var halfW = SCENE_R * 0.85, halfH = SCENE_R * 0.60;
      var dW = halfW / (0.89 * tanV * camera.aspect);
      var dH = halfH / (0.96 * tanV);
      ctrl.baseDist = Math.max(dW, dH);
      camera.updateProjectionMatrix();
    }
    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(stage);
      if (stage.parentNode) new ResizeObserver(resize).observe(stage.parentNode);
    }
    window.addEventListener('resize', resize);
    resize();

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
      for (var q = 0; q < ringLabels.length; q++) {
        var onq = (ringLabels[q].i === i);
        ringLabels[q].el.classList.toggle('on', onq);
        ringLabels[q].line.classList.toggle('on', onq);
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

    /* ---------------- 点击年轮：先推近这一圈，再淡出换页 ---------------- */
    var flying = false;

    function easeInOutCubic(x) {
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }

    // 整页纸色遮罩：铺满视口，换页前把画面淡掉
    function fadeLayer() {
      var el = document.getElementById('stumpFade');
      if (!el) {
        el = document.createElement('div');
        el.id = 'stumpFade';
        el.className = 'stump-fade';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
      }
      return el;
    }

    function flyToRing(idx, done) {
      var L = ringLabels[idx];
      if (!L) { if (done) done(); return; }
      // 目标点 = 这一圈年轮在切面上的落点（和指示线起点同一个点）
      var to = new THREE.Vector3(
        Math.cos(L.ang) * L.rMid,
        TOP_Y + relief(L.rMid),
        Math.sin(L.ang) * L.rMid
      );
      root.localToWorld(to);
      var from = focus.clone();
      var d0 = ctrl.baseDist;
      var d1 = Math.max(1.0, d0 * 0.28);       // 收到很近：这一圈年轮在画面中间占一大块
      var dur = 900;
      flying = true;
      stage.classList.add('stump-flying');
      canvas.style.pointerEvents = 'none';
      hideTip();
      setHover(idx);                            // 选中的那圈保持高亮
      var t0 = performance.now();
      (function step(now) {
        var k = Math.min(1, (now - t0) / dur);
        var e = easeInOutCubic(k);
        focus.copy(from).lerp(to, e);
        ctrl.baseDist = d0 + (d1 - d0) * e;
        if (k < 1) requestAnimationFrame(step);
        else if (done) done();
      })(t0);
    }

    function go(era, idx) {
      var url = 'era.html?era=' + era.id;
      if (flying) return;
      // 减少动态效果 / 没有对应年轮（如年轮序号异常）时直接跳转
      if (reduceMotion || typeof idx !== 'number' || idx < 0) { location.href = url; return; }
      flyToRing(idx, function () {
        try { sessionStorage.setItem('nav3d', '1'); } catch (err) { }
        var ov = fadeLayer();
        void ov.offsetWidth;                    // 先落到初始态，过渡才会生效
        ov.classList.add('on');
        setTimeout(function () { location.href = url; }, 430);
      });
    }

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
      if (i >= 0) go(eras[i], i);
    });

    /* ---------------- 指示线 / 年份标签：逐帧按 3D 投影更新 ---------------- */
    var _pv = new THREE.Vector3();
    function screenOf(x, y, z) {
      _pv.set(x, y, z);
      root.localToWorld(_pv);
      _pv.project(camera);
      return { x: (_pv.x * 0.5 + 0.5) * canvasW, y: (-_pv.y * 0.5 + 0.5) * canvasH };
    }

    var labelsOn = false;
    function updateLabels() {
      if (!ringLabels.length || !canvasW) return;
      var on = canvasW >= 620;
      if (on !== labelsOn) {
        labelsOn = on;
        labelWrap.classList.toggle('stump-labels-off', !on);
      }
      if (!on) return;
      labelWrap.classList.add('stump-labels-in');

      var W = canvasW, H = canvasH;

      // 切面外缘在屏幕上的包围盒 → 当作标注椭圆（轴对齐，排版用）
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (var k = 0; k < 24; k++) {
        var a = (k / 24) * Math.PI * 2;
        var p = screenOf(Math.cos(a) * RING_OUT, TOP_Y, Math.sin(a) * RING_OUT);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      var rx = Math.max(40, (maxX - minX) / 2), ry = Math.max(24, (maxY - minY) / 2);

      // 切面本身贴着画面上沿，标注环整体下移一点，顶部才不至于被裁掉
      var shiftY = Math.min(90, Math.max(0, 48 - (cy - (ry + 52))));
      cy += shiftY;

      // 1) 每圈在年轮上的落点 + 投影方位角
      var items = [];
      for (var j = 0; j < ringLabels.length; j++) {
        var L = ringLabels[j];
        var A = screenOf(Math.cos(L.ang) * L.rMid, TOP_Y + relief(L.rMid), Math.sin(L.ang) * L.rMid);
        var th = Math.atan2((A.y - cy) / ry, (A.x - cx) / rx);
        items.push({ L: L, ax: A.x, ay: A.y, th: th, w: L.w || 48, h: L.h || 22 });
      }

      // 2) 标注环：比切面外扩一圈，沿「弧长」均分标签。
      //    切面是压扁的椭圆，按角度均分会让上下两端挤成一疙瘩，按弧长才匀。
      var Rx = rx + 58, Ry = ry + 52;
      var SEG = 240, sx = [], sy = [], cum = [0];
      for (var s1 = 0; s1 <= SEG; s1++) {
        var t1 = (s1 / SEG) * Math.PI * 2;
        var qx = cx + Math.cos(t1) * Rx, qy = cy + Math.sin(t1) * Ry;
        sx.push(qx); sy.push(qy);
        if (s1) {
          var ddx = qx - sx[s1 - 1], ddy = qy - sy[s1 - 1];
          cum.push(cum[s1 - 1] + Math.sqrt(ddx * ddx + ddy * ddy));
        }
      }
      var Ltotal = cum[SEG];

      // 各圈在标注环上的理想弧长位置
      for (j = 0; j < items.length; j++) {
        var tt = items[j].th; if (tt < 0) tt += Math.PI * 2;
        var f = (tt / (Math.PI * 2)) * SEG;
        var i0 = Math.min(SEG - 1, Math.floor(f)), fr = f - i0;
        items[j].s = cum[i0] + (cum[i0 + 1] - cum[i0]) * fr;
      }
      items.sort(function (p1, q1) { return p1.s - q1.s; });

      // 3) 环形松弛：相邻标签沿弧长保持间距，避免叠在一起（顺序不变 → 线不乱穿）
      var n2 = items.length;
      var gap = 62;
      for (var it2 = 0; it2 < 80; it2++) {
        var moved = 0;
        for (var k2 = 0; k2 < n2; k2++) {
          var nxt = (k2 + 1 < n2) ? items[k2 + 1].s : items[0].s + Ltotal;
          var d2 = nxt - items[k2].s;
          if (d2 < gap) {
            var push = (gap - d2) / 2;
            items[k2].s -= push;
            if (k2 + 1 < n2) items[k2 + 1].s += push; else items[0].s += push;
            moved += push;
          }
        }
        if (moved < 0.02) break;
      }

      // 弧长 → 椭圆上的点
      function posOfArc(sArc) {
        sArc = ((sArc % Ltotal) + Ltotal) % Ltotal;
        var lo = 0, hi = SEG;
        while (lo + 1 < hi) {
          var mid = (lo + hi) >> 1;
          if (cum[mid] <= sArc) lo = mid; else hi = mid;
        }
        var seg = (cum[hi] - cum[lo]) || 1;
        var fr2 = (sArc - cum[lo]) / seg;
        return { x: sx[lo] + (sx[hi] - sx[lo]) * fr2, y: sy[lo] + (sy[hi] - sy[lo]) * fr2 };
      }

      // 4) 落位 + 画指示线
      for (var m3 = 0; m3 < items.length; m3++) {
        var it = items[m3], Lb = it.L;
        var p2 = posOfArc(it.s);
        it.x = clamp(p2.x, 6 + it.w / 2, W - 6 - it.w / 2);
        it.y = clamp(p2.y, 6 + it.h / 2, H - 6 - it.h / 2);

        Lb.el.style.transform =
          'translate(' + it.x.toFixed(1) + 'px,' + it.y.toFixed(1) + 'px) translate(-50%,-50%)';

        // 线段终点：标签朝树心一侧的边框上
        var dx = cx - it.x, dy = cy - it.y;
        var tEdge = Math.min(
          Math.abs(dx) > 0.01 ? (it.w / 2 + 4) / Math.abs(dx) : 1e9,
          Math.abs(dy) > 0.01 ? (it.h / 2 + 4) / Math.abs(dy) : 1e9
        );
        var ex = it.x + dx * tEdge, ey = it.y + dy * tEdge;

        var pts = it.ax.toFixed(1) + ',' + it.ay.toFixed(1) + ' ' +
                  ex.toFixed(1) + ',' + ey.toFixed(1);
        Lb.line.setAttribute('points', pts);
        Lb.halo.setAttribute('points', pts);
        Lb.line.setAttribute('class', 'stump-leader' + (hover === Lb.i ? ' on' : ''));
        Lb.dot.setAttribute('cx', it.ax.toFixed(1));
        Lb.dot.setAttribute('cy', it.ay.toFixed(1));
      }
    }

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
      updateLabels();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    /* ---------------- 上下文丢失自恢复 ---------------- */
    canvas.addEventListener('webglcontextlost', function (e) {
      if (e && e.preventDefault) e.preventDefault();
    }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      woodTex.needsUpdate = true; barkTex.needsUpdate = true;
    }, false);

    stage.classList.add('stump3d-ready');

    // 便于自动化检查（无副作用）
    window.__stump3d = {
      THREE: THREE, renderer: renderer, scene: scene, camera: camera,
      rings: ringMeshes.length,
      get hover() { return hover; },
      setHover: setHover,
      goIndex: function (i) { if (eras[i]) go(eras[i], i); },
      labels: function () { return ringLabels; },
      // 手动推一帧（后台标签 rAF 会暂停，自动化检查时用）
      tick: function (dt) {
        ctrl.update(dt || 0.016);
        ctrl.apply(camera, focus);
        camera.updateMatrixWorld();
        renderer.render(scene, camera);
        updateLabels();
      }
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
  /* 桩身侧壁：树皮面                                                     */
  /* ------------------------------------------------------------------ */
  /* 从地面 y=0 一路长到年轮切面 y=H：
     · 底部外扩（板根过渡），到顶面略收 → 像一截真实树桩而不是圆柱；
     · 纵向沟壑用几条不同频率的正弦叠加，模拟树皮纹理；
     · 在切面裂缝的角度上，上半段向里收出一道竖裂（树皮开裂）。 */
  function stumpBodyGeometry(R, H, profile, crackAngles, rootAngles, seed) {
    var VSEG = 22;
    var rnd = mulberry32(seed + 77);
    var positions = [], normals = [], uvs = [], indices = [];
    var ph1 = rnd() * 6.28, ph2 = rnd() * 6.28, ph3 = rnd() * 6.28;
    var f1 = 11 + Math.floor(rnd() * 5), f2 = 23 + Math.floor(rnd() * 7),
      f3 = 41 + Math.floor(rnd() * 9);
    var cracks = crackAngles || [];
    var roots = rootAngles || [];
    for (var ai = 0; ai <= SEG; ai++) {
      var a = ai / SEG * Math.PI * 2;
      var k = profileAt(profile, a);
      // 竖向裂缝强度：取最近的裂口角度
      var notch = 0;
      for (var c = 0; c < cracks.length; c++) {
        var d = Math.abs(a - cracks[c]) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        notch = Math.max(notch, Math.exp(-Math.pow(d / 0.055, 2)));
      }
      // 板根隆起：底部在每个根的角度向外鼓出一道厚实的根肩
      var bump = 0;
      for (var c2 = 0; c2 < roots.length; c2++) {
        var d2 = Math.abs(a - roots[c2].a) % (Math.PI * 2);
        if (d2 > Math.PI) d2 = Math.PI * 2 - d2;
        bump += roots[c2].s * Math.exp(-Math.pow(d2 / 0.24, 2));
      }
      for (var vi = 0; vi <= VSEG; vi++) {
        var f = vi / VSEG;
        var y = f * H;
        var flare = 1 + 0.14 * Math.pow(1 - f, 2.6);
        // 只在靠近地面的三分之一长根肩，越接近地面越向外鼓
        var rf = Math.pow(Math.max(0, 1 - f / 0.34), 1.6);
        var rootFlare = 1 + 0.40 * rf * Math.min(1.5, bump);
        var furrow = 1 + 0.014 * Math.sin(a * f1 + ph1 + f * 0.8)
          + 0.008 * Math.sin(a * f2 + ph2 - f * 1.3)
          + 0.005 * Math.sin(a * f3 + ph3 + f * 2.1);
        var topness = clamp((f - 0.35) / 0.55, 0, 1);
        var crevice = 1 - 0.075 * notch * topness * topness;
        var r = R * k * flare * rootFlare * furrow * crevice;
        // 最上一圈严格等于 R*k：让树皮口沿与年轮切面外缘严丝合缝
        if (vi === VSEG) r = R * k;
        positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
        normals.push(Math.cos(a), 0, Math.sin(a));
        uvs.push(ai / SEG * 4, f * 2.4);
      }
    }
    var rowLen = VSEG + 1;
    for (var ai2 = 0; ai2 < SEG; ai2++) {
      for (var vi2 = 0; vi2 < VSEG; vi2++) {
        var b = ai2 * rowLen + vi2;
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
  /* 切面底板：完整的实心圆盘，封住顶面                                   */
  /* ================================================================== */
  /* 低于年轮脊约 0.034，所以：
     · 块与块之间的裂缝里露出的是这层木芯，不会看穿到树桩内部；
     · 年轮之间的沟槽也有一个有质感的底。 */
  function capDiscGeometry(R, y, profile, seed) {
    var RINGS = 16;
    var positions = [], normals = [], uvs = [], indices = [];
    positions.push(0, y + 0.006, 0);
    normals.push(0, 1, 0);
    uvs.push(0.5, 0.5);
    var ringStart = [];
    for (var ri = 1; ri <= RINGS; ri++) {
      var fr = ri / RINGS;
      ringStart.push(positions.length / 3);
      for (var ai = 0; ai <= SEG; ai++) {
        var a = ai / SEG * Math.PI * 2;
        var k = profileAt(profile, a);
        var r = R * k * fr;
        positions.push(Math.cos(a) * r, y + (1 - fr) * 0.006, Math.sin(a) * r);
        normals.push(0, 1, 0);
        uvs.push(0.5 + Math.cos(a) * fr * 0.5, 0.5 + Math.sin(a) * fr * 0.5);
      }
    }
    var s0 = ringStart[0];
    for (var ai2 = 0; ai2 < SEG; ai2++) {
      indices.push(0, s0 + ai2 + 1, s0 + ai2);
    }
    for (var ri2 = 0; ri2 < RINGS - 1; ri2++) {
      var p0 = ringStart[ri2], p1 = ringStart[ri2 + 1];
      for (var ai3 = 0; ai3 < SEG; ai3++) {
        indices.push(p0 + ai3, p0 + ai3 + 1, p1 + ai3,
          p0 + ai3 + 1, p1 + ai3 + 1, p1 + ai3);
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

  /* 凸起年轮脊：一圈年轮的一段扇环（可独立拾取） */
  function raisedRingGeometry(r0, r1, a0, a1, profile, relief, bandIndex, n, faceR, coreR) {
    var RADIAL = 6;
    var positions = [], normals = [], uvs = [], indices = [];
    var steps = Math.max(5, Math.round((a1 - a0) / (Math.PI * 2) * SEG));
    for (var ri = 0; ri <= RADIAL; ri++) {
      var rr = r0 + (r1 - r0) * (ri / RADIAL);
      var h = relief(rr);
      for (var ai = 0; ai <= steps; ai++) {
        var a = a0 + (a1 - a0) * (ai / steps);
        // 越靠外缘越贴合树桩轮廓（最外圈与树皮内缘严丝合缝）
        var kk = profileAt(profile, a);
        var ramp = clamp((rr - coreR) / ((faceR - coreR) || 1), 0, 1);
        var rEff = rr * (1 + (kk - 1) * ramp * ramp);
        positions.push(Math.cos(a) * rEff, h, Math.sin(a) * rEff);
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
  /* 树皮口沿：切面外圈那一圈真实树皮                                    */
  /* ------------------------------------------------------------------ */
  /* 从侧壁顶端向上翻起一道圆润的树皮唇，内缘低于木芯，              */
  /* 于是年轮切面看起来「嵌」在树皮里，而不是贴在柱顶。               */
  function barkRimGeometry(R, w, y, profile, seed) {
    var positions = [], normals = [], uvs = [], indices = [];
    var rings = [
      { r: R, dy: -0.030 },              // 与侧壁顶端接续
      { r: R, dy: 0.012 },               // 树皮唇最高处
      { r: R - w * 0.55, dy: 0.008 },    // 圆润过渡
      { r: R - w, dy: -0.016 }           // 内缘：低于木芯，形成一圈浅槽
    ];
    for (var ri = 0; ri < rings.length; ri++) {
      for (var ai = 0; ai <= SEG; ai++) {
        var a = ai / SEG * Math.PI * 2;
        var k = profileAt(profile, a);
        var rr = rings[ri].r * k;
        positions.push(Math.cos(a) * rr, y + rings[ri].dy, Math.sin(a) * rr);
        normals.push(0, 1, 0);
        uvs.push(ai / SEG * 4, ri / 3);
      }
    }
    var rowLen = SEG + 1;
    for (var ri2 = 0; ri2 < rings.length - 1; ri2++) {
      for (var ai2 = 0; ai2 < SEG; ai2++) {
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
  /* 板根：从桩身中部斜下、铺在草地上的粗根                               */
  /* ------------------------------------------------------------------ */
  /* 截面是「横向宽、竖向扁」的椭圆 → 看起来像抓地的板根，
     而不是圆管。中线从 yStart 一路下降到贴地（中心高度 = 半高），
     所以根的底面永远落在地面上，不会陷进土里。 */
  function buttressRootGeometry(angle, rStart, yStart, rEnd, seed, sc) {
    sc = sc || 1;
    var rnd = mulberry32(seed);
    var LEN = 15, CROSS = 12;
    var positions = [], normals = [], uvs = [], indices = [];
    var wob = (rnd() - 0.5) * 0.55;
    var wob2 = (rnd() - 0.5) * 0.95;
    var h0 = (0.10 + rnd() * 0.05) * sc;
    var h1 = (0.028 + rnd() * 0.014) * sc;
    var w0 = (0.20 + rnd() * 0.07) * (0.7 + 0.3 * sc);
    var w1 = (0.055 + rnd() * 0.03) * (0.7 + 0.3 * sc);
    var path = [];
    for (var i = 0; i <= LEN; i++) {
      var f = i / LEN;
      var hh = lerp(h0, h1, Math.pow(f, 0.62));
      var ww = lerp(w0, w1, Math.pow(f, 0.55));
      // 贴树干处较高，很快就落到地面，然后整条根趴在地上
      var yc = hh + (yStart - hh) * Math.pow(1 - f, 2.2);
      if (yc < hh) yc = hh;
      path.push({
        r: lerp(rStart, rEnd, Math.pow(f, 0.82)),
        a: angle + wob * f * f + wob2 * Math.pow(f, 2.4),
        y: yc, h: hh, w: ww
      });
    }
    for (var s = 0; s <= LEN; s++) {
      var p = path[s];
      var tx = -Math.sin(p.a), tz = Math.cos(p.a);   // 切向单位向量
      for (var k = 0; k <= CROSS; k++) {
        var ang = k / CROSS * Math.PI * 2;
        var cw = Math.cos(ang) * p.w;
        var vh = Math.sin(ang) * p.h;
        var px = Math.cos(p.a) * p.r + tx * cw;
        var pz = Math.sin(p.a) * p.r + tz * cw;
        positions.push(px, p.y + vh, pz);
        normals.push(tx * Math.cos(ang), Math.sin(ang), tz * Math.cos(ang));
        uvs.push(s / LEN * 2, k / CROSS * 1.5);
      }
    }
    var rowLen = CROSS + 1;
    for (var s2 = 0; s2 < LEN; s2++) {
      for (var k2 = 0; k2 < CROSS; k2++) {
        var b2 = s2 * rowLen + k2;
        indices.push(b2, b2 + rowLen, b2 + 1, b2 + 1, b2 + rowLen, b2 + rowLen + 1);
      }
    }
    // 根尖端封口
    var tipC = positions.length / 3;
    var last = path[LEN];
    positions.push(Math.cos(last.a) * last.r, last.y, Math.sin(last.a) * last.r);
    normals.push(Math.cos(last.a), 0.2, Math.sin(last.a));
    uvs.push(0.5, 0.5);
    var lastRing = positions.length / 3 - 1;
    for (var k3 = 0; k3 < CROSS; k3++) {
      indices.push(tipC, lastRing - CROSS + k3, lastRing - CROSS + k3 + 1);
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
  /* 树根：一圈大小不一的大板根 + 贴地细根                                */
  /* ================================================================== */
  /* 根的角度先定下来，桩身侧壁据此在底部鼓出「根肩」，
     再由这些角度伸出贴地的根脚 —— 二者同源，所以看不到接缝。 */
  function buildRootAngles(seed) {
    var rnd = mulberry32(seed + 31);
    var n = 9 + Math.floor(rnd() * 3);
    var base = rnd() * Math.PI * 2;
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        a: base + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.44,
        s: 0.65 + rnd() * 0.55,
        reach: 0.56 + rnd() * 0.32,
        sc: 0.8 + rnd() * 0.45
      });
    }
    return out;
  }

  function buildRoots(root, R, H, ROOT_R, barkMat, cortexMat, crackAngles, seed) {
    var rnd = mulberry32(seed + 7);
    var angles = buildRootAngles(seed);

    for (var i = 0; i < angles.length; i++) {
      var rt = angles[i];
      var geo = buttressRootGeometry(rt.a, R * (0.74 + rnd() * 0.06), H * (0.10 + rnd() * 0.06),
        ROOT_R * rt.reach, seed + i * 137, rt.sc);
      var mesh = new THREE.Mesh(geo, rnd() < 0.55 ? barkMat : cortexMat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      root.add(mesh);
    }

    // 贴地细根：插在板根之间，更短更扁（藏在根肩之间，只露出一点）
    var small = 5 + Math.floor(rnd() * 4);
    for (var k = 0; k < small; k++) {
      var a2 = rnd() * Math.PI * 2;
      var geo2 = buttressRootGeometry(a2, R * 0.72,
        H * (0.04 + rnd() * 0.06),
        ROOT_R * (0.38 + rnd() * 0.24), seed + 900 + k * 61,
        0.26 + rnd() * 0.14);
      var m2 = new THREE.Mesh(geo2, barkMat);
      m2.castShadow = true;
      root.add(m2);
    }
  }

  /* ================================================================== */
  /* 相机控制：拖拽环绕（不自动旋转）                                    */
  /* ================================================================== */
  function createControls(canvas, reduceMotion) {
    var az = -0.5, el = 0.42;          // 略俯：像照片那样看得到树皮侧壁，切面也完整
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
