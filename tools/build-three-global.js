/* 把官方 ESM 版 three.module.js 转换为「全局版」经典脚本（window.THREE）。
 * 目的：让本地 file:// 双击打开时也能加载 three（ESM 在 file:// 下会被 CORS 拦截）。
 * 用法：node tools/build-three-global.js
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'assets', 'vendor', 'three');
const srcPath = path.join(dir, 'three.module.js');
const outPath = path.join(dir, 'three.global.js');

const src = fs.readFileSync(srcPath, 'utf8');

const idx = src.lastIndexOf('export {');
if (idx < 0) throw new Error('未找到 export 语句');
const head = src.slice(0, idx);
const block = src.slice(idx);

const open = block.indexOf('{');
const close = block.lastIndexOf('}');
if (open < 0 || close < 0) throw new Error('export 语句结构异常');

const names = block.slice(open + 1, close).split(',').map(s => s.trim()).filter(Boolean);
if (!names.length) throw new Error('导出列表为空');

const entries = names.map(n => {
  const m = n.match(/^(\S+)\s+as\s+(\S+)$/);
  return m ? `  ${m[2]}: ${m[1]}` : `  ${n}`;
});

const out = `(function(){\n'use strict';\n`
  + head
  + `\nwindow.THREE = {\n${entries.join(',\n')}\n};\n})();\n`;

fs.writeFileSync(outPath, out, 'utf8');
console.log('导出符号数:', names.length);
console.log('输出文件:', outPath);
console.log('大小(KB):', Math.round(fs.statSync(outPath).size / 1024));
