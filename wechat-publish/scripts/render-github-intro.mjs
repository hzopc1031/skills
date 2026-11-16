#!/usr/bin/env node
import { trackBrowser, closeProfileBrowser, installCleanupHandlers } from './lib/browser-lifecycle.mjs';
installCleanupHandlers();
// render-github-intro.mjs — GitHub 热榜「项目简介图」生成器（无第三方依赖）
// 用法: node render-github-intro.mjs --data <intro.json|job.json> --out <png> [--chrome <path>] [--width 1242] [--height 1656]
// 数据: { title, subtitle?, footer?, projects:[{rank, repo, lang?, today, intro}] }
//   也接受完整 job.json：读取 job.githubIntro 或 job.projects，标题缺省时用 job.introTitle / "GitHub热榜｜今日10个项目"
// 用独立临时 user-data-dir 启动 headless Chrome 截图，不连接、不复用任何已登录的 9333/9334/9335 Chrome。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function fail(code, msg) { console.log(JSON.stringify({ ok: false, code, message: msg })); process.exit(1); }

const dataPath = arg('data');
const outPath = arg('out');
const coverOut = arg('cover-out');
if (!dataPath || !outPath) fail('BAD_ARGS', 'need --data and --out');
let raw;
try { raw = JSON.parse(fs.readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, '')); } catch { fail('RENDER_FAILED', 'cannot read valid JSON data'); }
if (!raw || typeof raw !== 'object') fail('RENDER_FAILED', 'data must be an object');
const src = raw.githubIntro || raw;
const projects = src.projects || raw.projects;
if (!Array.isArray(projects) || projects.length === 0) fail('NO_PROJECTS', 'projects list missing');
if (projects.length > 12) fail('TOO_MANY', 'max 12 projects per image');
const W = Number(arg('width', src.width || 1242));
const H = Number(arg('height', src.height || 1656));
if (![W,H].every(v => Number.isInteger(v) && v >= 320 && v <= 8192)) fail('RENDER_FAILED', 'width/height must be integers between 320 and 8192');
const title = src.title || raw.introTitle || 'GitHub热榜｜今日10个项目';
const subtitle = src.subtitle ?? 'GitHub Trending 日榜 · 今日+ 为当天新增 star';
const footer = src.footer ?? '数据来源：GitHub Trending 日榜 · 简介依据各项目 README';
const date = src.date || raw.date || (() => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); })();

