/* =====================================================================
 * rings.js  首页「年轮入口」：SVG 年轮交互
 *  - 11 个年轮节点（由内向外 = 由古至今）
 *  - 悬停高亮 + 年份提示；点击进入该年代页面
 *  - 外圈“老树发新芽”新时代视觉节点
 * ===================================================================== */
(function () {
  'use strict';
  const S = window.SITE;
  const esc = window.UI.esc;

  const CX = 400, CY = 400, BASE = 56, BAND = 25;
  const COLORS = [
    '#c9a26a', '#c39a63', '#b98a55', '#a86a44', '#9c4d38', '#8c1f28',
    '#a33227', '#b5652f', '#c08a45', '#cf9b56', '#5f8c46'
  ];

  function radius(i) { return BASE + (i + 0.5) * BAND; }
  function outerEdge(i) { return BASE + (i + 1) * BAND; }

  /* =====================================================================
   * 年轮时间轴：2D 枣树生长带
   *  - 11 个节点 = 同一株枣树的 11 个生长阶段（清初幼苗 → 2024 参天大树）
   *  - 全部程序化绘制（Canvas 2D 递归枝条 + 叶簇 + 枣果），无外部素材
   *  - 内容不变：年份 + 标题仍是超链接，点击进入对应年代页
   * ===================================================================== */
  const TREE_CELL = 150;      // 每格宽度（px）
  const TREE_H = 300;         // 画布高度（px）
  const TREE_FILL = 0.84;     // 单株占格宽比例（留出间距）
  const BARK = ['#6d4a2e', '#7c5535', '#5a3c24'];
  const LEAF = ['#5f8c46', '#6f9c52', '#83b063', '#4f7a3b', '#93bd74'];
  const FRUIT = ['#9c3130', '#b03a2e', '#8c1f28'];

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 依据生长度 g∈[0,1] 生成一株枣树的几何（单位坐标，y 向上为负） */
  function buildJujube(g, rnd) {
    const t = Math.max(0, Math.min(1, g));
    const segs = [], fruits = [];
    let leaves = [];
    const scale = 0.26 + 0.74 * Math.pow(t, 0.85);   // 幼苗矮小 → 大树高大
    const depth = t < 0.08 ? 1 : Math.min(4, Math.round(1.2 + 2.9 * t));
    const trunkW = 0.02 + 0.12 * t;
    const spread = 0.34 + 0.22 * t;
    const lenF = 0.68 + 0.05 * t;
    const leafCount = 2 + Math.round(9 * t);

    function tips(x, y, len) {
      const cl = len * 1.1 + 0.05;
      const n = leafCount + Math.round(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.pow(rnd(), 0.6) * cl;
        leaves.push({
          x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.82,
          r: (0.026 + 0.05 * t) * (0.7 + rnd() * 0.7),
          c: LEAF[(rnd() * LEAF.length) | 0]
        });
      }
      if (t > 0.34 && rnd() < 0.2 + 0.6 * t) {
        const nf = 1 + Math.round(rnd() * 3 * t);
        for (let k = 0; k < nf; k++) {
          const a = rnd() * Math.PI * 2;
          const d = Math.pow(rnd(), 0.6) * cl * 1.15;
          fruits.push({
            x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.82,
            r: 0.03 + 0.03 * t,
            c: FRUIT[(rnd() * FRUIT.length) | 0]
          });
        }
      }
    }

    function rec(x, y, ang, len, w, d) {
      const ex = x + Math.cos(ang) * len;
      const ey = y + Math.sin(ang) * len;
      segs.push({ x1: x, y1: y, x2: ex, y2: ey, w: w });
      if (d <= 0 || len < 0.04) { tips(ex, ey, len); return; }
      // 主梢：基本顺原方向继续，形成高大主干
      let na0 = ang + (rnd() - 0.5) * 0.18;
      na0 += (-Math.PI / 2 - na0) * 0.22;
      rec(ex, ey, na0, len * lenF * (0.92 + rnd() * 0.16), w * 0.7, d - 1);
      // 侧枝：向两侧斜出，构成树冠
      const sides = d >= 3 ? 1 : 2;
      for (let k = 0; k < sides; k++) {
        const sgn = k % 2 === 0 ? -1 : 1;
        let na = ang + sgn * spread * (0.72 + rnd() * 0.5) + (rnd() - 0.5) * 0.14;
        na += (-Math.PI / 2 - na) * 0.1;
        rec(ex, ey, na, len * lenF * (0.58 + rnd() * 0.16), w * 0.55, d - 1);
      }
      if (d <= 1) tips(ex, ey, len);                  // 内层也补叶，树冠更饱满
    }

    rec(0, 0, -Math.PI / 2, scale, trunkW, depth);

    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    segs.forEach(function (s) {
      const h = s.w / 2;
      minX = Math.min(minX, s.x1 - h, s.x2 - h); maxX = Math.max(maxX, s.x1 + h, s.x2 + h);
      minY = Math.min(minY, s.y1 - h, s.y2 - h); maxY = Math.max(maxY, s.y1 + h, s.y2 + h);
    });
    leaves.concat(fruits).forEach(function (l) {
      minX = Math.min(minX, l.x - l.r); maxX = Math.max(maxX, l.x + l.r);
      minY = Math.min(minY, l.y - l.r); maxY = Math.max(maxY, l.y + l.r);
    });
    if (leaves.length > 900) {                        // 性能兜底
      leaves = leaves.filter(function (_, k) { return k % 2 === 0; });
    }
    return { segs: segs, leaves: leaves, fruits: fruits, minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function drawTreeStrip(cv, count, opts) {
    const hi = opts.hi, reveal = opts.reveal;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = TREE_CELL * count, H = TREE_H;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const groundY = H - 34;

    // 地面：土壤渐隐 + 基线
    const gg = ctx.createLinearGradient(0, groundY - 8, 0, groundY + 30);
    gg.addColorStop(0, 'rgba(126,100,66,0.18)');
    gg.addColorStop(1, 'rgba(126,100,66,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, groundY - 8, W, 38);
    ctx.strokeStyle = 'rgba(126,100,66,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(6, groundY + 0.5); ctx.lineTo(W - 6, groundY + 0.5); ctx.stroke();

    // 先生成全部几何，统一缩放：最大的一株正好占满一格
    const trees = [];
    for (let i = 0; i < count; i++) {
      trees.push(buildJujube(i / (count - 1), mulberry32(9173 + i * 7919)));
    }
    let s = 1e9;
    trees.forEach(function (tr) {
      const w = Math.max(0.16, tr.maxX - tr.minX);
      const h = Math.max(0.16, tr.maxY - tr.minY);
      s = Math.min(s, (TREE_CELL * TREE_FILL) / w, (groundY - 22) / h);
    });

    trees.forEach(function (tr, i) {
      const p = Math.max(0, Math.min(1, reveal - i));
      if (p <= 0) return;
      const cx = TREE_CELL * (i + 0.5);
      const w = (tr.maxX - tr.minX) * s;
      const cxm = (tr.minX + tr.maxX) / 2;
      const tx = cx - cxm * s, ty = groundY - tr.maxY * s;

      ctx.save();
      ctx.globalAlpha = ((hi >= 0 && hi !== i) ? 0.22 : 1) * p;
      ctx.translate(cx, groundY);
      ctx.scale(p, p);                                 // 自地面向上生长
      ctx.translate(-cx, -groundY);

      ctx.beginPath();
      ctx.ellipse(cx, groundY + 3, Math.max(7, w * 0.34), Math.max(2.4, w * 0.08), 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(72,54,32,0.13)';
      ctx.fill();

      ctx.lineCap = 'round';
      tr.segs.forEach(function (g) {
        ctx.beginPath();
        ctx.moveTo(tx + g.x1 * s, ty + g.y1 * s);
        ctx.lineTo(tx + g.x2 * s, ty + g.y2 * s);
        ctx.lineWidth = Math.max(0.8, g.w * s);
        ctx.strokeStyle = g.w * s > 4 ? BARK[0] : BARK[1];
        ctx.stroke();
      });
      tr.leaves.forEach(function (l) {
        ctx.beginPath();
        ctx.ellipse(tx + l.x * s, ty + l.y * s, l.r * s * 1.3, l.r * s * 0.85, 0, 0, Math.PI * 2);
        ctx.fillStyle = l.c;
        ctx.fill();
      });
      tr.fruits.forEach(function (f) {
        ctx.beginPath();
        ctx.arc(tx + f.x * s, ty + f.y * s, Math.max(1.1, f.r * s), 0, Math.PI * 2);
        ctx.fillStyle = f.c;
        ctx.fill();
      });
      ctx.restore();
    });
  }

  /* 时间轴：11 株枣树 + 11 个可点击年份标签 */
  function buildTreeStrip(strip) {
    const eras = S.ERAS;
    const n = eras.length;

    const inner = document.createElement('div');
    inner.className = 'tree-strip-inner';
    inner.style.width = (TREE_CELL * n) + 'px';

    const cv = document.createElement('canvas');
    cv.className = 'tree-canvas';
    inner.appendChild(cv);

    const nodes = document.createElement('div');
    nodes.className = 'tl-nodes';
    inner.appendChild(nodes);
    nodes.innerHTML = eras.map(function (era) {
      return '<a class="tl-node" style="width:' + TREE_CELL + 'px" href="era.html?era=' + era.id +
        '" title="' + esc(era.year) + '　' + esc(era.title) + '">' +
        '<b>' + esc(era.year) + '</b><span>' + esc(era.title) + '</span></a>';
    }).join('');

    strip.innerHTML = '';
    strip.appendChild(inner);

    const state = { hi: -1, reveal: n };
    function render() { drawTreeStrip(cv, n, state); }
    render();

    window.UI.$$('.tl-node', nodes).forEach(function (a, i) {
      function on() { state.hi = i; render(); }
      function off() { if (state.hi === i) { state.hi = -1; render(); } }
      a.addEventListener('mouseenter', on);
      a.addEventListener('mouseleave', off);
      a.addEventListener('focus', on);
      a.addEventListener('blur', off);
    });

    let rt = null;
    window.addEventListener('resize', function () {
      if (rt) clearTimeout(rt);
      rt = setTimeout(render, 150);
    });

    // 进入视口后，按时间顺序逐株生长
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function play() {
      const t0 = performance.now();
      (function step(now) {
        state.reveal = Math.min(n, (now - t0) / 130);
        render();
        if (state.reveal < n) requestAnimationFrame(step);
      })(t0);
    }
    if (reduce || typeof IntersectionObserver !== 'function') {
      state.reveal = n; render();
    } else {
      state.reveal = 0; render();
      const io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { io.disconnect(); play(); }
        });
      }, { threshold: 0.25 });
      io.observe(strip);
      setTimeout(function () { io.disconnect(); if (state.reveal < n) play(); }, 6000);
    }
  }

  function buildRingSVG() {
    const eras = S.ERAS;
    const maxR = outerEdge(eras.length - 1); // ≈ 331
    let bands = '';
    let labels = '';
    let hits = '';

    eras.forEach(function (era, i) {
      const r = radius(i);
      const C = 2 * Math.PI * r;
      bands +=
        '<circle class="ring-band" data-i="' + i + '" cx="' + CX + '" cy="' + CY + '" r="' + r + '"' +
        ' fill="none" stroke="' + COLORS[i] + '" stroke-width="' + (BAND - 3) + '"' +
        ' style="stroke-dasharray:' + C.toFixed(1) + ';stroke-dashoffset:' + C.toFixed(1) +
        ';transition:stroke-dashoffset .9s cubic-bezier(.22,.8,.3,1) ' + (i * 0.07).toFixed(2) + 's, opacity .25s"></circle>';
      hits += '<circle class="ring-hit" data-i="' + i + '" cx="' + CX + '" cy="' + CY + '" r="' + (r + BAND / 2) + '"' +
        ' fill="none" stroke="transparent" stroke-width="' + BAND + '"></circle>';

      const ly = 78 + i * 34;
      const lx = 486;
      labels +=
        '<path class="ring-label-line" data-line="' + i + '" d="M' + (CX + r) + ' ' + CY + ' L' + (lx - 16) + ' ' + CY +
        ' L' + (lx - 6) + ' ' + ly + '" fill="none"></path>' +
        '<rect class="ring-label-bg" data-bg="' + i + '" x="' + lx + '" y="' + (ly - 15) + '" width="132" height="30" rx="15"></rect>' +
        '<text class="ring-label-text" data-tx="' + i + '" x="' + (lx + 14) + '" y="' + (ly + 5) + '">' + esc(era.year) + '</text>' +
        '<text class="ring-year-text" data-sub="' + i + '" x="' + (lx + 78) + '" y="' + (ly + 5) + '">' + esc(era.ring) + '</text>';
    });

    // 外圈新芽节点
    const ox = CX + maxR + 6, oy = CY - maxR - 6;
    const sprout =
      '<g class="sprout" transform="translate(' + ox + ',' + oy + ')">' +
        '<circle cx="0" cy="0" r="17" fill="#5f8c46" opacity=".16"/>' +
        '<path d="M0 10 C-13 6 -18 -6 -11 -14 C-4 -7 -2 2 0 10 Z" fill="#5f8c46"/>' +
        '<path d="M0 10 C13 6 18 -6 11 -14 C4 -7 2 2 0 10 Z" fill="#7aa85e"/>' +
        '<text x="0" y="-24" text-anchor="middle" font-size="11" fill="#4d7338" font-family="serif">老树发新芽</text>' +
      '</g>';

    return (
      '<svg viewBox="0 0 800 800" role="img" aria-label="蒙藏学校旧址枣树年轮交互图">' +
        '<defs>' +
          '<radialGradient id="coreGrad" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0%" stop-color="#e8d7b6"/>' +
            '<stop offset="60%" stop-color="#d9c39a"/>' +
            '<stop offset="100%" stop-color="#c9a26a"/>' +
          '</radialGradient>' +
        '</defs>' +
        '<circle cx="' + CX + '" cy="' + CY + '" r="' + (BASE + 4) + '" fill="url(#coreGrad)" opacity=".9"/>' +
        '<g class="rings">' + bands + '</g>' +
        '<text class="ring-core-text" x="' + CX + '" y="' + (CY - 4) + '" text-anchor="middle">枣树年轮</text>' +
        '<text class="ring-core-text" x="' + CX + '" y="' + (CY + 16) + '" text-anchor="middle" style="font-size:11px;opacity:.75">树心 · 由内而外</text>' +
        '<g class="labels">' + labels + '</g>' +
        '<g class="hits">' + hits + '</g>' +
        sprout +
      '</svg>'
    );
  }

  function boot() {
    const stage = document.getElementById('ringStage');
    if (!stage) return;
    stage.innerHTML = buildRingSVG();

    const tip = document.createElement('div');
    tip.className = 'ring-tip';
    stage.appendChild(tip);

    const svg = stage.querySelector('svg');
    const bands = window.UI.$$('.ring-band', svg);
    const lines = window.UI.$$('.ring-label-line', svg);
    const bgs = window.UI.$$('.ring-label-bg', svg);
    const txs = window.UI.$$('.ring-label-text', svg);
    const subs = window.UI.$$('.ring-year-text', svg);

    // 生长动画
    requestAnimationFrame(function () {
      bands.forEach(function (b) {
        b.style.strokeDashoffset = '0';
        b.style.strokeDasharray = '';
      });
    });

    function setActive(i, on) {
      window.UI.$$('.ring-band').forEach(function (b, k) {
        if (on) b.classList.toggle('dim', k !== i);
      });
      if (lines[i]) lines[i].classList.toggle('hl', on);
      if (bgs[i]) bgs[i].classList.toggle('hl', on);
      if (txs[i]) txs[i].classList.toggle('hl', on);
      if (subs[i]) subs[i].classList.toggle('hl', on);
    }

    function showTip(i, evt) {
      const era = S.ERAS[i];
      tip.innerHTML = '<b>' + esc(era.year) + '　' + esc(era.title) + '</b><span>' + esc(era.event) + '</span>';
      tip.classList.add('on');
      moveTip(evt);
    }
    function moveTip(evt) {
      const r = stage.getBoundingClientRect();
      let x = evt.clientX - r.left;
      let y = evt.clientY - r.top;
      x = Math.max(90, Math.min(r.width - 90, x));
      y = Math.max(50, y);
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }
    function hideTip() { tip.classList.remove('on'); }

    window.UI.$$('.ring-hit', svg).forEach(function (hit) {
      const i = +hit.getAttribute('data-i');
      hit.addEventListener('mouseenter', function (e) { setActive(i, true); showTip(i, e); });
      hit.addEventListener('mousemove', moveTip);
      hit.addEventListener('mouseleave', function () { setActive(i, false); hideTip(); });
      hit.addEventListener('click', function () { go(i); });
    });
    window.UI.$$('.ring-band', svg).forEach(function (b) {
      const i = +b.getAttribute('data-i');
      b.addEventListener('click', function () { go(i); });
    });
    function go(i) {
      location.href = 'era.html?era=' + S.ERAS[i].id;
    }

    // 时间轴速览：11 株枣树（清初幼苗 → 2024 参天大树）
    const strip = document.getElementById('timelineStrip');
    if (strip) buildTreeStrip(strip);

    // 说明卡片数据
    const stat = document.getElementById('statBox');
    if (stat) {
      stat.innerHTML = [
        ['11', '个年轮节点', '由清初到 2024 年'],
        ['近 400', '年树龄', '始植于清初'],
        ['4', '大互动模块', '年轮 / 人物 / 史料 / 智能体'],
        ['10', '位人物档案', '革命先驱与蒙藏学校学生']
      ].map(function (s) {
        return '<div class="note"><h4 style="font-size:26px;color:var(--bark);margin-bottom:2px">' + s[0] + '</h4>' +
          '<div style="font-family:var(--serif)">' + s[1] + '</div>' +
          '<p>' + s[2] + '</p></div>';
      }).join('');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
