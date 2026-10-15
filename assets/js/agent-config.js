/* =====================================================================
 * agent-config.js  “问枣树”智能体接入配置（可留空）
 * ---------------------------------------------------------------------
 * 默认（本文件保持为空对象）：使用纯前端本地 RAG，离线可运行，
 *   回答严格取自 assets/js/data.js 中的史料库，并附出处引用。
 *
 * 方式一：接入 Python 后端（真实 RAG：检索 + 生成）
 *   1) python server.py            →  http://127.0.0.1:8000
 *   2) 取消下面 mode / backend 的注释后刷新页面
 *
 * 方式二：浏览器直连 OpenAI 兼容大模型
 *   取消下面 llm 部分的注释并填入你的接口信息。
 *   注意：密钥会暴露在前端，仅建议本地演示使用。
 *
 * 方式三：临时切换（不改代码）——在浏览器控制台执行：
 *   localStorage.setItem('nianlun_agent_llm', JSON.stringify({
 *     endpoint:'https://api.example.com/v1/chat/completions', apiKey:'sk-...', model:'gpt-4o-mini'
 *   }));
 * ===================================================================== */
window.NIANLUN_AGENT_CONFIG = {
  mode: 'auto',   // 'auto' | 'local' | 'backend' | 'llm'
  backend: ''     // 如 'http://127.0.0.1:8000/api/ask'
  // llm: { endpoint: 'https://api.example.com/v1/chat/completions', apiKey: '', model: 'gpt-4o-mini' }
};
