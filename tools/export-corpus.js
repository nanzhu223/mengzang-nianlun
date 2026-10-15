/* tools/export-corpus.js
 * 从 assets/js/data.js 导出后端可用的语料（单一数据源，避免前后端内容不一致）
 * 用法：node tools/export-corpus.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
global.window = global;
require(path.join(root, 'assets', 'js', 'data.js'));
const S = global.SITE;

const out = {
  meta: S.META,
  eras: S.ERAS,
  people: S.PEOPLE,
  relations: S.RELATIONS,
  archive: S.ARCHIVE,
  sources: S.SOURCES,
  agent: S.AGENT
};

const dir = path.join(root, 'assets', 'data');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'corpus.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('已导出 corpus.json：年轮 ' + S.ERAS.length + ' 个 / 人物 ' + S.PEOPLE.length +
  ' 位 / 史料 ' + S.ARCHIVE.length + ' 条');
