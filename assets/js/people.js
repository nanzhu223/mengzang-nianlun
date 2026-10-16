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

  /* =====================================================================
   * 树冠背景：程序化 Canvas 2D 枣树树冠
   *  - 实色团块堆出树冠轮廓，叶缘毛边 + 明暗体积 + 叶隙、枣
   *  - 无外部素材；卡片（圆形）铺在树冠之上，读作“树上结枣”
   * ===================================================================== */
  const LEAF_RGB = [
    [96, 120, 80], [110, 134, 90], [122, 148, 100],
    [134, 160, 112], [148, 172, 126], [104, 130, 86], [88, 112, 74]
  ];
  const FRUIT_RGB = [[158, 76, 62], [140, 62, 52], [168, 92, 74]];
  let canopyW = -1, canopyH = -1;

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  function drawCanopy(cv, W, H) {
    if (W < 60 || H < 60) return;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const rnd = mulberry32(20241017);
    const cx = W / 2, cy = H * 0.485, rx = W * 0.45, ry = H * 0.44;
    const R = Math.min(rx, ry);

    // ---------------- ① 树冠主体：实色（衬底 + 团块） ----------------
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const base = ctx.createRadialGradient(0, 0, rx * 0.22, 0, 0, rx * 0.96);
    base.addColorStop(0, 'rgb(114,140,94)');
    base.addColorStop(1, 'rgb(96,122,78)');
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.arc(0, 0, rx * 0.96, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    function clump(x, y, r) {
      ctx.fillStyle = rgb(LEAF_RGB[(rnd() * LEAF_RGB.length) | 0]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 内部团块：制造体块与色斑
    const nIn = Math.max(46, Math.round((rx * ry) / (R * R) * 24));
    for (let i = 0; i < nIn; i++) {
      const a = rnd() * Math.PI * 2, u = Math.sqrt(rnd()) * 0.88;
      clump(cx + Math.cos(a) * rx * u, cy + Math.sin(a) * ry * u, R * (0.15 + rnd() * 0.13));
    }
    // 边缘团块：轮廓自然起伏
    const nE = Math.max(30, Math.round(((rx + ry) / R) * 8));
    for (let i = 0; i < nE; i++) {
      const a = rnd() * Math.PI * 2, rr = 0.93 + rnd() * 0.13;
      clump(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr, R * (0.12 + rnd() * 0.12));
    }
    // 探出树冠的小簇
    for (let i = 0; i < 20; i++) {
      const a = rnd() * Math.PI * 2, rr = 1.04 + rnd() * 0.13;
      clump(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr, R * (0.05 + rnd() * 0.07));
    }

    // ---------------- ② 叶缘：沿轮廓长出小叶片，边界“毛”起来 ----------------
    const nL = Math.max(90, Math.round((rx + ry) / 3.2));
    for (let i = 0; i < nL; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = 0.97 + rnd() * 0.15;
      const c = LEAF_RGB[2 + ((rnd() * (LEAF_RGB.length - 2)) | 0)];
      const s = 4.5 + rnd() * 8;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr);
      ctx.rotate(a + (rnd() - 0.5) * 0.8);
      ctx.fillStyle = rgb(c);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.6, s * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---------------- ③ 体积：只在树冠像素上叠加明暗 ----------------
    ctx.globalCompositeOperation = 'source-atop';
    const sh = ctx.createLinearGradient(cx - rx * 0.9, cy - ry, cx + rx * 0.85, cy + ry * 1.05);
    sh.addColorStop(0, 'rgba(233,242,214,.34)');      // 高光（左上）
    sh.addColorStop(0.42, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(32,50,24,.40)');         // 暗部（右下）
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, W, H);
    // 叶层深处
    const inner = ctx.createRadialGradient(cx, cy + ry * 0.12, R * 0.1, cx, cy + ry * 0.12, R * 1.5);
    inner.addColorStop(0, 'rgba(28,46,22,.22)');
    inner.addColorStop(0.55, 'rgba(28,46,22,.07)');
    inner.addColorStop(1, 'rgba(28,46,22,0)');
    ctx.fillStyle = inner;
    ctx.beginPath(); ctx.arc(cx, cy + ry * 0.12, R * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // ---------------- ④ 叶隙：外缘几处透空，像叶片间的缝 ----------------
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = 0.5 + rnd() * 0.5;
      const x = cx + Math.cos(a) * rx * rr, y = cy + Math.sin(a) * ry * rr;
      const r = 5 + rnd() * 15;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,' + (0.45 + rnd() * 0.35).toFixed(2) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---------------- ⑤ 枣：少量暗红点 ----------------
    const nf = Math.max(8, Math.round((rx * ry) / 5200));
    for (let i = 0; i < nf; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = 0.55 + rnd() * 0.42;
      const c = FRUIT_RGB[(rnd() * FRUIT_RGB.length) | 0];
      ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (0.5 + rnd() * 0.35).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr, 3 + rnd() * 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function renderCanopy() {
    const wrap = document.getElementById('peopleCanopy');
    const cv = document.getElementById('canopyCanvas');
    if (!wrap || !cv) return;
    const W = Math.round(wrap.clientWidth), H = Math.round(wrap.clientHeight);
    if (W === canopyW && H === canopyH) return;
    canopyW = W; canopyH = H;
    drawCanopy(cv, W, H);
  }

  function renderCards() {
    const box = document.getElementById('peopleGrid');
    box.innerHTML = S.PEOPLE.map(function (p) {
      return '<article class="person-card" data-person="' + p.id + '" tabindex="0">' +
        '<div class="person-avatar">' + esc(p.name.charAt(0)) + '</div>' +
        '<h3>' + esc(p.name) + '</h3>' +
        '<div class="life">' + esc(p.life) + '　·　' + esc(p.role) + '</div>' +
        '<div class="role">' + esc(p.tag) + '</div>' +
        '<p class="brief">' + esc(p.brief) + '</p>' +
        '<div class="more">点击展开 →</div>' +
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
  function boot() {
    renderCards();
    renderCanopy();                       // 卡片布局完成后再量取尺寸，绘制树冠
    renderGraph();

    let rt = null;
    window.addEventListener('resize', function () {
      if (rt) clearTimeout(rt);
      rt = setTimeout(renderCanopy, 160);
    });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(renderCanopy).observe(document.getElementById('peopleCanopy'));
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderCanopy);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
