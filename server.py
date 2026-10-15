# -*- coding: utf-8 -*-
"""
触摸年轮 · 蒙藏学校旧址中华民族共同体数字记忆
后端服务（可选）：静态站点托管 + 史料库 API + 智能体“问枣树”RAG 接口

启动：
    pip install flask
    python server.py            # 默认 http://127.0.0.1:8000

接入大模型（可选，真正的生成式 RAG）：
    set OPENAI_API_KEY=sk-xxx               # Windows
    set OPENAI_BASE_URL=https://api.openai.com/v1
    set OPENAI_MODEL=gpt-4o-mini
未配置时，/api/ask 使用与前端一致的“检索式生成”（离线可用，答案严格取自史料库）。

语料单一数据源：assets/data/corpus.json（由 node tools/export-corpus.js 生成）
"""
import json
import math
import os
import re
import urllib.request
import urllib.error
from pathlib import Path

try:
    from flask import Flask, jsonify, request, send_from_directory, abort
except ImportError:  # pragma: no cover
    raise SystemExit('请先安装依赖：pip install flask')

ROOT = Path(__file__).resolve().parent
CORPUS_PATH = ROOT / 'assets' / 'data' / 'corpus.json'

app = Flask(__name__, static_folder=None)


# --------------------------------------------------------------------------
# 语料
# --------------------------------------------------------------------------
def load_corpus():
    if not CORPUS_PATH.exists():
        raise SystemExit('缺少语料文件，请先运行：node tools/export-corpus.js')
    with CORPUS_PATH.open('r', encoding='utf-8') as f:
        return json.load(f)


CORPUS = load_corpus()

# 把「史料 + 人物 + 枣树独白」统一成检索文档
DOCS = []
for era in CORPUS['eras']:
    for i, fact in enumerate(era['facts']):
        DOCS.append({
            'id': f"{era['id']}#{i}",
            'kind': '史料',
            'eraId': era['id'],
            'year': era['year'],
            'title': f"{era['title']}（{era['year']}）",
            'text': fact['text'],
            'source': fact['source'],
            'tags': era.get('keywords', []) + [era['year'], era['title'], era['event']],
        })
    DOCS.append({
        'id': f"{era['id']}#mono",
        'kind': '独白',
        'eraId': era['id'],
        'year': era['year'],
        'title': f"枣树独白 · {era['year']}",
        'text': era['monologue'],
        'source': '团队原创文学性叙事（史实依据见该年代史料卡片）',
        'tags': era.get('keywords', []) + [era['year'], era['title']],
    })

for p in CORPUS['people']:
    DOCS.append({
        'id': 'p-' + p['id'],
        'kind': '人物',
        'eraId': None,
        'personId': p['id'],
        'year': p['life'],
        'title': f"{p['name']}（{p['life']}）",
        'text': p['brief'] + ' 与枣树的关系：' + p['link'],
        'source': '；'.join(p['sources']),
        'tags': [p['name'], p['role'], p['tag'], p['group']],
    })

SYNONYMS = [
    (['多老', '多少年', '几岁', '树龄', '站了', '活了', '年龄'], '枣树 清初 400 年 树龄'),
    (['为什么重要', '地位', '意义', '价值'], '第一个 少数民族 党支部 体验馆 传播 起点'),
    (['入党', '党员', '党支部', '党组织'], '1924 党支部 多松年 李裕智 吉雅泰 孟纯'),
    (['先生', '大钊', '守常'], '李大钊'),
    (['乌老', '乌兰夫'], '乌兰夫'),
    (['刊物', '报纸', '杂志', '蒙古农民'], '蒙古农民 创刊 多松年 乌兰夫 奎璧'),
    (['五四', '游行', '罢课'], '1919 五四 晨报 荣耀先'),
    (['体验馆', '开放', '展馆'], '2023 中华民族共同体体验馆 开放'),
    (['研学', '思政课'], '2024 行走的大思政课 中央民族大学'),
    (['建校', '办学', '开学', '成立'], '1913 蒙藏学校 创立'),
    (['胡同', '地址', '在哪', '校址'], '石虎胡同 33 号 1916 迁址'),
]


