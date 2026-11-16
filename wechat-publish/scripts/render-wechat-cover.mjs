#!/usr/bin/env node
// 通用公众号封面：任何没有现成 21:9 首图的文章，都先本地出一张 2100×900 封面。
// 用法: node render-wechat-cover.mjs --data <cover.json|job.json> --out <png> [--browser-profile <abs>]
// 数据: { title, subtitle?, date?, brand?, kicker?, items?:[{label,value}] }
// 独立临时 profile + headless Chrome，不连接 9333/9334/9335。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { trackBrowser, closeProfileBrowser } from './lib/browser-lifecycle.mjs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const emit = (o, code) => { console.log(JSON.stringify(o)); process.exit(code); };

const dataPath = arg('data'), outPath = arg('out');
if (!dataPath || !outPath) emit({ ok: false, code: 'BAD_ARGS', message: 'need --data and --out' }, 1);
let data;
try { data = JSON.parse(fs.readFileSync(dataPath, 'utf8').replace(/^\uFEFF/, '')); } catch { emit({ ok: false, code: 'RENDER_FAILED', message: 'cannot read JSON' }, 1); }

const URL_RE = /(https?:\/\/\S+|www\.\S+|\b[\w-]+\.(com|io|org|net|dev|ai|cn)(\/\S*)?)/gi;
const clean = (s) => String(s ?? '').replace(URL_RE, '').replace(/\s{2,}/g, ' ').trim();
const esc = (s) => clean(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const title = clean(data.title || data.coverTitle || '');
if (!title) emit({ ok: false, code: 'RENDER_FAILED', message: '封面缺少标题' }, 1);
const subtitle = clean(data.subtitle || data.caption || '');
const brand = clean(data.brand || 'TwoPeanuts');
const kicker = clean(data.kicker || 'AI BRIEF');
const d = new Date();
const date = String(data.date || [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'));
const items = Array.isArray(data.items) ? data.items.slice(0, 3) : [];
const W = 2100, H = 900;
const titleSize = [...title].length <= 14 ? 124 : [...title].length <= 22 ? 96 : 76;

const cols = items.length ? `<div class="cols">${items.map((it) => `<div class="col"><div class="rk">${esc(it.label || '')}</div><div class="val">${esc(it.value || '')}</div></div>`).join('')}</div>` : '';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{position:relative;display:flex;flex-direction:column;background:#fafaf8;color:#0a0a0a;font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Noto Sans SC",sans-serif;padding:64px 96px 132px}
.main{flex:1;display:flex;flex-direction:column}
.main.center{justify-content:center}
.top{display:flex;justify-content:space-between;align-items:baseline;font-size:26px;letter-spacing:3px;color:#52525b;border-bottom:1px solid #0a0a0a;padding-bottom:18px}
.top b{color:#002fa7;font-weight:700}
h1{margin-top:56px;font-size:${titleSize}px;font-weight:300;line-height:1.14;letter-spacing:1px;max-width:1908px}
.sub{margin-top:24px;font-size:30px;color:#52525b;line-height:1.4;max-width:1750px}
.cols{display:flex;gap:64px;border-top:1px solid #0a0a0a;margin-top:44px;padding-top:26px}
.col{flex:1;min-width:0}
.rk{font-size:26px;font-weight:700;color:#002fa7;letter-spacing:2px}
.val{margin-top:10px;font-size:32px;line-height:1.35}
.foot{position:absolute;left:96px;right:96px;bottom:46px;border-top:1px solid #d4d4d8;padding-top:16px;font-size:23px;color:#71717a;letter-spacing:1px}
</style></head><body>
<div class="top"><span>${esc(kicker)} / ${esc(date)}</span><span><b>${esc(brand)}</b></span></div>
<div class="main${items.length ? '' : ' center'}">
<h1>${esc(title)}</h1>
${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
${cols}
</div>
<div class="foot">${esc(brand)} · ${esc(date)} · 本文为资料整理</div>
</body></html>`;

function findChrome() {
  const c = arg('chrome') || process.env.CHROME_PATH;
  const list = c ? [c] : process.platform === 'win32' ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return list.find((p) => p && fs.existsSync(p));
}
const chrome = findChrome();
if (!chrome) emit({ ok: false, code: 'CHROME_NOT_FOUND', message: '找不到 Chrome' }, 1);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-cover-'));
const htmlPath = path.join(tmp, 'cover.html');
fs.writeFileSync(htmlPath, html, 'utf8');
const absOut = path.resolve(outPath);
fs.mkdirSync(path.dirname(absOut), { recursive: true });
const profile = arg('browser-profile') || path.join(tmp, 'profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-background-networking', '--no-proxy-server', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
trackBrowser(0, profile, { temporary: true });
let socket, port, result;
try {
  for (let i = 0; i < 100 && !port; i++) { await sleep(200); try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch {} }
  if (!port) throw new Error('DevToolsActivePort not found');
  let target;
  for (let i = 0; i < 25 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} if (!target) await sleep(200); }
  if (!target) throw new Error('no page target');
  const ws = socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  let id = 0; const pending = new Map(); const waiters = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } else if (m.method) waiters.filter((w) => w.method === m.method).forEach((w) => w.res(m.params)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; const t = setTimeout(() => { pending.delete(i); rej(new Error('CDP timeout: ' + method)); }, 15000); pending.set(i, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } }); ws.send(JSON.stringify({ id: i, method, params })); });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
  await Promise.race([loaded, sleep(15000)]);
  const fit = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `document.fonts.ready.then(() => {
    const over = [...document.querySelectorAll('h1,.sub,.val')].filter(e => { const r=e.getBoundingClientRect(); return r.bottom > ${H - 60} || e.scrollWidth > e.clientWidth + 1; }).map(e => e.textContent.trim().slice(0, 40));
    return { over, h: document.documentElement.scrollHeight };
  })` });
  const v = fit.result.value || {};
  if ((v.over || []).length || v.h > H + 1) throw new Error('封面文字溢出，请缩短标题或摘要');
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  fs.writeFileSync(absOut, Buffer.from(shot.data, 'base64'));
  ws.close();
  result = { ok: true, out: absOut, width: W, height: H, titleSize };
} catch (e) {
  result = { ok: false, code: 'RENDER_FAILED', message: String(e && e.message || e) };
} finally {
  try { socket?.close(); } catch {}
  try { await closeProfileBrowser(Number(port) || 0, profile); } catch (e) { result = { ...result, ok: false, code: 'BROWSER_FAILED', message: e.message }; }
}
emit(result, result.ok ? 0 : 1);
