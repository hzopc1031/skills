#!/usr/bin/env node
// 石墨正文 + 克莱因蓝 accent：只改章节序号与关键词下划线，其余 HTML 原样保留。
// 用法: node theme-accent.mjs --in <article.html> --out <accented.html>
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const input = arg('in'), output = arg('out');
if (!input || !output) { console.error('need --in and --out'); process.exit(1); }

const ACCENT = '#002FA7';
const src = fs.readFileSync(path.resolve(input), 'utf8').replace(/^\uFEFF/, '');
if (!/^\s*<section\b[\s\S]*<\/section>\s*$/i.test(src)) {
  console.error('输入必须是单个 <section> 正文片段（先跑 gzh-design 校验）');
  process.exit(1);
}

const rules = [
  // 章节序号：浅灰数字 -> 克莱因蓝
  [/color:\s*#E4E4E7/gi, `color:${ACCENT}`],
  // 关键词下划线：石墨 -> 克莱因蓝
  [/border-bottom:\s*2px\s+solid\s+#52525B/gi, `border-bottom:2px solid ${ACCENT}`],
  // 引言卡片左侧竖线若为石墨色，也统一成 accent
  [/border-left:\s*3px\s+solid\s+#27272A/gi, `border-left:3px solid ${ACCENT}`],
];

let out = src;
const counts = [];
for (const [re, to] of rules) {
  const hits = out.match(re) || [];
  counts.push(hits.length);
  out = out.replace(re, to);
}

const absOut = path.resolve(output);
if (path.resolve(input) === absOut) {
  console.error('拒绝覆盖输入文件，请输出到新文件');
  process.exit(1);
}
if (fs.existsSync(absOut)) {
  console.error('拒绝覆盖已有文件：' + absOut);
  process.exit(1);
}
fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, out, 'utf8');
console.log(JSON.stringify({ ok: true, in: path.resolve(input), out: absOut, accent: ACCENT, replaced: { chapterNumber: counts[0], underline: counts[1], quoteRule: counts[2] } }));
