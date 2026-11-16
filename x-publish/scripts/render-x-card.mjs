// 生成适合 X 的横版信息卡（1600×900），纸白＋克莱因蓝，与小红书/公众号同一套视觉。
// 用法：node render-x-card.mjs --spec spec.json --out out.png
import fs from 'node:fs';
import path from 'node:path';
import { withLocalRenderer } from 'file:///C:/Users/Mayn/.dsh/skills/xhs-publish/scripts/lib/local-renderer.mjs';

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const specPath = arg('--spec');
const outPath = arg('--out');
if (!specPath || !outPath) {
  console.error('用法: node render-x-card.mjs --spec spec.json --out out.png');
  process.exit(2);
}
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bullets = (spec.bullets || []).slice(0, 5);
const W = 1600, H = 900;
const rowH = bullets.length >= 5 ? 84 : bullets.length === 4 ? 96 : 112;
const titleSize = String(spec.title || '').length > 18 ? 62 : 74;

const rows = bullets.map((b, i) => `
  <div class="row">
    <span class="no">${String(i + 1).padStart(2, '0')}</span>
    <span class="name">${esc(b.name)}</span>
    <span class="num">${esc(b.num || '')}</span>
    <span class="desc">${esc(b.desc || '')}</span>
  </div>`).join('');

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;background:#FAFAF8;color:#0A0A0A;font-family:"Noto Sans SC","Microsoft YaHei","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased}
.page{width:${W}px;height:${H}px;padding:56px 72px 44px;display:flex;flex-direction:column}
.hd{display:flex;justify-content:space-between;align-items:baseline;font-size:22px;letter-spacing:3px;color:#52525B;border-bottom:2px solid #0A0A0A;padding-bottom:14px;flex:none}
.hd .k{color:#002FA7;font-weight:700}
.mid{flex:1;display:flex;flex-direction:column;min-height:0;padding-top:34px}
h1{font-size:${titleSize}px;font-weight:300;line-height:1.15;letter-spacing:1px;margin-bottom:10px}
.lead{font-size:24px;color:#3F3F46;margin-bottom:22px}
.list{border-top:2px solid #0A0A0A;flex:1;display:flex;flex-direction:column;justify-content:space-evenly}
.row{display:flex;align-items:baseline;gap:18px;height:${rowH}px}
.no{flex:none;width:44px;font-family:Consolas,monospace;font-size:24px;font-weight:700;color:#002FA7}
.name{flex:none;font-size:30px;font-weight:700;max-width:520px}
.num{flex:none;width:110px;font-family:Consolas,monospace;font-size:26px;color:#002FA7;text-align:right}
.desc{flex:1;font-size:24px;color:#3F3F46;line-height:1.35}
.ft{flex:none;display:flex;justify-content:space-between;font-size:20px;color:#71717A;border-top:1px solid #E4E4E7;padding-top:14px;margin-top:16px}
</style>
<div class="page">
  <div class="hd"><span class="k">${esc(spec.kicker || 'GITHUB / 24H')}</span><span>${esc(spec.date || '')}</span></div>
  <div class="mid">
    <h1>${esc(spec.title)}</h1>
    ${spec.lead ? `<div class="lead">${esc(spec.lead)}</div>` : ''}
    <div class="list">${rows}</div>
  </div>
  <div class="ft"><span>${esc(spec.source || '来源：公开资料整理')}</span><span>TwoPeanuts</span></div>
</div></html>`;

const overflow = (s) => typeof s === 'string' && s.trim().length >= 2 && /^[.\u2026]+$/.test(s.trim());
await withLocalRenderer(html, async ({ cdp }) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
}, { width: W, height: H }).catch((e) => { console.error(String(e.message || e)); process.exit(1); });

if (!fs.existsSync(outPath)) { console.error('渲染失败'); process.exit(1); }
console.log(JSON.stringify({ ok: true, out: outPath, width: W, height: H }));
