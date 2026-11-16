// 极简 CDP 客户端：启动/复用固定 profile 的 Chrome，提供 eval/点击/输入/截图。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function dataRoot() {
  return process.env.PUBLISH_SKILL_DATA || 'D:\\AIInfra\\agent-publish';
}
export function profileDir(name) {
  return path.join(dataRoot(), name, 'chrome-profile');
}
export function artifactsDir(name) {
  const d = path.join(dataRoot(), name, 'artifacts');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome，可设 CHROME_PATH');
}

export async function httpJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function ping(port) {
  try {
    const v = await httpJson(`http://127.0.0.1:${port}/json/version`);
    return v;
  } catch {
    return null;
  }
}

export async function launch({ port, profile, startUrl = 'about:blank', proxy }) {
  if (await ping(port)) return { port, reused: true };
  fs.mkdirSync(profile, { recursive: true });
  const exe = findChrome();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--window-size=1440,1000',
    startUrl,
  ];
  if (proxy) args.splice(args.length - 1, 0, `--proxy-server=` + proxy);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 80; i++) {
    if (await ping(port)) return { port, reused: false };
    await sleep(250);
  }
  throw new Error('浏览器启动超时');
}

export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP 连接超时')), 10000);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
      ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('CDP 连接失败')); });
    });
    const c = new CDP(ws);
    ws.addEventListener('message', (ev) => c._onMessage(ev.data));
    return c;
  }
  on(method, fn) {
    const arr = this.handlers.get(method) || [];
    arr.push(fn);
    this.handlers.set(method, arr);
  }
  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message} (${msg.error.code})`)) : resolve(msg.result);
      return;
    }
    for (const fn of this.handlers.get(msg.method) || []) fn(msg.params);
  }
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP 超时 ${timeoutMs}ms: ${method}`)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      try { this.ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(t); reject(e); }
    });
  }
}

export class Page {
  constructor(cdp, targetId) { this.cdp = cdp; this.targetId = targetId; }
  static async attach(port) {
    const list = (await httpJson(`http://127.0.0.1:${port}/json/list`)).filter((t) => t.type === 'page');
    const t = list[0];
    if (!t) throw new Error('没有页面标签');
    const cdp = await CDP.connect(t.webSocketDebuggerUrl);
    const p = new Page(cdp, t.id);
    await cdp.send('Page.enable').catch(() => {});
    await cdp.send('Runtime.enable').catch(() => {});
    await cdp.send('DOM.enable').catch(() => {});
    return p;
  }
  async eval(expr) {
    const r = await this.cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`页面脚本异常: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result?.value;
  }
  async goto(url) { await this.cdp.send('Page.navigate', { url }); await sleep(1500); }
  async screenshot(file) {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
  async click(x, y) {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(120);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  async typeText(text) {
    await this.cdp.send('Input.insertText', { text });
  }
  async upload(selector, files) {
    const doc = await this.cdp.send('DOM.getDocument', { depth: -1 });
    const q = await this.cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    if (!q.nodeId) throw new Error(`找不到上传控件 ${selector}`);
    await this.cdp.send('DOM.setFileInputFiles', { files, nodeId: q.nodeId });
  }
}
