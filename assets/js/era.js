/* =====================================================================
 * era.js  年代内容页（共 11 个年代，由 ?era=<id> 驱动）
 *  - 场景图（程序化示意插画 + 来源标注）
 *  - 枣树独白（第一人称，200—300 字，可朗读）
 *  - 史料卡片（2—3 条，逐条标注出处）
 *  - 交互元素：人物卡片 / 物件标签 → 弹窗
 *  - 前后导航：按钮、左右方向键、左右滑动
 * ===================================================================== */
(function () {
  'use strict';
  const S = window.SITE;
  const U = window.UI;
  const esc = U.esc;

  function render() {
    const key = U.qs('era') || U.qs('year');
    let era = key ? (S.getEraById(key) || S.getEraByYear(key)) : null;
    if (!era) era = S.ERAS[0];
    const i = S.indexOfEra(era.id);
    const prev = S.ERAS[i - 1] || null;
    const next = S.ERAS[i + 1] || null;

    document.title = era.year + '　' + era.title + ' | 触摸年轮 · 蒙藏学校旧址数字记忆';

    /* ---------------- 头部 ---------------- */
    document.getElementById('eraHead').innerHTML =
      '<a class="btn ghost" href="index.html" style="font-size:13px;padding:6px 14px">← 返回年轮</a>' +
      '<div class="era-head-top" style="margin-top:18px">' +
        '<div>' +
          '<span class="era-ring-tag" style="background:' + ['#c9a26a','#c39a63','#b98a55','#a86a44','#9c4d38','#8c1f28','#a33227','#b5652f','#c08a45','#cf9b56','#5f8c46'][i] + '">' +
            esc(era.ring) + '</span>' +
          '<div class="era-year">' + esc(era.year) + '<small>' + esc(era.title) + '</small></div>' +
        '</div>' +
        '<div class="era-progress">' +
          '第 ' + (i + 1) + ' / ' + S.ERAS.length + ' 圈　·　由内向外 = 由古至今' +
          '<div class="bar"><i style="width:' + (((i + 1) / S.ERAS.length) * 100).toFixed(1) + '%"></i></div>' +
        '</div>' +
      '</div>' +
      '<p class="lead" style="margin-top:16px">' + esc(era.event) + '</p>';

    /* ---------------- 场景图 ---------------- */
    const fig = document.getElementById('eraScene');
    fig.innerHTML = U.makeScene(era) +
      '<figcaption><b>' + esc(era.scene.caption) + '</b>' + esc(era.scene.source) + '</figcaption>';

    /* ---------------- 枣树独白 ---------------- */
    const mono = document.getElementById('eraMonologue');
    mono.innerHTML =
      '<div class="monologue-label">枣树独白 · 第一人称</div>' +
      '<p id="monoText">' + esc(era.monologue) + '</p>' +
      '<div class="sign">—— 西院枣树（约 400 岁），' + esc(era.year) + '</div>' +
      '<div class="monologue-actions">' +
        '<button class="mini-btn" id="btnRead">🔊 听枣树讲</button>' +
        '<button class="mini-btn" id="btnStop">⏹ 停止</button>' +
        '<button class="mini-btn" id="btnCopy">⧉ 复制独白</button>' +
        '<span class="mini-btn" style="cursor:default;border-style:solid;opacity:.8">' + era.monologue.length + ' 字</span>' +
      '</div>';

    /* ---------------- 史料卡片 ---------------- */
    document.getElementById('eraFacts').innerHTML = era.facts.map(function (f, j) {
      return '<article class="fact">' +
        '<div class="idx">史料卡片 ' + String(j + 1).padStart(2, '0') + '</div>' +
        '<p>' + esc(f.text) + '</p>' +
        '<div class="src">出处：<b>' + esc(f.source) + '</b></div>' +
        '</article>';
    }).join('');

    /* ---------------- 交互元素 ---------------- */
    const peopleTags = (era.people || []).map(function (pid) {
      const p = S.getPersonById(pid);
      if (!p) return '';
      return '<button class="tag person" data-person="' + p.id + '">' + esc(p.name) + '　<small style="opacity:.75">' +
        esc(p.tag) + '</small></button>';
    }).join('');
    const objTags = (era.objects || []).map(function (o) {
      return '<button class="tag" data-object="' + esc(o.name) + '">' + esc(o.name) + '</button>';
    }).join('');
    document.getElementById('eraTags').innerHTML =
      (peopleTags ? '<div class="muted" style="width:100%;margin-bottom:2px">点击人物卡片或物件标签，展开详细信息</div>' + peopleTags : '') +
      objTags;

    document.getElementById('eraTags').addEventListener('click', function (e) {
      const pt = e.target.closest('[data-person]');
      if (pt) return U.showPerson(pt.getAttribute('data-person'));
      const ot = e.target.closest('[data-object]');
      if (ot) return U.showObject(era.id, ot.getAttribute('data-object'));
    });

    /* ---------------- 前后导航 ---------------- */
    const nav = document.getElementById('eraNav');
    nav.innerHTML =
      (prev
        ? '<a class="prev" href="era.html?era=' + prev.id + '"><span class="k">← 上一年轮</span><b>' + esc(prev.year) + '　' + esc(prev.title) + '</b></a>'
        : '<a class="prev" href="index.html"><span class="k">← 回到年轮起点</span><b>触摸年轮 · 首页</b></a>') +
      (next
        ? '<a class="next" href="era.html?era=' + next.id + '"><span class="k">下一年轮 →</span><b>' + esc(next.year) + '　' + esc(next.title) + '</b></a>'
        : '<a class="next" href="about.html"><span class="k">外圈之后 →</span><b>关于我们 · 作品说明</b></a>');

    /* ---------------- 其他年轮速览 ---------------- */
    document.getElementById('eraOthers').innerHTML = S.ERAS.map(function (e2, k) {
      return '<a class="tl-item"' + (e2.id === era.id ? ' style="border-color:var(--red);box-shadow:0 6px 16px rgba(140,31,40,.18)"' : '') +
        ' href="era.html?era=' + e2.id + '"><b>' + esc(e2.year) + '</b><span>' + esc(e2.title) + '</span></a>';
    }).join('');

    /* ---------------- 交互：朗读 / 复制 ---------------- */
    let utter = null;
    document.getElementById('btnRead').addEventListener('click', function () {
      if (!('speechSynthesis' in window)) { alert('当前浏览器不支持语音朗读，可直接阅读文字。'); return; }
      window.speechSynthesis.cancel();
      utter = new SpeechSynthesisUtterance(era.monologue);
      utter.lang = 'zh-CN';
      utter.rate = 0.92;
      utter.pitch = 0.95;
      window.speechSynthesis.speak(utter);
    });
    document.getElementById('btnStop').addEventListener('click', function () {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    });
    document.getElementById('btnCopy').addEventListener('click', function () {
      const t = era.monologue;
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { flash('已复制独白文本'); });
      else flash('请手动选择文本复制');
    });
    function flash(msg) {
      const el = document.createElement('div');
      el.textContent = msg;
      el.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:#2b2118;color:#f6efe1;padding:10px 18px;border-radius:999px;font-size:14px;z-index:300;box-shadow:var(--shadow-lg)';
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 1600);
    }

    /* ---------------- 键盘 / 触屏切换年代 ---------------- */
    function jump(dir) {
      const t = dir > 0 ? next : prev;
      if (t) location.href = 'era.html?era=' + t.id;
      else if (dir > 0) location.href = 'about.html';
      else location.href = 'index.html';
    }
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') jump(1);
      if (e.key === 'ArrowLeft') jump(-1);
    });
    let sx = 0, sy = 0;
    document.addEventListener('touchstart', function (e) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) jump(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  U.renderTopbar('index.html');
  U.renderFooter();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