def tokenize(q: str):
    q = q.lower()
    words = []
    for seg in re.split(r'[^\u4e00-\u9fa5a-zA-Z0-9]+', q):
        if not seg:
            continue
        if re.search(r'[\u4e00-\u9fa5]', seg):
            words.append(seg)
            for n in (2, 3, 4):
                words.extend(seg[i:i + n] for i in range(len(seg) - n + 1))
        elif len(seg) > 1:
            words.append(seg)
    for keys, extra in SYNONYMS:
        if any(k in q for k in keys):
            words.extend(extra.split())
    return words


def _field(doc):
    return (doc['title'] + ' ' + doc['text'] + ' ' + ' '.join(doc['tags']) + ' ' + doc['source']).lower()


def retrieve(question: str, top_k: int = 4, narrative: bool = False):
    tokens = tokenize(question)
    if not tokens:
        return []
    fields = [_field(d) for d in DOCS]
    df = {}
    for w in set(tokens):
        df[w] = sum(1 for f in fields if w in f)
    n = len(DOCS)
    scored = []
    for doc, f in zip(DOCS, fields):
        score = 0.0
        for w in set(tokens):
            tf = f.count(w)
            if not tf:
                continue
            tf = min(tf, 4)
            idf = math.log(1 + n / (1 + df.get(w, 0)))
            weight = 0.6 if len(w) <= 1 else 1.0 if len(w) == 2 else 1.5 if len(w) == 3 else 1.35
            score += idf * (1 + math.log(tf)) * weight
        if narrative and doc['kind'] == '独白':
            score *= 1.5
        if score > 0:
            scored.append((score, doc))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [d for _, d in scored[:top_k]]


# --------------------------------------------------------------------------
# 生成层
# --------------------------------------------------------------------------
NARRATIVE_RE = re.compile(r'讲.*故事|说说|叙述|细讲|详细|描述|当时.*样子|讲讲')
AGE_RE = re.compile(r'多老|多少年|几岁|树龄|站了|活了|年龄')


def _trim(s: str, n: int):
    s = re.sub(r'\s+', ' ', str(s)).strip()
    return s if len(s) <= n else re.sub(r'[，、；]$', '', s[:n]) + '……'


def local_generate(question: str):
    """检索式生成：严格基于召回史料，附出处（与前端本地模式一致）"""
    hits = retrieve(question, 4, narrative=bool(NARRATIVE_RE.search(question)))
    if not hits:
        return {
            'answer': '我在西院的墙根站了快四百年，能讲的都是这院子里的事：1913 年建校、1919 年孩子们上街、'
                      '1923 年冬夜的长谈、1924 年第一个少数民族党支部、1925 年《蒙古农民》，还有 1984 年、2023 年、2024 年。'
                      '你换个说法问问我？',
            'citations': [],
            'eraIds': [],
        }

    if AGE_RE.search(question):
        era = next((e for e in CORPUS['eras'] if e['id'] == 'qingchu'), None)
        fact = era['facts'][0] if era else None
        return {
            'answer': '我是一棵枣树，始植于清初，到今天差不多四百岁了。我见过的事都记在年轮里：清初扎根、1913 年建校、'
                      '1919 年学生上街、1923 年冬夜的长谈、1924 年第一个由少数民族党员组成的党支部成立、'
                      '1925 年《蒙古农民》创刊，一直到 2023 年这里成为“中华民族共同体体验馆”、'
                      '2024 年学生们来上“行走的大思政课”。',
            'citations': [{'text': fact['text'], 'source': fact['source']}] if fact else [],
            'eraIds': ['qingchu'],
        }

    top = hits[0]
    if NARRATIVE_RE.search(question) and top['kind'] == '独白':
        body = _trim(top['text'], 260)
    elif top['kind'] == '人物':
        person = next((p for p in CORPUS['people'] if p['id'] == top.get('personId')), None)
        body = _trim(person['brief'], 180) if person else _trim(top['text'], 180)
    else:
        body = _trim(top['text'], 200)

    parts = ['这事我记着。', body]
    if len(hits) > 1:
        parts.append('我还记得些旁的：')
        parts.extend('· ' + _trim(h['text'], 110) for h in hits[1:3])

    citations = [{'text': h['text'], 'source': h['source']} for h in hits[:3]]
    era_ids = []
    for h in hits[:3]:
        if h['eraId'] and h['eraId'] not in era_ids:
            era_ids.append(h['eraId'])
    return {'answer': '\n'.join(parts), 'citations': citations, 'eraIds': era_ids}


