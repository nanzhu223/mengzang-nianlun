/* =====================================================================
 * archive.js  史料库
 *  - 按年代分类的史料条目，逐条标注来源
 *  - 关键词搜索（命中高亮）、年代/标签筛选
 *  - 与智能体联动：一键把检索词交给“问枣树”
 * ===================================================================== */
(function () {
  'use strict';
  const S = window.SITE;
  const U = window.UI;
  const esc = U.esc;

  const state = { q: '', era: 'all', kw: '' };

  function highlight(text, q) {
    if (!q) return esc(text);
    const safe = esc(text);
    const terms = (q.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || [q]).filter(function (t) { return t.length >= 2; });
    let out = safe;
    terms.forEach(function (t) {
      const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      out = out.replace(re, function (m) { return '<mark>' + m + '</mark>'; });
    });
    return out;
  }

  function filtered() {
    const q = state.q.trim();
    return S.ARCHIVE.filter(function (it) {
      if (state.era !== 'all' && it.eraId !== state.era) return false;
      if (state.kw && it.tags.indexOf(state.kw) < 0 && it.text.indexOf(state.kw) < 0) return false;
      if (!q) return true;
      const hay = (it.text + it.source + it.title + it.year + it.tags.join(' ')).toLowerCase();
      const terms = q.toLowerCase().match(/[\u4e00-\u9fa5A-Za-z0-9]{1,}/g) || [];
      return terms.some(function (t) { return hay.indexOf(t) >= 0; });
    });
  }

  function render() {
    const list = document.getElementById('arcList');
    const items = filtered();
    document.getElementById('arcCount').textContent = items.length + ' / ' + S.ARCHIVE.length + ' 条';
    if (!items.length) {
      list.innerHTML = '<div class="arc-empty">没有检索到相关史料。可尝试缩短关键词，或直接问“问枣树”智能体。</div>';
      return;
    }
    list.innerHTML = items.map(function (it) {
      return '<article class="arc-item">' +
        '<div class="top">' +
          '<span class="code">' + esc(it.id) + '</span>' +
          '<span class="yr">' + esc(it.year) + '</span>' +
          '<a href="era.html?era=' + it.eraId + '">' + esc(it.title) + ' →</a>' +
        '</div>' +
        '<p style="margin:8px 0 0">' + highlight(it.text, state.q) + '</p>' +
        '<div class="src">出处：<b>' + esc(it.source) + '</b>　·　标签：' + it.tags.slice(0, 4).map(esc).join(' / ') + '</div>' +
        '</article>';
    }).join('');
  }

  function renderFilters() {
    const box = document.getElementById('eraFilters');
    const opts = [{ id: 'all', label: '全部年代' }].concat(S.ERAS.map(function (e) { return { id: e.id, label: e.year + ' ' + e.title }; }));
    box.innerHTML = opts.map(function (o) {
      return '<button class="mini-btn' + (state.era === o.id ? ' on' : '') + '" data-era="' + o.id + '">' + esc(o.label) + '</button>';
    }).join('');
    box.addEventListener('click', function (e) {
      const b = e.target.closest('[data-era]');
      if (!b) return;
      state.era = b.getAttribute('data-era');
      U.$$('[data-era]', box).forEach(function (x) { x.classList.toggle('on', x === b); });
      render();
    });
  }

  function renderSources() {
    document.getElementById('sourceList').innerHTML = S.SOURCES.map(function (s) {
      return '<li><b>' + esc(s.name) + '</b>　' + esc(s.note) + '</li>';
    }).join('');
  }

  function boot() {
    const q0 = U.qs('q');
    const e0 = U.qs('era');
    if (q0) { state.q = q0; document.getElementById('arcSearch').value = q0; }
    if (e0) state.era = e0;

    renderFilters();
    renderSources();
    render();

    document.getElementById('arcSearch').addEventListener('input', function (e) {
      state.q = e.target.value;
      render();
    });
    document.getElementById('arcAsk').addEventListener('click', function () {
      const q = state.q.trim() || '蒙藏学校的历史';
      const input = document.getElementById('agentInput');
      if (input) {
        const panel = document.querySelector('.agent');
        if (panel) panel.classList.add('on');
        const fab = document.querySelector('.agent-fab');
        if (fab) fab.style.display = 'none';
        input.value = '';
        const send = document.getElementById('agentSend');
        input.value = q;
        send.click();
      } else {
        location.href = 'index.html?q=' + encodeURIComponent(q);
      }
    });
    // 支持 ?q= 从其他页面跳转过来
    window.ARC = { setQuery: function (q) { state.q = q; document.getElementById('arcSearch').value = q; render(); } };
  }

  U.renderTopbar('archive.html');
  U.renderFooter();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