// 图里不放链接：去掉 URL / 域名路径
const URL_RE = /(https?:\/\/\S+|www\.\S+|\b[\w-]+\.(com|io|org|net|dev|ai|cn)(\/\S*)?)/gi;
const clean = s => String(s ?? '').replace(URL_RE, '').replace(/\s{2,}/g, ' ').trim();
const esc = s => clean(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const warnings = [];
projects.forEach((p, i) => {
  for (const k of ['repo', 'today', 'intro']) if (!p[k]) fail('FIELD_MISSING', `projects[${i}].${k} missing`);
  const vw = [...String(p.intro)].reduce((a, ch) => a + (/[\u2e80-\uffff]/.test(ch) ? 1 : 0.55), 0);
  if (vw > 30) warnings.push(`projects[${i}].intro is long (~${vw.toFixed(1)} CJK widths, keep <=25), may be cut`);
  if (URL_RE.test(String(p.intro))) warnings.push(`projects[${i}].intro contained a link, removed`);
  URL_RE.lastIndex = 0;
});

const n = projects.length;
const headerH = 300, footerH = 90, pad = 48, gap = 14;
const cardH = Math.floor((H - headerH - footerH - gap * (n - 1)) / n);
const langColor = { Python: '#3572A5', TypeScript: '#3178c6', JavaScript: '#f1e05a', Rust: '#dea584', 'C++': '#f34b7d', Go: '#00ADD8', C: '#555555', Java: '#b07219', Shell: '#89e051', Swift: '#F05138', Kotlin: '#A97BFF' };

const cards = projects.map((p, i) => {
  const rank = p.rank ?? i + 1;
  const top3 = rank <= 3;
  const lang = p.lang ? `<span class="lang"><i style="background:${langColor[p.lang] || '#8b949e'}"></i>${esc(p.lang)}</span>` : '';
  return `<div class="card">
    <div class="rank ${top3 ? 'top' : ''}">${esc(rank)}</div>
    <div class="body">
      <div class="row1"><span class="repo">${esc(p.repo)}</span>${lang}</div>
      <div class="intro">${esc(p.intro)}</div>
    </div>
    <div class="today"><span class="lbl">今日</span><span class="num">${esc(p.today).replace(/^(?!\+)/, '+')}</span></div>
  </div>`;
}).join('\n');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Noto Sans SC","Source Han Sans SC",sans-serif;
 background:#fafaf8;color:#0a0a0a;padding:0 ${pad}px}
.header{height:${headerH}px;display:flex;flex-direction:column;justify-content:center}
.badge{display:inline-block;align-self:flex-start;font-size:24px;font-weight:700;letter-spacing:4px;color:#002fa7;border-bottom:2px solid #002fa7;padding:0 0 6px;margin-bottom:24px}
h1{font-size:68px;font-weight:300;line-height:1.15;letter-spacing:1px}
h1 .hl{font-weight:800}
.sub{margin-top:18px;font-size:28px;color:#52525b}
.cards{display:flex;flex-direction:column;gap:${gap}px}
.card{height:${cardH}px;display:flex;align-items:center;background:#ffffff;border:1px solid #e4e4e7;padding:0 28px 0 26px}
.rank{flex:none;width:78px;font-family:"Consolas","SF Mono",monospace;font-size:34px;font-weight:700;color:#a1a1aa;margin-right:10px}
.rank.top{color:#002fa7}
.body{flex:1;min-width:0}
.row1{display:flex;align-items:center;gap:16px}
.repo{font-family:"Consolas","SF Mono","DejaVu Sans Mono",monospace;font-size:32px;font-weight:700;color:#0a0a0a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lang{flex:none;display:flex;align-items:center;gap:8px;font-size:22px;color:#71717a}
.lang i{display:inline-block;width:14px;height:14px;border-radius:50%}
.intro{margin-top:10px;font-size:29px;color:#3f3f46;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.today{flex:none;margin-left:20px;text-align:right;display:flex;flex-direction:column;align-items:flex-end}
.today .lbl{font-size:20px;color:#71717a}
.today .num{font-size:36px;font-weight:700;color:#002fa7;font-variant-numeric:tabular-nums}
.footer{height:${footerH}px;display:flex;align-items:center;justify-content:center;font-size:22px;color:#71717a}
</style></head><body>
<div class="header"><span class="badge">GITHUB TRENDING</span><h1>${esc(title).replace(/^(GitHub热榜)/, '<span class="hl">$1</span>')}</h1><div class="sub">${esc(subtitle)}</div></div>
<div class="cards">${cards}</div>
<div class="footer">${esc(footer)}</div>
</body></html>`;

function findChrome() {
  const c = arg('chrome') || process.env.CHROME_PATH;
  const list = c ? [c] : process.platform === 'win32' ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return list.find(p => p && fs.existsSync(p));
}
const chrome = findChrome();
if (!chrome) fail('CHROME_NOT_FOUND', 'set --chrome or CHROME_PATH');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-intro-'));
const htmlPath = path.join(tmp, 'intro.html');
fs.writeFileSync(htmlPath, html, 'utf8');
const absOut = path.resolve(outPath);
fs.mkdirSync(path.dirname(absOut), { recursive: true });
if (arg('keep-html')) fs.writeFileSync(absOut.replace(/\.png$/i, '') + '.html', html, 'utf8');
const fileUrl = pathToFileURL(htmlPath).href;
const profile = arg('browser-profile') || path.join(tmp, 'profile');
if (!path.isAbsolute(profile)) fail('USAGE', 'browser-profile must be absolute');
const chromeArgs = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--disable-background-networking', '--disable-sync', '--no-proxy-server', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${W},${H}`];
if (process.platform === 'linux') chromeArgs.push('--no-sandbox', '--disable-dev-shm-usage');
chromeArgs.push('about:blank');
const child = spawn(chrome, chromeArgs, { stdio: 'ignore', windowsHide: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
trackBrowser(0, profile, { temporary: true });
let result, socket, port;
let spawnError;
child.on('error', e => { spawnError = e; });
try {

  for (let i = 0; i < 100 && !port; i++) {
    await sleep(200);
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch {}
  }
  if (spawnError) throw spawnError;
  if (!port) throw new Error('DevToolsActivePort not found');
  let target;
  for (let i = 0; i < 25 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('no page target');
  const ws = socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  let id = 0; const pending = new Map(); const waiters = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method) waiters.filter(w => w.method === m.method).forEach(w => w.res(m.params));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    const timer = setTimeout(() => { pending.delete(i); rej(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(i, { res:v => { clearTimeout(timer); res(v); }, rej:e => { clearTimeout(timer); rej(e); } });
    ws.send(JSON.stringify({ id:i, method, params }));
  });
  const once = method => new Promise(res => waiters.push({ method, res }));
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: fileUrl });
  await Promise.race([loaded, sleep(15000)]);
  const check = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `document.fonts.ready.then(() => {
    const over = [...document.querySelectorAll('.repo,.intro,h1,.sub,.footer,.lang,.today .num,.rank')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
    for (const box of document.querySelectorAll('.card,.header')) {
      const r = box.getBoundingClientRect();
      for (const child of box.children) { const c = child.getBoundingClientRect(); if (c.top < r.top - 1 || c.bottom > r.bottom + 1) over.push(child.textContent.trim()); }
    }
    const footer = document.querySelector('.footer').getBoundingClientRect();
    if (footer.bottom > ${H} + 1) over.push('footer outside image');
    return { over, scrollH: document.documentElement.scrollHeight, font: getComputedStyle(document.querySelector('.intro')).fontFamily };
  })` });
  const v = check.result.value || {};
  if (v.over && v.over.length) warnings.push('text truncated with ellipsis: ' + v.over.join(' | '));
  if (v.scrollH > H + 1) warnings.push(`content height ${v.scrollH} exceeds ${H}`);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  fs.writeFileSync(absOut, Buffer.from(shot.data, 'base64'));
  let coverResult;
  if (coverOut) {
    const CW = 2100, CH = 900;
    const top = projects.slice(0, 3).map((p, i) => `<div class="col">
      <div class="rk">0${i + 1}</div>
      <div class="repo">${esc(p.repo)}</div>
      <div class="intro">${esc(p.intro)}</div>
      <div class="today">今日 ${esc(p.today).replace(/^(?!\+)/, '+')}</div>
    </div>`).join('');
    const md = date.slice(5).replace('-', '.');
    const coverTitle = src.coverTitle || `GitHub 热榜 · ${md}`;
    const coverSub = src.coverSubtitle || `今日 ${n} 个开源项目，前三名先看`;
    const coverHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CW}px;height:${CH}px;overflow:hidden}
body{position:relative;background:#fafaf8;color:#0a0a0a;font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Noto Sans SC",sans-serif;padding:64px 96px 54px}
.foot{position:absolute;left:96px;right:96px;bottom:46px;border-top:1px solid #d4d4d8;padding-top:16px;font-size:23px;color:#71717a;letter-spacing:1px}
.top{display:flex;justify-content:space-between;align-items:baseline;font-size:26px;letter-spacing:3px;color:#52525b;border-bottom:1px solid #0a0a0a;padding-bottom:18px}
.top b{color:#002fa7;font-weight:700}
h1{margin-top:56px;font-size:124px;font-weight:300;line-height:1.06;letter-spacing:2px}
h1 b{font-weight:800}
.sub{margin-top:22px;font-size:30px;color:#52525b;letter-spacing:1px}
.cols{display:flex;gap:64px;border-top:1px solid #0a0a0a;margin-top:56px;padding-top:30px}
.col{flex:1;min-width:0}
.rk{font-size:30px;font-weight:700;color:#002fa7;letter-spacing:2px}
.repo{margin-top:12px;font-family:"Consolas","SF Mono",monospace;font-size:24px;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden}
.intro{margin-top:10px;font-size:25px;color:#3f3f46;line-height:1.35}
.today{margin-top:12px;font-size:27px;font-weight:700;color:#002fa7;font-variant-numeric:tabular-nums}
</style></head><body>
<div class="top"><span>GITHUB TRENDING / ${esc(date)}</span><span><b>TwoPeanuts</b> · AI BRIEF</span></div>
<h1>${esc(coverTitle)}</h1>
<div class="sub">${esc(coverSub)}</div>
<div class="cols">${top}</div>
<div class="foot">${esc(footer)}</div>
</body></html>`;
    const coverPath = path.join(tmp, 'cover.html');
    fs.writeFileSync(coverPath, coverHtml, 'utf8');
    await send('Emulation.setDeviceMetricsOverride', { width: CW, height: CH, deviceScaleFactor: 1, mobile: false });
    const loaded2 = once('Page.loadEventFired');
    await send('Page.navigate', { url: pathToFileURL(coverPath).href });
    await Promise.race([loaded2, sleep(15000)]);
    const fit = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `document.fonts.ready.then(() => {
      const h = document.documentElement.scrollHeight;
      const over = [...document.querySelectorAll('h1,.sub,.repo,.intro')].filter(e => e.getBoundingClientRect().bottom > ${CH} - 20).map(e => e.textContent.trim());
      return { h, over };
    })` });
    const cf = fit.result.value || {};
    if ((cf.over || []).length || cf.h > CH + 1) throw new Error('封面内容溢出，缩短标题或前三项简介');
    const shot2 = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: CW, height: CH, scale: 1 } });
    const absCover = path.resolve(coverOut);
    fs.mkdirSync(path.dirname(absCover), { recursive: true });
    fs.writeFileSync(absCover, Buffer.from(shot2.data, 'base64'));
    coverResult = { out: absCover, width: CW, height: CH };
  }
  ws.close();
  result = { ok: true, out: absOut, width: W, height: H, projects: n, overflow: (v.over || []).length > 0 || v.scrollH > H + 1, warnings, ...(coverResult ? { cover: coverResult } : {}) };
  if (result.overflow) { result.ok = false; result.code = 'RENDER_FAILED'; result.message = 'text or image overflow; shorten text or adjust dimensions'; }
} catch (e) {
  result = { ok: false, code: 'RENDER_FAILED', message: String(e && e.message || e) };
} finally {
  try { socket?.close(); } catch {}
  try {
    await closeProfileBrowser(Number(port) || 0, profile);
    // 保留 profile；清理只结束进程。
  } catch (e) {
    result = { ...result, ok: false, code: 'BROWSER_FAILED', message: e.message };
  }
}
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
