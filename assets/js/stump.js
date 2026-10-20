/* =====================================================================
 * stump.js  首页「触摸年轮」：俯视树桩横截面（SVG 分层绘制）
 *  - 不用饼图 / 旭日图 / 环形图组件，手工分层绘制
 *  - 第 1 层（底）：扰动年轮环 —— 每条环是 path，半径逐段加随机偏移，
 *                    微椭圆 + 凹凸，不是标准正圆
 *  - 第 2 层（中）：独立裂纹路径 —— 从髓心附近向外蜿蜒，途中弯折，
 *                    局部贴年轮切线走一小段，末端发散，粗细抖动
 *  - 第 3 层（顶）：HTML 绝对定位信息卡片，落在最大年轮之外；
 *                    从裂纹外端引出细引线连到卡片，卡片自动避让防重叠
 *  - 交互：hover 裂纹 / 卡片 → 对应年轮、裂纹、引线高亮；点击进入年代页
 *  - 极坐标布局，不做均匀扇形切块
 *  - prefers-reduced-motion 时不做生长动画
 * ===================================================================== */
(function () {
  'use strict';

  var S = window.SITE;
  var esc = (window.UI && window.UI.esc) ? window.UI.esc : function (s) { return s; };
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* 年轮配色（由内向外）：扎根 → 觉醒 → 播撒 → 回望 → 新芽 */
  var COLORS = [
    '#e6d2a6', '#dcc196', '#cbaa70', '#b98a55', '#a86a44',
    '#8c1f28', '#a33227', '#b5652f', '#c08a45', '#cf9b56', '#5f8c46'
  ];

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                             */
  /* ------------------------------------------------------------------ */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function polar(cx, cy, a, r) { return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }
  function f(n) { return Math.round(n * 100) / 100; }

  /* ------------------------------------------------------------------ */
  /* 第 1 层：扰动年轮环                                                  */
  /*  每条环用 path 画闭合近似圆：半径逐段加 ±2~7px 随机偏移，            */
  /*  并整体压成微椭圆，让年轮不规整、有凹凸。                            */
  /* ------------------------------------------------------------------ */
  function buildRingPath(cx, cy, r, seed, jag, squish) {
    var rnd = mulberry32(seed);
    var stepDeg = 18 + rnd() * 12;                 // 每 18°~30° 一个采样点
    var step = stepDeg * Math.PI / 180;
    var pts = [];
    var phase = rnd() * Math.PI * 2;
    var a = 0;
    while (a < Math.PI * 2 + step * 0.5) {
      var wobble = (rnd() - 0.5) * 2 * jag;         // 半径随机扰动
      var rr = r + wobble;
      var ang = a + phase;
      var x = cx + Math.cos(ang) * rr;
      var y = cy + Math.sin(ang) * rr * squish;      // 微椭圆
      pts.push([x, y]);
      a += step;
    }
    // 用平滑三次贝塞尔把所有采样点连成闭合曲线
    var d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
    for (var i = 0; i < pts.length; i++) {
      var p0 = pts[i];
      var p1 = pts[(i + 1) % pts.length];
      var p2 = pts[(i + 2) % pts.length];
      // Catmull-Rom → 三次贝塞尔
      var c1x = p0[0] + (p1[0] - pts[(i - 1 + pts.length) % pts.length][0]) / 6;
      var c1y = p0[1] + (p1[1] - pts[(i - 1 + pts.length) % pts.length][1]) / 6;
      var c2x = p1[0] - (p2[0] - p0[0]) / 6;
      var c2y = p1[1] - (p2[1] - p0[1]) / 6;
      d += ' C' + f(c1x) + ' ' + f(c1y) + ' ' + f(c2x) + ' ' + f(c2y) + ' ' + f(p1[0]) + ' ' + f(p1[1]);
    }
    return d + ' Z';
  }

  /* ------------------------------------------------------------------ */
  /* 第 2 层：独立裂纹路径                                                */
  /*  从髓心附近随机角出发，4~8 个折点向外蜿蜒；部分折点贴着年轮切线     */
  /*  拐一小段；末端发散；线宽 1.2~3px 抖动。                             */
  /* ------------------------------------------------------------------ */
  function buildCracks(cx, cy, R, n, seed) {
    var rnd = mulberry32(seed);
    var cracks = [];
    var count = 12 + ((rnd() * 4) | 0);
    for (var k = 0; k < count; k++) {
      var a = (k / count) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      var r = R * (0.04 + rnd() * 0.10);            // 起点在髓心附近
      var pts = [[cx + Math.cos(a) * r, cy + Math.sin(a) * r]];
      var bends = 4 + ((rnd() * 5) | 0);            // 4~8 个折点
      var rEnd = R * (0.72 + rnd() * 0.33);
      for (var s = 0; s < bends; s++) {
        var t = (s + 1) / bends;
        var rNext = lerp(r, rEnd, Math.pow(t, 0.92));
        // 角度偏折：主方向 + 随机抖动
        a += (rnd() - 0.5) * 0.24;
        var x = cx + Math.cos(a) * rNext;
        var y = cy + Math.sin(a) * rNext;

        // 偶尔贴着年轮切线拐一小段（环形裂纹接续）
        if (rnd() < 0.32) {
          var tAng = a + (rnd() < 0.5 ? 1 : -1) * (0.14 + rnd() * 0.2);
          x = cx + Math.cos(tAng) * rNext;
          y = cy + Math.sin(tAng) * rNext;
          a = tAng;
        }
        pts.push([x, y]);
      }
      // 末端发散：一小段分叉
      var last = pts[pts.length - 1];
      var forks = [];
      var nf = 1 + ((rnd() * 3) | 0);
      for (var q = 0; q < nf; q++) {
        var fa = a + (rnd() - 0.5) * 0.6;
        var fl = R * (0.05 + rnd() * 0.10);
        forks.push([[last[0], last[1]], [last[0] + Math.cos(fa) * fl, last[1] + Math.sin(fa) * fl]]);
      }
      cracks.push({
        pts: pts, forks: forks, a: a,
        w: 1.2 + rnd() * 1.8,                       // 线宽 1.2~3
        tipR: rEnd / R
      });
    }
    return cracks;
  }

  /* 把点集转成平滑折线路径（轻微贝塞尔，避免生硬直角） */
  function pathFrom(pts) {
    var d = 'M' + f(pts[0][0]) + ' ' + f(pts[0][1]);
    for (var i = 1; i < pts.length; i++) {
      var p0 = pts[i - 1], p1 = pts[i];
      var mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      var px = (p0[0] + mx) / 2, py = (p0[1] + my) / 2;
      d += ' Q' + f(px) + ' ' + f(py) + ' ' + f(mx) + ' ' + f(my);
      if (i === pts.length - 1) d += ' L' + f(p1[0]) + ' ' + f(p1[1]);
    }
    return d;
  }

  /* ------------------------------------------------------------------ */
  /* 场景构建                                                             */
  /* ------------------------------------------------------------------ */
  function create(stage) {
    var eras = S.ERAS;
    var n = eras.length;

    /* 视图盒：留出外圈卡片所需的空间 */
    var VB = 1000;
    var CX = VB / 2, CY = VB / 2;
    var R = 318;                       // 最大年轮半径（外圈卡片区域在 R 之外）
    var cardR = R + 118;               // 卡片中心所在半径

    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'stump-svg');
    svg.setAttribute('viewBox', '0 0 ' + VB + ' ' + VB);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '枣树树桩横截面年轮图：11 圈年轮由树心（清初）向外到 2024 年，点击进入对应年代');
    stage.appendChild(svg);

    /* ---------- defs ---------- */
    var defs = document.createElementNS(SVGNS, 'defs');
    defs.innerHTML =
      '<radialGradient id="stumpCore" cx="48%" cy="47%" r="62%">' +
        '<stop offset="0%" stop-color="#ecdcb6"/>' +
        '<stop offset="55%" stop-color="#ddc79c"/>' +
        '<stop offset="100%" stop-color="#c9ab7f"/>' +
      '</radialGradient>' +
      '<filter id="stumpGrain" x="-5%" y="-5%" width="110%" height="110%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="n"/>' +
        '<feColorMatrix in="n" type="saturate" values="0"/>' +
        '<feComponentTransfer><feFuncA type="linear" slope="0.10"/></feComponentTransfer>' +
        '<feComposite in2="SourceGraphic" operator="over"/>' +
      '</filter>';
    svg.appendChild(defs);

    /* ---------- 年轮几何：每个环带半径 + 独立扰动种子 ---------- */
    var ringR = [];
    for (var i = 0; i <= n; i++) {
      ringR.push(CORE_R_ABS(i, n));
    }
    function CORE_R_ABS(i, n) {
      var core = R * 0.075;
      return core + (R - core) * (i / n);
    }

    /* ---------- 第 1 层：扰动年轮环 ---------- */
    var gRings = document.createElementNS(SVGNS, 'g');
    gRings.setAttribute('class', 'stump-rings');
    svg.appendChild(gRings);

    // 底色木盘（最外圈填充）
    var disc = document.createElementNS(SVGNS, 'path');
    disc.setAttribute('class', 'stump-disc');
    disc.setAttribute('d', buildRingPath(CX, CY, R * 0.995, 9001, R * 0.022, 0.985));
    disc.setAttribute('fill', 'url(#stumpCore)');
    gRings.appendChild(disc);

    // 树心
    var core = document.createElementNS(SVGNS, 'path');
    core.setAttribute('class', 'stump-core');
    core.setAttribute('d', buildRingPath(CX, CY, ringR[0] * 0.72, 777, R * 0.006, 0.97));
    gRings.appendChild(core);

    // 11 个年轮环带：用前后两条扰动环围成的带（用 stroke 画带宽，简单且自然）
    var ringEls = [];
    for (var i2 = 0; i2 < n; i2++) {
      var rMid = (ringR[i2] + ringR[i2 + 1]) / 2;
      var bandW = ringR[i2 + 1] - ringR[i2];
      var path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('class', 'stump-band');
      // 每个环带一条扰动中线圈，用较粗的 stroke 表现带宽
      path.setAttribute('d', buildRingPath(CX, CY, rMid, 1200 + i2 * 137, Math.min(7, bandW * 0.16), 0.985));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', COLORS[i2 % COLORS.length]);
      path.setAttribute('stroke-width', f(bandW * 0.94));
      path.setAttribute('data-i', i2);
      gRings.appendChild(path);
      ringEls.push(path);

      // 晚材深线：环带外缘（年轮边界）
      var edge = document.createElementNS(SVGNS, 'path');
      edge.setAttribute('class', 'stump-edge');
      edge.setAttribute('d', buildRingPath(CX, CY, ringR[i2 + 1], 4400 + i2 * 91, Math.min(8, bandW * 0.2), 0.985));
      edge.setAttribute('fill', 'none');
      edge.setAttribute('data-i', i2);
      gRings.appendChild(edge);
    }

    // 外缘粗糙树皮环
    var bark = document.createElementNS(SVGNS, 'path');
    bark.setAttribute('class', 'stump-bark');
    bark.setAttribute('d', buildRingPath(CX, CY, R * 1.012, 31337, R * 0.016, 0.985));
    bark.setAttribute('fill', 'none');
    gRings.appendChild(bark);

    /* ---------- 木射线（细纹，衬托质感） ---------- */
    var gRays = document.createElementNS(SVGNS, 'g');
    gRays.setAttribute('class', 'stump-rays');
    svg.appendChild(gRays);
    (function () {
      var rnd = mulberry32(555);
      for (var k = 0; k < 130; k++) {
        var a = rnd() * Math.PI * 2;
        var rr0 = lerp(ringR[0], R * 0.35, rnd());
        var rr1 = rr0 + (R - rr0) * (0.2 + rnd() * 0.75);
        var ln = document.createElementNS(SVGNS, 'line');
        ln.setAttribute('x1', f(CX + Math.cos(a) * rr0));
        ln.setAttribute('y1', f(CY + Math.sin(a) * rr0));
        ln.setAttribute('x2', f(CX + Math.cos(a) * rr1));
        ln.setAttribute('y2', f(CY + Math.sin(a) * rr1));
        ln.setAttribute('stroke', 'rgba(96,66,40,' + (0.05 + rnd() * 0.09).toFixed(3) + ')');
        ln.setAttribute('stroke-width', f(0.6 + rnd() * 1.2));
        gRays.appendChild(ln);
      }
    })();

    /* ---------- 第 2 层：独立裂纹 ---------- */
    var cracks = buildCracks(CX, CY, R, n, 20241020);
    var gCracks = document.createElementNS(SVGNS, 'g');
    gCracks.setAttribute('class', 'stump-cracks');
    svg.appendChild(gCracks);

    var crackEls = [];
    cracks.forEach(function (c, idx) {
      var g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'crack');
      g.setAttribute('data-crack', idx);

      var main = document.createElementNS(SVGNS, 'path');
      main.setAttribute('d', pathFrom(c.pts));
      main.setAttribute('fill', 'none');
      main.setAttribute('stroke', '#2f1c10');
      main.setAttribute('stroke-width', f(c.w));
      main.setAttribute('stroke-linecap', 'round');
      main.setAttribute('stroke-linejoin', 'round');
      g.appendChild(main);

      // 内侧高光，做出裂口立体感
      var hi = document.createElementNS(SVGNS, 'path');
      hi.setAttribute('class', 'crack-hi');
      hi.setAttribute('d', pathFrom(c.pts));
      hi.setAttribute('fill', 'none');
      g.appendChild(hi);

      // 末端分叉
      c.forks.forEach(function (fk) {
        var fp = document.createElementNS(SVGNS, 'path');
        fp.setAttribute('d', 'M' + f(fk[0][0]) + ' ' + f(fk[0][1]) + ' L' + f(fk[1][0]) + ' ' + f(fk[1][1]));
        fp.setAttribute('stroke', '#2f1c10');
        fp.setAttribute('stroke-width', f(Math.max(0.8, c.w * 0.55)));
        fp.setAttribute('stroke-linecap', 'round');
        g.appendChild(fp);
      });

      gCracks.appendChild(g);
      crackEls.push(g);
    });

    /* ---------- 第 3 层：引线 + 外层 DOM 卡片 ---------- */
    var gLeads = document.createElementNS(SVGNS, 'g');
    gLeads.setAttribute('class', 'stump-leads');
    svg.appendChild(gLeads);

    // 把 11 个事件按“均匀极角 + 轻微抖动”分配到卡片位置；卡片再做避让
    var cardLayer = document.createElement('div');
    cardLayer.className = 'stump-cards';
    stage.appendChild(cardLayer);

    var slots = layoutCards(n);

    var cardEls = [];
    var leadEls = [];

    eras.forEach(function (era, i) {
      var slot = slots[i];

      /* 裂纹外端点：挑一条角度最接近该事件极角的裂纹 */
      var crackIdx = nearestCrack(cracks, slot.angle, i);
      var c = cracks[crackIdx];
      var last = c.pts[c.pts.length - 1];
      var tipX = last[0], tipY = last[1];
      // 裂纹末端再往外一点作为引线起点
      var outA = Math.atan2(tipY - CY, tipX - CX);
      var startR = Math.sqrt((tipX - CX) * (tipX - CX) + (tipY - CY) * (tipY - CY)) + 8;
      var sx = CX + Math.cos(outA) * startR;
      var sy = CY + Math.sin(outA) * startR;

      /* 卡片中心（视图盒坐标） */
      var cardPt = polar(CX, CY, slot.angle, cardR + slot.push);
      var cardX = cardPt[0], cardY = cardPt[1];

      /* 引线：短细曲线，从裂纹外端 → 卡片内侧 */
      var lead = document.createElementNS(SVGNS, 'path');
      var inner = Math.max(0.55, 1 - 90 / Math.hypot(cardX - sx, cardY - sy));
      var ix = lerp(sx, cardX, inner), iy = lerp(sy, cardY, inner);
      // 控制点：沿切线略偏，做出柔和弧度
      var mx = (sx + ix) / 2, my = (sy + iy) / 2;
      var perp = outA + Math.PI / 2;
      var bend = (cardX - CX) * Math.cos(perp) + (cardY - CY) * Math.sin(perp);
      var cx2 = mx + Math.cos(perp) * Math.sign(bend || 1) * 10;
      var cy2 = my + Math.sin(perp) * Math.sign(bend || 1) * 10;
      lead.setAttribute('d', 'M' + f(sx) + ' ' + f(sy) + ' Q' + f(cx2) + ' ' + f(cy2) + ' ' + f(ix) + ' ' + f(iy));
      lead.setAttribute('class', 'stump-lead');
      lead.setAttribute('data-i', i);
      gLeads.appendChild(lead);
      leadEls.push(lead);

      // 外层端点小圆
      var dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('class', 'stump-lead-dot');
      dot.setAttribute('cx', f(sx));
      dot.setAttribute('cy', f(sy));
      dot.setAttribute('r', 3.2);
      dot.setAttribute('data-i', i);
      gLeads.appendChild(dot);
      leadEls.push(dot);

      /* DOM 卡片：百分比定位（相对 viewBox 1000） */
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'stump-card';
      card.setAttribute('data-i', i);
      card.setAttribute('data-dir', slot.angle > Math.PI / 2 && slot.angle < Math.PI * 1.5 ? 'left' : 'right');
      card.innerHTML =
        '<i class="sc-swatch" style="background:' + COLORS[i % COLORS.length] + '"></i>' +
        '<b class="sc-year">' + esc(era.year) + '</b>' +
        '<span class="sc-title">' + esc(era.title) + '</span>';
      card.style.left = (cardX / VB * 100) + '%';
      card.style.top = (cardY / VB * 100) + '%';
      card.setAttribute('aria-label', era.year + ' ' + era.title + '，进入该年代');
      cardLayer.appendChild(card);
      cardEls.push(card);

      card.addEventListener('mouseenter', function () { hover(i); });
      card.addEventListener('mouseleave', function () { hover(-1); });
      card.addEventListener('focus', function () { hover(i); });
      card.addEventListener('blur', function () { hover(-1); });
      card.addEventListener('click', function () { go(era); });

      // 悬停年轮环带同样高亮
      ringEls[i].style.pointerEvents = 'stroke';
      ringEls[i].addEventListener('mouseenter', function () { hover(i); });
      ringEls[i].addEventListener('mouseleave', function () { hover(-1); });
      ringEls[i].addEventListener('click', function () { go(era); });
    });

    /* 裂纹 hover 也参与高亮（取最近的卡片） */
    crackEls.forEach(function (g, idx) {
      g.style.pointerEvents = 'stroke';
      g.style.cursor = 'pointer';
      g.addEventListener('mouseenter', function () { hover(crackToEra(idx)); });
      g.addEventListener('mouseleave', function () { hover(-1); });
      g.addEventListener('click', function () { var i = crackToEra(idx); if (i >= 0) go(eras[i]); });
    });
    function crackToEra(idx) {
      // 由裂纹索引映射到最近的卡片索引
      var c = cracks[idx];
      var last = c.pts[c.pts.length - 1];
      var a = Math.atan2(last[1] - CY, last[0] - CX);
      var best = 0, bd = 1e9;
      slots.forEach(function (s, i) {
        var d = Math.abs(angDiff(a, s.angle));
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }

    /* ---------- 交互高亮 ---------- */
    var hi = -1;
    function hover(i) {
      if (hi === i) return;
      hi = i;
      ringEls.forEach(function (p, k) {
        p.classList.toggle('on', k === i);
        p.style.opacity = (i < 0 || k === i) ? '' : '0.42';
      });
      cardEls.forEach(function (c2, k) { c2.classList.toggle('on', k === i); });
      leadEls.forEach(function (l, k) {
        var idx = +l.getAttribute('data-i');
        l.classList.toggle('on', idx === i);
      });
      // 高亮该卡片对应的裂纹
      var crackIdx = i >= 0 ? nearestCrack(cracks, slots[i].angle, i) : -1;
      crackEls.forEach(function (g, k) { g.classList.toggle('on', k === crackIdx); });
    }

    function go(era) { location.href = 'era.html?era=' + era.id; }

    return {
      hover: hover,
      goIndex: function (i) { if (eras[i]) go(eras[i]); },
      redraw: function () {}
    };
  }

  /* ------------------------------------------------------------------ */
  /* 卡片布局：均匀极角起步，再按最小角差做切向/径向避让                   */
  /* ------------------------------------------------------------------ */
  function layoutCards(n) {
    var slots = [];
    for (var i = 0; i < n; i++) {
      // 由正上方开始，顺时针均匀分布；起始角 -90°
      var a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      slots.push({ angle: a, push: 0 });
    }
    // 右侧（-90°~90°）卡片略微外推，左侧略收，避免与标题区相撞
    slots.forEach(function (s) {
      var deg = ((s.angle * 180 / Math.PI) + 360) % 360;
      s.push = (deg > 270 || deg < 90) ? 14 : 0;
    });
    // 简单避让：角度太近的相邻卡片沿径向外推
    var sorted = slots.slice().sort(function (a, b) { return a.angle - b.angle; });
    for (var k = 0; k < sorted.length; k++) {
      var a1 = sorted[k], a2 = sorted[(k + 1) % sorted.length];
      var d = angDiff(a2.angle, a1.angle);
      if (Math.abs(d) < 0.34) {               // < ~19.5°
        a2.push += 26;
      }
    }
    return slots;
  }

  function angDiff(a, b) {
    var d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function nearestCrack(cracks, angle, salt) {
    var best = 0, bd = 1e9;
    cracks.forEach(function (c, k) {
      var d = Math.abs(angDiff(c.a, angle));
      // 加一点点盐，避免多张卡片抢同一条裂纹
      var tie = ((k + salt) % cracks.length) * 0.0001;
      if (d + tie < bd) { bd = d + tie; best = k; }
    });
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* 底部年代导航条                                                       */
  /* ------------------------------------------------------------------ */
  var app = null;
  function activeApp() {
    // 3D 优先，否则用 SVG 版
    if (window.__stump3d) return window.__stump3d;
    return app || window.__stump;
  }
  function buildNav() {
    var bar = document.getElementById('stumpNav');
    if (!bar) return;
    bar.innerHTML = S.ERAS.map(function (era, i) {
      return '<button class="stump-nav-btn" type="button" data-i="' + i + '">' +
        '<i style="background:' + COLORS[i % COLORS.length] + '"></i>' +
        '<b>' + esc(era.year) + '</b><span>' + esc(era.title) + '</span>' +
        '</button>';
    }).join('');
    Array.prototype.slice.call(bar.querySelectorAll('.stump-nav-btn')).forEach(function (b) {
      var i = +b.getAttribute('data-i');
      b.addEventListener('mouseenter', function () { setHoverAny(i); });
      b.addEventListener('mouseleave', function () { setHoverAny(-1); });
      b.addEventListener('click', function () { var a = activeApp(); if (a) a.goIndex(i); });
    });
  }

  function setHoverAny(i) {
    var a = activeApp();
    if (!a) return;
    if (typeof a.setHover === 'function') a.setHover(i);
    else if (typeof a.hover === 'function') a.hover(i);
  }

  function buildSvg(stage) {
    try {
      app = create(stage);
    } catch (e) {
      stage.innerHTML = '<p class="muted" style="text-align:center">年轮图加载失败，请刷新页面重试。</p>';
      return;
    }
    stage.classList.add('stump-ready');
    buildNav();
    window.__stump = app;
  }

  function boot() {
    var stage = document.getElementById('stumpStage');
    if (!stage) return;

    // 无论如何，底部年代导航条都要构建（供 3D / SVG 两种模式共用）
    buildNav();

    /* stump3d.js 已声明将接管：等它的结果。
       - 成功 → 保留 3D，不画 SVG
       - 失败（WebGL 不可用 / 异常）→ 画 SVG 回退年轮 */
    if (window.__stump3dIntent) {
      var tries = 0;
      (function wait3d() {
        if (window.__stump3d) return;                 // 3D 已就绪
        if (stage.classList.contains('stump-fallback')) { buildSvg(stage); return; }
        if (++tries > 60) { buildSvg(stage); return; } // 超时 ~3s 兜底
        setTimeout(wait3d, 50);
      })();
      return;
    }

    /* 没有 3D 模块：直接用 SVG */
    if (stage.classList.contains('stump3d-ready') || window.__stump3d) return;
    buildSvg(stage);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
