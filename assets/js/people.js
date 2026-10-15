/* =====================================================================
 * people.js  人物长廊
 *  - 人物卡片 → 展开小传 / 与枣树的关系 / 相关史料
 *  - 人物关系图谱（ECharts graph；离线时降级为自绘 SVG）
 * ===================================================================== */
(function () {
  'use strict';
  const S = window.SITE;
  const U = window.UI;
  const esc = U.esc;

  const GROUP_COLOR = { '革命先驱': '#8c1f28', '蒙藏学校学生': '#b5652f' };

  function renderCards() {
    const box = document.getElementById('peopleGrid');
    box.innerHTML = S.PEOPLE.map(function (p) {
      return '<article class="person-card" data-person="' + p.id + '" tabindex="0">' +
        '<div class="person-avatar">' + esc(p.name.charAt(0)) + '</div>' +
        '<h3>' + esc(p.name) + '</h3>' +
        '<div class="life">' + esc(p.life) + '　·　' + esc(p.role) + '</div>' +
        '<div class="role">' + esc(p.tag) + '</div>' +
        '<p class="brief">' + esc(p.brief) + '</p>' +
        '<div class="more">点击展开：小传 · 与枣树的关系 · 史料 →</div>' +
        '</article>';
    }).join('');
    box.addEventListener('click', function (e) {
      const c = e.target.closest('[data-person]');
      if (c) show(c.getAttribute('data-person'));
    });
    box.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const c = e.target.closest('[data-person]');
      if (c) { e.preventDefault(); show(c.getAttribute('data-person')); }
    });
    function show(id) {
      const p = S.getPersonById(id);
      if (!p) return;
      const rel = S.RELATIONS.filter(function (r) { return r.from === id || r.to === id; })
        .map(function (r) {
          const other = S.getPersonById(r.from === id ? r.to : r.from);
          return other ? ('<li>' + esc(other.name) + ' — ' + esc(r.label) + '</li>') : '';
        }).join('');
      U.openModal(
        esc(p.name),
        esc(p.life + '　·　' + p.role + '　·　' + p.group),
        '<p>' + esc(p.brief) + '</p>' +
        '<h4 style="margin:18px 0 6px;font-family:var(--serif)">与枣树的关系</h4>' +
        '<p>' + esc(p.link) + '</p>' +
        '<h4 style="margin:18px 0 6px;font-family:var(--serif)">相关史料与出处</h4>' +
        '<ul>' + p.sources.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
        (rel ? '<h4 style="margin:18px 0 6px;font-family:var(--serif)">关系连线</h4><ul>' + rel + '</ul>' : '')
      );
    }
  }

  function renderGraph() {
    const box = document.getElementById('graph');
    if (!box) return;

    const deg = {};
    S.RELATIONS.forEach(function (r) {
      deg[r.from] = (deg[r.from] || 0) + 1;
      deg[r.to] = (deg[r.to] || 0) + 1;
    });

    const nodes = S.PEOPLE.map(function (p) {
      return {
        id: p.id,
        name: p.name,
        category: p.group === '革命先驱' ? 0 : 1,
        symbolSize: 34 + Math.min(deg[p.id] || 0, 6) * 5,
        value: p.tag,
        label: { show: true, fontSize: 13, fontFamily: 'Songti SC, serif', color: '#2b2118' }
      };
    });
    const links = S.RELATIONS.map(function (r) {
      return { source: r.from, target: r.to, label: { show: true, formatter: r.label, fontSize: 10, color: '#5b4c3c' } };
    });

    if (window.echarts) {
      const chart = window.echarts.init(box, null, { renderer: 'canvas' });
      chart.setOption({
        tooltip: {
          formatter: function (p) {
            if (p.dataType === 'edge') return p.data.label.formatter;
            return '<b>' + p.data.name + '</b><br>' + (p.data.value || '');
          }
        },
        legend: [{
          data: ['革命先驱', '蒙藏学校学生'],
          bottom: 6,
          textStyle: { fontFamily: 'Songti SC, serif', color: '#5b4c3c' }
        }],
        color: ['#8c1f28', '#b5652f'],
        series: [{
          type: 'graph',
          layout: 'force',
          roam: true,
          draggable: true,
          force: { repulsion: 460, edgeLength: [90, 170], gravity: 0.08 },
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: 7,
          lineStyle: { color: 'rgba(107,74,47,.45)', width: 1.4, curveness: 0.12 },
          label: { show: true, position: 'bottom', distance: 6 },
          emphasis: { focus: 'adjacency', lineStyle: { width: 3, color: '#8c1f28' } },
          categories: [{ name: '革命先驱' }, { name: '蒙藏学校学生' }],
          data: nodes,
          links: links
        }]
      });
      chart.on('click', function (p) {
        if (p.dataType === 'node') {
          const card = document.querySelector('.person-card[data-person="' + p.data.id + '"]');
          if (card) card.click();
        }
      });
      window.addEventListener('resize', function () { chart.resize(); });
      return;
    }

    // 降级：自绘 SVG 关系图
    const W = 900, H = 520;
    const pos = {};
    S.PEOPLE.forEach(function (p, i) {
      const left = p.group === '革命先驱';
      const sameGroup = S.PEOPLE.filter(function (q) { return q.group === p.group; });
      const idx = sameGroup.indexOf(p);
      const x = left ? 170 : 680;
      const y = 70 + (idx * (H - 150)) / Math.max(1, sameGroup.length - 1);
      pos[p.id] = { x: x, y: y };
    });
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:100%">';
    S.RELATIONS.forEach(function (r) {
      const a = pos[r.from], b = pos[r.to];
      if (!a || !b) return;
      svg += '<path d="M' + a.x + ' ' + a.y + ' C' + ((a.x + b.x) / 2) + ' ' + a.y + ', ' +
        ((a.x + b.x) / 2) + ' ' + b.y + ', ' + b.x + ' ' + b.y + '" stroke="rgba(107,74,47,.42)" fill="none" stroke-width="1.4"/>';
      svg += '<text x="' + ((a.x + b.x) / 2) + '" y="' + ((a.y + b.y) / 2 - 4) + '" text-anchor="middle" font-size="10" fill="#5b4c3c">' + esc(r.label) + '</text>';
    });
    S.PEOPLE.forEach(function (p) {
      const c = GROUP_COLOR[p.group];
      svg += '<circle cx="' + pos[p.id].x + '" cy="' + pos[p.id].y + '" r="30" fill="' + c + '" opacity=".92"/>';
      svg += '<text x="' + pos[p.id].x + '" y="' + (pos[p.id].y + 6) + '" text-anchor="middle" font-size="15" fill="#fff" font-family="Songti SC, serif">' + esc(p.name.charAt(0)) + '</text>';
      svg += '<text x="' + pos[p.id].x + '" y="' + (pos[p.id].y + 50) + '" text-anchor="middle" font-size="13" fill="#2b2118" font-family="Songti SC, serif">' + esc(p.name) + '</text>';
    });
    svg += '</svg>';
    box.innerHTML = svg;
    document.getElementById('graphNote').textContent = '（当前为离线简化关系图；联网加载 ECharts 后可拖拽、放大查看）';
  }

  U.renderTopbar('people.html');
  U.renderFooter();
  function boot() { renderCards(); renderGraph(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
