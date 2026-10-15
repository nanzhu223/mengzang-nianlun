/* =====================================================================
 * main.js  公共逻辑：导航、弹窗、示意图生成、页脚、小工具
 * ===================================================================== */
(function () {
  'use strict';
  const S = window.SITE;

  /* ------------------------------ 工具 ------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function qs(name) {
    const m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------ 导航 ------------------------------ */
  const NAV = [
    { href: 'index.html', label: '年轮时间轴' },
    { href: 'people.html', label: '人物长廊' },
    { href: 'archive.html', label: '史料库' },
    { href: 'about.html', label: '关于我们' }
  ];

  function renderTopbar(active) {
    const el = $('#topbar');
    if (!el) return;
    el.innerHTML =
      '<div class="topbar-inner">' +
        '<a class="brand" href="index.html" style="text-decoration:none;color:inherit">' +
          '<span class="brand-mark" aria-hidden="true"></span>' +
          '<span class="brand-text">' +
            '<span class="brand-title">触摸年轮</span>' +
            '<span class="brand-sub">蒙藏学校旧址 · 中华民族共同体数字记忆</span>' +
          '</span>' +
        '</a>' +
        '<nav class="nav">' +
          NAV.map(function (n) {
            return '<a href="' + n.href + '"' + (n.href === active ? ' class="active"' : '') + '>' + n.label + '</a>';
          }).join('') +
        '</nav>' +
      '</div>';
  }

  function renderFooter() {
    const el = $('#footer');
    if (!el) return;
    el.className = 'footer';
    el.innerHTML =
      '<div class="footer-inner">' +
        '<div><b style="font-family:var(--serif);color:var(--ink)">' + esc(S.META.title) + '</b> · ' + esc(S.META.subtitle) + '</div>' +
        '<div style="margin-top:6px">赛道：指定命题“红色之旅 追梦铸魂”作品赛项　|　作品组成：网站（主体）＋智能体“问枣树”（创新点）＋演示视频＋作品说明</div>' +
        '<div style="margin-top:6px">史料来源：' + S.SOURCES.map(function (s) { return esc(s.name); }).join('、') + '</div>' +
        '<div class="footer-disclaimer">' + esc(S.META.disclaimer) + '</div>' +
      '</div>';
  }

  /* ------------------------------ 弹窗 ------------------------------ */
  function ensureModal() {
    let mask = $('#modalMask');
    if (mask) return mask;
    mask = document.createElement('div');
    mask.id = 'modalMask';
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<button class="modal-close" aria-label="关闭">×</button>' +
        '<div class="modal-head"><h3></h3><div class="sub"></div></div>' +
        '<div class="modal-body"></div>' +
      '</div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (e) { if (e.target === mask) closeModal(); });
    $('.modal-close', mask).addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
    return mask;
  }
  function openModal(title, sub, bodyHtml) {
    const mask = ensureModal();
    $('.modal-head h3', mask).innerHTML = title;
    $('.modal-head .sub', mask).innerHTML = sub || '';
    $('.modal-body', mask).innerHTML = bodyHtml || '';
    mask.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    const mask = $('#modalMask');
    if (!mask) return;
    mask.classList.remove('on');
    document.body.style.overflow = '';
  }

  /* 人物弹窗 */
  function showPerson(id) {
    const p = S.getPersonById(id);
    if (!p) return;
    let html = '<p>' + esc(p.brief) + '</p>';
    html += '<dl class="kv">' +
      '<dt>与枣树</dt><dd>' + esc(p.link) + '</dd>' +
      '<dt>史料出处</dt><dd>' + p.sources.map(esc).join('；') + '</dd>' +
      '</dl>';
    openModal(esc(p.name), esc(p.life + '　' + p.tag), html);
  }

  /* 物件弹窗 */
  function showObject(eraId, name) {
    const era = S.getEraById(eraId);
    if (!era) return;
    const o = (era.objects || []).filter(function (x) { return x.name === name; })[0];
    if (!o) return;
    openModal(esc(o.name), esc(era.year + '　' + era.ring), '<p>' + esc(o.text) + '</p>' +
      '<p class="muted" style="margin-top:14px">本页面史料出处见下方“史料卡片”。</p>');
  }

  /* ------------------------------ 示意图（程序化 SVG） ------------------------------ */
  function personSilhouette(x, y, s, color, pose) {
    pose = pose || 0;
    const head = '<circle cx="' + x + '" cy="' + (y - 30 * s) + '" r="' + 8 * s + '" fill="' + color + '"/>';
    const body =
      '<path d="M' + (x - 9 * s) + ' ' + (y - 20 * s) +
      ' q' + (9 * s) + ' ' + (-6 * s) + ' ' + (18 * s) + ' 0' +
      ' l' + (3 * s) + ' ' + (20 * s) +
      ' l' + (-6 * s) + ' 0' +
      ' l' + (-1.5 * s) + ' ' + (-9 * s) +
      ' l' + (-9 * s) + ' 0' +
      ' l' + (-1.5 * s) + ' ' + (9 * s) +
      ' l' + (-6 * s) + ' 0 Z" fill="' + color + '"/>';
    const arm = '<path d="M' + (x + (pose ? 12 : 9) * s) + ' ' + (y - 16 * s) +
      ' l' + (pose ? 9 : 5) * s + ' ' + (pose ? -7 : 9) * s + '" stroke="' + color +
      '" stroke-width="' + 3.4 * s + '" stroke-linecap="round" fill="none"/>';
    return '<g opacity=".92">' + head + body + arm + '</g>';
  }

  function makeScene(era) {
    const H = hash(era.id);
    const r = rng(H);
    const hue = era.hue;
    const uid = 'sc' + era.id;
    const warm = 'hsl(' + hue + ', 52%, 52%)';
    const deep = 'hsl(' + ((hue + 8) % 360) + ', 46%, 30%)';
    const soft = 'hsl(' + ((hue + 20) % 360) + ', 40%, 74%)';

    // 年轮“日轮”
    let rings = '';
    for (let i = 6; i >= 1; i--) {
      rings += '<circle cx="618" cy="132" r="' + (18 + i * 9) + '" fill="none" stroke="' +
        (i % 2 ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.22)') + '" stroke-width="' + (2 + (6 - i)) + '"/>';
    }

    // 屋脊剪影
    let roofs = '';
    let rx = -20;
    while (rx < 820) {
      const w = 90 + r() * 90;
      const h = 46 + r() * 40;
      const y = 252 + r() * 12;
      roofs += '<path d="M' + rx + ' ' + y + ' l' + (w / 2) + ' ' + (-h) + ' l' + (w / 2) + ' ' + h + ' Z" fill="' +
        'rgba(43,33,24,' + (0.05 + r() * 0.06).toFixed(3) + ')"/>';
      roofs += '<rect x="' + (rx + 8) + '" y="' + y + '" width="' + (w - 16) + '" height="' + (300 - y) +
        '" fill="rgba(43,33,24,' + (0.06 + r() * 0.05).toFixed(3) + ')"/>';
      rx += w + 6;
    }

    // 树
    const treeX = 246;
    let foliage = '';
    const blobs = [
      [-62, -216, 78], [10, -244, 88], [74, -204, 70], [-30, -280, 62], [46, -282, 58]
    ];
    blobs.forEach(function (b, i) {
      foliage += '<ellipse cx="' + (treeX + b[0]) + '" cy="' + (300 + b[1]) + '" rx="' + b[2] +
        '" ry="' + (b[2] * 0.78) + '" fill="hsl(' + ((hue + i * 6) % 360) + ',42%,' + (38 + i * 4) + '%)" opacity=".82"/>';
    });
    const trunk =
      '<path d="M' + (treeX - 30) + ' 300 C' + (treeX - 22) + ' 250, ' + (treeX - 16) + ' 210, ' +
      (treeX - 6) + ' 150 L' + (treeX + 12) + ' 150 C' + (treeX + 6) + ' 214, ' + (treeX + 12) + ' 252, ' +
      (treeX + 30) + ' 300 Z" fill="#6b4a2f"/>' +
      '<path d="M' + (treeX - 12) + ' 168 C' + (treeX - 54) + ' 158, ' + (treeX - 84) + ' 128, ' +
      (treeX - 96) + ' 92" stroke="#6b4a2f" stroke-width="13" fill="none" stroke-linecap="round"/>' +
      '<path d="M' + (treeX + 12) + ' 166 C' + (treeX + 58) + ' 154, ' + (treeX + 90) + ' 124, ' +
      (treeX + 104) + ' 88" stroke="#6b4a2f" stroke-width="12" fill="none" stroke-linecap="round"/>' +
      '<path d="M' + (treeX + 2) + ' 156 C' + (treeX + 10) + ' 118, ' + (treeX + 4) + ' 92, ' +
      (treeX - 6) + ' 62" stroke="#6b4a2f" stroke-width="10" fill="none" stroke-linecap="round"/>';

    // 人物
    const n = era.people && era.people.length ? Math.min(5, era.people.length + 1) : 2;
    let people = '';
    for (let i = 0; i < n; i++) {
      const px = 430 + i * (46 + r() * 26) + r() * 24;
      const ps = 0.78 + r() * 0.34;
      people += personSilhouette(px, 372 + r() * 14, ps, 'rgba(43,33,24,' + (0.5 + r() * 0.2).toFixed(2) + ')', i % 2);
    }

    // 新芽（新时代节点）
    const sprout = era.theme === '新芽' || era.theme === '绽放'
      ? '<g class="sprout" transform="translate(' + (treeX + 104) + ',84)">' +
          '<path d="M0 0 C-16 -6 -22 -22 -12 -30 C-4 -22 -2 -10 0 0 Z" fill="#5f8c46"/>' +
          '<path d="M0 0 C16 -6 22 -22 12 -30 C4 -22 2 -10 0 0 Z" fill="#7aa85e"/>' +
        '</g>'
      : '';

    return (
      '<svg viewBox="0 0 800 500" role="img" aria-label="' + esc(era.scene.caption) + '">' +
        '<defs>' +
          '<linearGradient id="' + uid + 'sky" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="hsl(' + hue + ',58%,86%)"/>' +
            '<stop offset="55%" stop-color="hsl(' + ((hue + 12) % 360) + ',48%,78%)"/>' +
            '<stop offset="100%" stop-color="#f6efe1"/>' +
          '</linearGradient>' +
          '<radialGradient id="' + uid + 'glow" cx="0.77" cy="0.26" r="0.42">' +
            '<stop offset="0%" stop-color="rgba(255,240,205,.95)"/>' +
            '<stop offset="100%" stop-color="rgba(255,240,205,0)"/>' +
          '</radialGradient>' +
        '</defs>' +
        '<rect width="800" height="500" fill="url(#' + uid + 'sky)"/>' +
        '<rect width="800" height="500" fill="url(#' + uid + 'glow)"/>' +
        rings +
        roofs +
        '<rect y="300" width="800" height="200" fill="hsl(' + hue + ',26%,68%)"/>' +
        '<rect y="300" width="800" height="200" fill="url(#' + uid + 'sky)" opacity=".18"/>' +
        '<g opacity=".35">' +
          '<path d="M0 344 L800 344" stroke="#fff" stroke-width="1"/>' +
          '<path d="M0 392 L800 392" stroke="#fff" stroke-width="1"/>' +
        '</g>' +
        foliage + trunk + sprout + people +
        '<rect x="0" y="470" width="800" height="30" fill="' + deep + '" opacity=".18"/>' +
        '<g opacity=".9" transform="translate(24,24)">' +
          '<rect x="0" y="0" width="10" height="70" fill="' + deep + '" opacity=".5"/>' +
          '<text x="20" y="26" font-family="serif" font-size="26" fill="' + deep + '" opacity=".85">' + esc(era.year) + '</text>' +
          '<text x="20" y="50" font-family="serif" font-size="14" fill="#5b4c3c">' + esc(era.title) + '</text>' +
        '</g>' +
        '<text x="776" y="486" text-anchor="end" font-size="11" fill="rgba(43,33,24,.55)">' +
          '示意插画 · 非历史照片 · 来源见说明' +
        '</text>' +
      '</svg>'
    );
  }

  /* ------------------------------ 导出 ------------------------------ */
  window.UI = {
    esc: esc, $: $, $$: $$, qs: qs,
    renderTopbar: renderTopbar,
    renderFooter: renderFooter,
    openModal: openModal,
    closeModal: closeModal,
    showPerson: showPerson,
    showObject: showObject,
    makeScene: makeScene,
    personSilhouette: personSilhouette
  };
})();