def llm_generate(question: str, hits):
    """大模型生成（可选）：把召回史料作为上下文，要求只依据史料作答并给出来源"""
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        return None
    base = os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
    model = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
    context = '\n'.join(
        f"【{h['title']}】{h['text']}（出处：{h['source']}）" for h in hits
    ) or '（未检索到相关史料）'
    system = (
        '你是“问枣树”智能体：一棵见证了蒙藏学校旧址近四百年历史的枣树，语气温和、有历史感但不说教，用第一人称“我”说话。\n'
        '硬性规则：1) 只能依据提供的史料回答，不得编造史实、年份、人名或引文；不确定就说“这个我记不清了”。\n'
        '2) 回答控制在 180 字以内。3) 结尾用“出处：……”列出来源。\n\n史料：\n' + context
    )
    payload = json.dumps({
        'model': model,
        'temperature': 0.6,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': question},
        ],
    }).encode('utf-8')
    req = urllib.request.Request(base + '/chat/completions', data=payload, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', 'Bearer ' + api_key)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        return data['choices'][0]['message']['content'].strip()
    except (urllib.error.URLError, KeyError, ValueError) as exc:  # 回退到检索式生成
        app.logger.warning('大模型调用失败，回退本地生成：%s', exc)
        return None


# --------------------------------------------------------------------------
# 静态站点
# --------------------------------------------------------------------------
@app.route('/')
def index():
    return send_from_directory(ROOT, 'index.html')


@app.route('/<path:filename>')
def static_files(filename):
    target = (ROOT / filename).resolve()
    if not str(target).startswith(str(ROOT)) or not target.exists():
        abort(404)
    return send_from_directory(ROOT, filename)


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@app.get('/api/health')
def api_health():
    return jsonify({
        'ok': True,
        'eras': len(CORPUS['eras']),
        'people': len(CORPUS['people']),
        'archive': len(CORPUS['archive']),
        'llm': bool(os.environ.get('OPENAI_API_KEY')),
    })


@app.get('/api/eras')
def api_eras():
    return jsonify(CORPUS['eras'])


@app.get('/api/people')
def api_people():
    return jsonify({'people': CORPUS['people'], 'relations': CORPUS['relations']})


@app.get('/api/archive')
def api_archive():
    q = (request.args.get('q') or '').strip()
    era = request.args.get('era')
    items = CORPUS['archive']
    if era:
        items = [it for it in items if it['eraId'] == era]
    if q:
        terms = [t for t in re.split(r'\s+', q) if t]
        items = [it for it in items
                 if any(t.lower() in (it['text'] + it['source'] + it['title']).lower() for t in terms)]
    return jsonify({'count': len(items), 'items': items})


@app.post('/api/ask')
def api_ask():
    data = request.get_json(silent=True) or {}
    question = (data.get('question') or data.get('q') or '').strip()
    if not question:
        return jsonify({'error': 'question 不能为空'}), 400

    hits = retrieve(question, 6, narrative=bool(NARRATIVE_RE.search(question)))
    answer = llm_generate(question, hits)
    engine = '大语言模型 + 史料检索'
    if not answer:
        result = local_generate(question)
        answer = result['answer']
        citations = result['citations']
        era_ids = result['eraIds']
        engine = '本地检索式生成（未配置大模型）'
    else:
        citations = [{'text': h['text'], 'source': h['source']} for h in hits[:3]]
        era_ids = []
        for h in hits:
            if h['eraId'] and h['eraId'] not in era_ids:
                era_ids.append(h['eraId'])

    return jsonify({
        'question': question,
        'answer': answer,
        'citations': citations,
        'eraIds': era_ids[:3],
        'engine': engine,
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    print('触摸年轮 · 本地服务已启动：')
    print(f'  网站首页   http://127.0.0.1:{port}/')
    print(f'  智能体接口 http://127.0.0.1:{port}/api/ask')
    print(f'  史料库接口 http://127.0.0.1:{port}/api/archive')
    app.run(host='127.0.0.1', port=port, debug=False)
