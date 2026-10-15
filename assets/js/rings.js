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

    // 时间轴速览
    const strip = document.getElementById('timelineStrip');
    if (strip) {
      strip.innerHTML = S.ERAS.map(function (era) {
        return '<a class="tl-item" href="era.html?era=' + era.id + '">' +
          '<b>' + esc(era.year) + '</b><span>' + esc(era.title) + '</span></a>';
      }).join('');
    }

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
