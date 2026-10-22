/* =====================================================================
 * agent.js  “问枣树”智能体
 * 架构：RAG（检索增强生成）
 *   1) 检索层：对史料库 / 人物档案 / 枣树独白建立本地索引，用中文 n-gram 评分召回
 *   2) 生成层：默认使用本地“枣树语气”生成器（离线可用，答案严格来自召回史料）
 *              若在 localStorage 配置了大模型接口（OpenAI 兼容），则把召回史料作为
 *              上下文交给大模型生成，实现真正的 RAG 链路，并强制返回引用出处
 * ===================================================================== */
(function () {
  'use strict';
  const S = window.SITE;
  const esc = window.UI.esc;

  /* ------------------------------------------------------------------
   * 接入配置（可选）：在页面中通过
   *   <script>window.NIANLUN_AGENT_CONFIG = { mode:'backend', backend:'http://127.0.0.1:8000/api/ask' }</script>
   * 覆盖默认值。mode: 'auto' | 'local' | 'backend' | 'llm'
   *   local   —— 纯前端本地 RAG（默认，离线可用）
   *   backend —— 调用 Python 后端 /api/ask（真实 RAG：检索 + 生成）
   *   llm     —— 浏览器直连 OpenAI 兼容大模型，史料作为上下文注入
   * ------------------------------------------------------------------ */
  const CONFIG = Object.assign({
    mode: 'auto',
    backend: '',
    llm: null
  }, window.NIANLUN_AGENT_CONFIG || {});

  /* --------------------------- 1. 语料与索引 --------------------------- */
  const DOCS = [];

  S.ERAS.forEach(function (era, i) {
    era.facts.forEach(function (f, j) {
      DOCS.push({
        id: era.id + '#' + j,
        kind: '史料',
        year: era.year,
        eraId: era.id,
        title: era.title + '（' + era.year + '）',
        text: f.text,
        source: f.source,
        tags: (era.keywords || []).concat([era.year, era.title, era.event])
      });
    });
    // 枣树独白作为“叙述性语料”，仅在问“讲故事”类问题时使用
    DOCS.push({
      id: era.id + '#mono',
      kind: '独白',
      year: era.year,
      eraId: era.id,
      title: '枣树独白 · ' + era.year,
      text: era.monologue,
      source: '团队原创文学性叙事（史实依据见该年代史料卡片）',
      tags: (era.keywords || []).concat([era.year, era.title])
    });
  });

  S.PEOPLE.forEach(function (p) {
    DOCS.push({
      id: 'p-' + p.id,
      kind: '人物',
      year: p.life,
      eraId: null,
      personId: p.id,
      title: p.name + '（' + p.life + '）',
      text: p.brief + ' 与枣树的关系：' + p.link,
      source: p.sources.join('；'),
      tags: [p.name, p.role, p.tag, p.group]
    });
  });

  const SYN = [
    [['多老', '多少年', '几岁', '树龄', '站了', '活了', '年龄'], '枣树 清初 400 年 树龄'],
    [['为什么重要', '地位', '意义', '价值'], '第一个 少数民族 党支部 体验馆 传播 起点'],
    [['入党', '党员', '党支部', '党组织'], '1924 党支部 多松年 李裕智 吉雅泰 孟纯'],
    [['先生', '大钊', '守常'], '李大钊'],
    [['乌老', '乌兰夫', '副主席'], '乌兰夫'],
    [['刊物', '报纸', '杂志', '蒙古农民'], '蒙古农民 创刊 多松年 乌兰夫 奎璧'],
    [['五四', '游行', '罢课'], '1919 五四 晨报 荣耀先'],
    [['体验馆', '开放', '展馆'], '2023 中华民族共同体体验馆 开放'],
    [['研学', '思政课', '学生来'], '2024 行走的大思政课 在京高校'],
    [['建校', '办学', '开学', '成立'], '1913 蒙藏学校 创立'],
    [['胡同', '地址', '在哪', '校址'], '石虎胡同 33 号 1916 迁址']
  ];

  function toks(q) {
    const out = [];
    const s = String(q).toLowerCase();
    const segs = s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, ' ').trim().split(/\s+/);
    segs.forEach(function (seg) {
      if (!seg) return;
      if (/[\u4e00-\u9fa5]/.test(seg)) {
        out.push(seg);
        for (let n = 2; n <= 4; n++) {
          for (let i = 0; i + n <= seg.length; i++) out.push(seg.substr(i, n));
        }
      } else if (seg.length > 1) {
        out.push(seg);
      }
    });
    // 同义扩展
    SYN.forEach(function (pair) {
      if (pair[0].some(function (w) { return s.indexOf(w) >= 0; })) {
        pair[1].split(/\s+/).forEach(function (w) { out.push(w); });
      }
    });
    return out;
  }

  function docField(d) {
    return (d.title + ' ' + d.text + ' ' + (d.tags || []).join(' ') + ' ' + (d.source || '')).toLowerCase();
  }

  function retrieve(q, k, opts) {
    opts = opts || {};
    const t = toks(q);
    const df = {};
    DOCS.forEach(function (d) {
      const f = docField(d);
      const seen = {};
      t.forEach(function (w) {
        if (!w || seen[w]) return;
        seen[w] = 1;
        if (f.indexOf(w) >= 0) df[w] = (df[w] || 0) + 1;
      });
    });
    const N = DOCS.length;
    const scored = DOCS.map(function (d) {
      const f = docField(d);
      let score = 0;
      const seen = {};
      t.forEach(function (w) {
        if (!w || seen[w]) return;
        seen[w] = 1;
        const idf = Math.log(1 + N / (1 + (df[w] || 0)));
        const len = w.length;
        let tf = f.split(w).length - 1;
        if (!tf) return;
        tf = Math.min(tf, 4);
        const weight = len <= 1 ? 0.6 : len === 2 ? 1.0 : len === 3 ? 1.5 : 1.35;
        score += idf * (1 + Math.log(tf)) * weight;
      });
      if (opts.preferNarrative && d.kind === '独白') score *= 1.5;
      if (opts.kind && d.kind === opts.kind) score *= 1.3;
      return { doc: d, score: score };
    });
    return scored
      .filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, k || 4);
  }

  /* --------------------------- 2. 本地生成 --------------------------- */
  const NARRATIVE_INTENT = /讲.*故事|说说|叙述|细讲|详细|描述|画面|当时.*样子|讲讲/;

  function trim(s, n) {
    s = String(s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n).replace(/[，、；]$/, '') + '……' : s;
  }

  function eraLink(eraId, label) {
    if (!eraId) return '';
    const era = S.getEraById(eraId);
    if (!era) return '';
    return '<a href="era.html?era=' + era.id + '">进入 ' + esc(label || era.year) + ' 年轮 →</a>';
  }

  function localAnswer(q) {
    const narrative = NARRATIVE_INTENT.test(q);
    const hits = retrieve(q, 4, { preferNarrative: narrative });
    if (!hits.length) {
      return {
        text:
          '我在西院的墙根站了快四百年，能讲的都是这院子里的事：1913 年建校、1919 年孩子们上街、1923 年冬夜的长谈、1924 年第一个少数民族党支部、1925 年《蒙古农民》，还有 1984 年、2023 年、2024 年。\n' +
          '你换个说法问问我？比如“1923 年的冬天发生了什么”。',
        cites: [],
        links: []
      };
    }

    const top = hits[0].doc;
    // 特殊意图：树龄
    if (/多老|多少年|几岁|树龄|站了|活了|年龄/.test(q)) {
      const era = S.getEraById('qingchu');
      return {
        text:
          '我是一棵枣树，始植于清初，到今天差不多四百岁了。我见过的事都记在年轮里：清初扎根、1913 年建校、1919 年学生上街、1923 年冬夜的长谈、1924 年第一个由少数民族党员组成的党支部成立、1925 年《蒙古农民》创刊，一直到 2023 年这里成为“中华民族共同体体验馆”、2024 年学生们来上“行走的大思政课”。',
        cites: [era.facts[0].text + '（出处：' + era.facts[0].source + '）'],
        links: [era]
      };
    }

    let body;
    if (narrative && top.kind === '独白') {
      body = trim(top.text, 260) + '（这一段是我自己的记忆，属文学性叙述，史实依据见该年代的史料卡片。）';
    } else if (top.kind === '人物') {
      const p = S.getPersonById(top.personId);
      body = trim(p.brief, 180) + '\n' + trim(p.link, 80);
    } else {
      body = trim(top.text, 200);
    }

    const extra = hits.slice(1, 3).map(function (h) { return trim(h.doc.text, 110); });
    const head = q.indexOf('你') >= 0 || /见过|知道|记得/.test(q)
      ? '这事我记着。'
      : '你问的这段，我正好在场。';

    const text = [
      head + '（' + (top.year || '') + '）',
      body
    ].concat(extra.length ? ['我还记得些旁的：', extra.map(function (s) { return '· ' + s; }).join('\n')] : []).join('\n');

    const cites = hits.slice(0, 3).map(function (h) {
      return h.doc.text.slice(0, 60) + (h.doc.text.length > 60 ? '……' : '') + '（出处：' + h.doc.source + '）';
    });
    const linkEras = [];
    hits.slice(0, 3).forEach(function (h) {
      const e = S.getEraById(h.doc.eraId);
      if (e && linkEras.indexOf(e) < 0) linkEras.push(e);
    });
    return { text: text, cites: cites, links: linkEras };
  }

  /* --------------------------- 3. 远程大模型（可选） --------------------------- */
  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem('nianlun_agent_llm') || 'null');
    } catch (e) { return null; }
  }

  function remoteAnswer(q, cfg) {
    const hits = retrieve(q, 6);
    const context = hits.map(function (h) {
      return '【' + h.doc.title + '】' + h.doc.text + '（出处：' + h.doc.source + '）';
    }).join('\n');
    const system =
      '你是“问枣树”智能体：一棵见证了蒙藏学校旧址近四百年历史的枣树，语气温和、有历史感但不说教，用第一人称“我”说话。\n' +
      '硬性规则：\n' +
      '1) 只能依据下面提供的史料回答，不得编造史实、年份、人名或引文；不确定就说“这个我记不清了”。\n' +
      '2) 回答控制在 180 字以内，可适度使用枣树的口吻，但史实必须与资料一致。\n' +
      '3) 结尾用“出处：……”列出来源。\n' +
      '史料：\n' + (context || '（未检索到相关史料）');
    return fetch(cfg.endpoint, {
      method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}
      ),
      body: JSON.stringify({
        model: cfg.model || 'gpt-4o-mini',
        temperature: 0.6,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: q }
        ]
      })
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        const t = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        if (!t) throw new Error('empty');
        return {
          text: t,
          cites: hits.slice(0, 3).map(function (h) { return '出处：' + h.doc.source; }),
          links: hits.slice(0, 2).map(function (h) { return S.getEraById(h.doc.eraId); }).filter(Boolean),
          engine: '远程大模型 + 本地检索（RAG）'
        };
      });
  }

  /* --------------------------- 3b. 后端 RAG 接口（可选） --------------------------- */
  function backendAnswer(q, url) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q })
    })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        const cites = (j.citations || []).map(function (c) {
          return typeof c === 'string' ? c : (c.text ? c.text + '（出处：' + c.source + '）' : String(c));
        });
        return {
          text: j.answer || '',
          cites: cites,
          links: (j.eraIds || []).map(function (id) { return S.getEraById(id); }).filter(Boolean),
          engine: '后端 RAG 接口（检索 + 生成）　' + (j.engine || '')
        };
      });
  }

  function ask(q) {
    const cfg = getConfig();
    if (CONFIG.mode === 'backend' && CONFIG.backend) {
      return backendAnswer(q, CONFIG.backend).catch(function () { return localAnswer(q); });
    }
    if (cfg && cfg.endpoint) {
      return remoteAnswer(q, cfg).catch(function () { return localAnswer(q); });
    }
    if (CONFIG.llm && CONFIG.llm.endpoint) {
      return remoteAnswer(q, CONFIG.llm).catch(function () { return localAnswer(q); });
    }
    // 本地模式：同步检索式生成（无需网络、无计时器依赖）
    return Promise.resolve().then(function () { return localAnswer(q); });
  }

  /* --------------------------- 4. 界面 --------------------------- */
  function boot() {
    const A = S.AGENT;

    const fab = document.createElement('button');
    fab.className = 'agent-fab';
    fab.innerHTML = '<span class="dot"></span><span>问枣树</span>';
    fab.title = '与“' + A.name + '”对话（智能体）';
    document.body.appendChild(fab);

    const panel = document.createElement('section');
    panel.className = 'agent';
    panel.innerHTML =
      '<div class="agent-head">' +
        '<span class="dot" style="width:24px;height:24px;border-radius:50%;background:repeating-radial-gradient(circle at 50% 50%,#e6c887 0 2px,#b8874a 2px 4px)"></span>' +
        '<div><div class="t">问枣树</div><div class="s">蒙藏学校旧址 · 史料检索型智能体</div></div>' +
        '<button aria-label="收起">–</button>' +
      '</div>' +
      '<div class="agent-body" id="agentBody"></div>' +
      '<div class="agent-presets" id="agentPresets"></div>' +
      '<div class="agent-input">' +
        '<input id="agentInput" type="text" placeholder="问问我这四百年里的事…" autocomplete="off">' +
        '<button id="agentSend">问</button>' +
      '</div>';
    document.body.appendChild(panel);

    const body = panel.querySelector('#agentBody');
    const presets = panel.querySelector('#agentPresets');
    const input = panel.querySelector('#agentInput');

    presets.innerHTML = A.presets.map(function (p) {
      return '<button type="button">' + esc(p) + '</button>';
    }).join('');
    presets.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      send(b.textContent);
    });

    document.querySelector('.agent-head button').addEventListener('click', function () {
      panel.classList.remove('on');
      fab.style.display = 'flex';
    });
    fab.addEventListener('click', function () {
      panel.classList.add('on');
      fab.style.display = 'none';
      input.focus();
    });
    panel.querySelector('#agentSend').addEventListener('click', function () { send(input.value); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(input.value); });

    function bubble(cls, html) {
      const d = document.createElement('div');
      d.className = 'msg ' + cls;
      d.innerHTML = '<div class="bubble">' + html + '</div>';
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
      return d;
    }

    function send(text) {
      text = (text || '').trim();
      if (!text) return;
      input.value = '';
      bubble('me', esc(text));
      const wait = bubble('tree', '<span class="typing"><i></i><i></i><i></i></span>');
      ask(text).then(function (res) {
        let html = esc(res.text).replace(/\n/g, '<br>');
        if (res.cites && res.cites.length) {
          html += '<div class="cite">' + res.cites.map(function (c) { return '· ' + esc(c); }).join('<br>') +
            (res.engine ? '<br><span style="opacity:.75">生成链路：' + esc(res.engine) + '</span>' : '') + '</div>';
        }
        if (res.links && res.links.length) {
          html += '<div class="cite">' + res.links.map(function (e) {
            return '<a href="era.html?era=' + e.id + '">进入 ' + esc(e.year) + ' 年轮 →</a>';
          }).join('　') + '</div>';
        }
        wait.querySelector('.bubble').innerHTML = html;
        body.scrollTop = body.scrollHeight;
      });
    }

    // 首次打开时的问候
    let greeted = false;
    function greet() {
      if (greeted) return;
      greeted = true;
      bubble('tree', esc(A.greeting));
    }
    fab.addEventListener('click', greet);

    // 供 3D 场景等处直接唤起对话（openWith('问题') 会打开面板并提问）
    function openPanel() {
      panel.classList.add('on');
      fab.style.display = 'none';
      greet();
    }
    function openWith(q) {
      openPanel();
      if (q) send(q); else input.focus();
    }
    window.NIANLUN_AGENT = Object.assign(window.NIANLUN_AGENT || {}, { openWith: openWith });
  }

  window.NIANLUN_AGENT = { ask: ask, retrieve: retrieve, localAnswer: localAnswer };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
