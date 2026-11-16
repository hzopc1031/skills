// 零依赖 CDP 驱动：启动本机 Chrome/Edge，用 DevTools 协议控制页面。
// 不依赖 playwright/puppeteer，任何 Agent 只要能跑 node 就能用。
import { trackBrowser } from './browser-lifecycle.mjs';
import { spawn } from 'node:child_process';
import { queryProfile } from './port-profile.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { sleep, SkillError, log } from './util.mjs';

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findBrowser() {
  for (const c of BROWSERS) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

export async function httpJson(url, method = 'GET') {
  const res = await fetch(url, { method, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function ping(port) {
  try {
    return await httpJson(`http://127.0.0.1:${port}/json/version`);
  } catch {
    return null;
  }
}

/** 只输出监听 PID、进程名和 profile；不输出完整命令行或任何登录数据。失败即拒绝。 */
export async function verifyBrowserProfile(port, profile, options = {}) {
  try { return await queryProfile(port, profile, options); }
  catch (e) { throw new SkillError('BROWSER_FAILED', `无法可靠核验端口 ${port} 的监听 PID/profile；拒绝连接，不结束浏览器，不更换 profile`, /^(netstat.exe|WMIC.exe|powershell.exe): helper (timeout|failed|unavailable|output limit)$/.test(e.message) ? e.message : 'profile query/parse failed: ' + (e && e.message ? e.message : '')); }
}

/** 启动一个独立 profile 的 Chrome（复用已开着同端口的实例） */
export async function launch({ port = 9333, profile, headless = false, startUrl = 'about:blank', proxy = 'direct' }) {
  const owner = await verifyBrowserProfile(port, profile, { allowAbsent: true });
  if (owner.listening) {
    trackBrowser(port, profile);
    const existing = await ping(port);
    if (!existing) throw new SkillError('BROWSER_FAILED', 'profile 已核验但 CDP 无响应；拒绝重启浏览器');
    log(`复用已在 ${port} 端口的浏览器`);
    return { port, reused: true, browser: existing.Browser };
  }
  const exe = findBrowser();
  if (!exe) {
    throw new SkillError('BROWSER_FAILED', '找不到 Chrome / Edge', '设置环境变量 CHROME_PATH 指向浏览器可执行文件');
  }
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate,OptimizationHints',
    '--window-size=1440,1000',
    startUrl,
  ];
  // proxy: 'direct'（默认）= 加 --no-proxy-server，脚本启动的 Chrome 直连不走系统代理；'system' = 沿用系统代理
  if (proxy !== 'system') args.unshift('--no-proxy-server');
  if (headless) args.unshift('--headless=new');
  log(`启动浏览器: ${exe}`);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true });
  let launchError = false;
  child.once('error', () => { launchError = true; });
  trackBrowser(port, profile);
  child.unref();
  for (let i = 0; i < 80; i++) {
    if (launchError) throw new SkillError('BROWSER_FAILED', '无法启动浏览器');
    const v = await ping(port);
    if (v) {
      await verifyBrowserProfile(port, profile);
      return { port, reused: false, browser: v.Browser };
    }
    await sleep(250);
  }
  throw new SkillError('BROWSER_FAILED', '浏览器启动超时（20s）');
}

export class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }

  static async connect(wsUrl) {
    const c = new CDP(wsUrl);
    await c.open();
    return c;
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('CDP 连接超时')), 10000);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP 连接失败'));
      });
      ws.addEventListener('message', (ev) => this._onMessage(ev.data));
    });
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const h of this.handlers.get(msg.method) || []) {
        try {
          h(msg.params);
        } catch {}
      }
    }
  }

  send(method, params = {}, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时 ${timeout}ms: ${method}`));
      }, timeout);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  on(method, cb) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(cb);
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

export class Page {
  constructor(cdp) {
    this.cdp = cdp;
  }

  static async open({ port = 9333 }) {
    const targets = await httpJson(`http://127.0.0.1:${port}/json/list`);
    let t = targets.find((x) => x.type === 'page');
    if (!t) t = await httpJson(`http://127.0.0.1:${port}/json/new?about:blank`, 'PUT');
    if (!t) throw new SkillError('BROWSER_FAILED', '没有可用的页面标签');
    const cdp = await CDP.connect(t.webSocketDebuggerUrl);
    const page = new Page(cdp);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    return page;
  }

  async eval(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const r = await this.cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue,
      userGesture: true,
      includeCommandLineAPI: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`页面脚本异常: ${d.exception?.description || d.text}`);
    }
    return returnByValue ? r.result.value : r.result;
  }

  async url() {
    return this.eval('location.href');
  }

  async title() {
    return this.eval('document.title');
  }

  async text() {
    return this.eval('document.body ? document.body.innerText : ""');
  }

  async goto(url, { timeout = 45000 } = {}) {
    await this.cdp.send('Page.navigate', { url });
    await this.waitFor("document.readyState === 'complete'", { timeout, interval: 200 });
    await sleep(700);
    return this.url();
  }

  async waitFor(expression, { timeout = 20000, interval = 300 } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) {
      try {
        last = await this.eval(expression);
        if (last) return last;
      } catch (e) {
        last = e.message;
      }
      await sleep(interval);
    }
    throw new SkillError('PAGE_CHANGED', `等待超时（${timeout}ms）: ${expression}`, `最后结果: ${last}`);
  }

  async exists(selector) {
    return this.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
  }

  /** 返回元素中心坐标（顺带滚动到视野内） */
  async box(selector) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
  }

  async clickAt(x, y) {
    const base = { x, y, button: 'left', clickCount: 1 };
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await sleep(40);
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  }

  async click(selector) {
    const b = await this.box(selector);
    if (!b) throw new SkillError('PAGE_CHANGED', `找不到可点击元素: ${selector}`);
    await this.clickAt(b.x, b.y);
    return b;
  }

  /** 按文字找可点元素（优先面积最小的叶子节点），真实鼠标点击 */
  async findByText(text, { selector = 'button, a, div[role="button"], span, div, label', exact = true } = {}) {
    return this.eval(`(() => {
      const want = ${JSON.stringify(String(text))};
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const hits = [];
      for (const n of nodes) {
        const raw = (n.innerText || n.textContent || '').replace(/\\s+/g, '');
        if (!raw) continue;
        const ok = ${exact ? 'raw === want' : 'raw.includes(want)'};
        if (!ok) continue;
        const r = n.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const st = getComputedStyle(n);
        if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) continue;
        hits.push({
          n,
          area: r.width * r.height,
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          disabled: n.disabled === true || n.getAttribute('aria-disabled') === 'true' || /disabled/i.test(String(n.className || '')),
          tag: n.tagName.toLowerCase(),
          cls: String(n.className || '').slice(0, 120),
          text: (n.innerText || '').trim().slice(0, 60),
        });
      }
      hits.sort((a, b) => a.area - b.area);
      const h = hits[0];
      if (!h) return null;
      h.n.scrollIntoView({ block: 'center' });
      const r = h.n.getBoundingClientRect();
      return { found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: h.disabled, tag: h.tag, cls: h.cls, text: h.text, count: hits.length };
    })()`);
  }

  async clickText(text, opts = {}) {
    const h = await this.findByText(text, opts);
    if (!h) throw new SkillError('PAGE_CHANGED', `页面上找不到文字为「${text}」的可点元素`);
    if (h.disabled) throw new SkillError('PUBLISH_FAILED', `「${text}」按钮是禁用状态（灰的）`, '通常是必填项没选或表单未通过校验');
    await this.clickAt(h.x, h.y);
    return h;
  }

  /**
   * JS 派发点击：坐标点击对某些被遮挡/带 hover 蒙层的按钮无效时用这个。
   * 事件顺序模拟真实点击，React 能收到。
   */
  async clickJsByText(text, { selector = 'button, div, span' } = {}) {
    return this.eval(`(() => {
      const want = ${JSON.stringify(String(text))};
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((n) => {
        const t = (n.innerText || '').replace(/\\s+/g, '');
        if (t !== want) return false;
        const r = n.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      });
      if (!nodes.length) return { found: false };
      // 优先外层（真正挂 handler 的元素）里最小的那个
      nodes.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const da = a.querySelectorAll('*').length, db = b.querySelectorAll('*').length;
        return da - db || ra.width * ra.height - rb.width * rb.height;
      });
      const el = nodes[0];
      el.scrollIntoView({ block: 'center' });
      const opts = { bubbles: true, cancelable: true, view: window };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        const E = type.startsWith('pointer') ? PointerEvent : MouseEvent;
        try { el.dispatchEvent(new E(type, opts)); } catch { el.dispatchEvent(new MouseEvent(type, opts)); }
      }
      return { found: true, tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80) };
    })()`);
  }

  async bringToFront() {
    try {
      await this.cdp.send('Page.bringToFront', {}, 5000);
    } catch {}
  }

  /**
   * 无障碍树查找。闭合 shadow DOM 里的元素（如小红书的"发布"按钮）在普通 DOM
   * 查询里完全不可见，只有 AX 树能拿到，且能取到真实坐标。
   */
  async axFind(name, { role = 'button', exact = true } = {}) {
    await this.cdp.send('Accessibility.enable');
    const { nodes } = await this.cdp.send('Accessibility.getFullAXTree', {});
    const norm = (s) => String(s || '').replace(/\s+/g, '');
    const want = norm(name);
    return nodes
      .filter((n) => {
        const nm = norm(n.name?.value);
        const rl = String(n.role?.value || '');
        if (!nm) return false;
        if (role && !new RegExp(role, 'i').test(rl)) return false;
        return exact ? nm === want : nm.includes(want);
      })
      .map((n) => ({
        name: n.name?.value,
        role: n.role?.value,
        backendDOMNodeId: n.backendDOMNodeId,
        disabled: (n.properties || []).some((p) => p.name === 'disabled' && p.value?.value === true),
        ignored: n.ignored === true,
      }))
      .filter((n) => !n.ignored && n.backendDOMNodeId);
  }

  async clickByAx(name, opts = {}) {
    const hits = await this.axFind(name, opts);
    if (!hits.length) {
      throw new SkillError('PAGE_CHANGED', `AX 树里找不到「${name}」`, '页面可能改版；跑 inspect 看看');
    }
    if (hits[0].disabled) {
      throw new SkillError('PUBLISH_FAILED', `「${name}」按钮处于禁用状态`, '通常是必填项/协议未完成');
    }
    const box = await this.cdp.send('DOM.getBoxModel', { backendNodeId: hits[0].backendDOMNodeId });
    const q = box.model.border;
    const x = Math.round((q[0] + q[4]) / 2);
    const y = Math.round((q[1] + q[5]) / 2);
    await this.clickAt(x, y);
    return { ...hits[0], x, y };
  }

  /** 聚焦后输入文本；Input.insertText 会触发 beforeinput/input，React 能收到 */
  async type(selector, text, { clear = true } = {}) {
    await this.click(selector);
    await sleep(150);
    if (clear) {
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await sleep(80);
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await sleep(80);
    }
    await this.cdp.send('Input.insertText', { text });
    return true;
  }

  async pressEnter() {
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }

  async pressEscape() {
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }

  /** 给 <input type=file> 塞文件（隐藏的也能塞，不弹系统对话框） */
  async upload(selector, files) {
    const { root } = await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const q = await this.cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!q || !q.nodeId) throw new SkillError('UPLOAD_FAILED', `找不到文件输入框: ${selector}`);
    await this.cdp.send('DOM.setFileInputFiles', { files, nodeId: q.nodeId });
    return files.length;
  }

  async screenshot(file) {
    const abs = path.resolve(file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await this.bringToFront();
    let lastErr;
    for (const opts of [
      { format: 'png', captureBeyondViewport: false },
      { format: 'png', captureBeyondViewport: true, fromSurface: false },
    ]) {
      try {
        const { data } = await this.cdp.send('Page.captureScreenshot', opts, 10000);
        fs.writeFileSync(abs, Buffer.from(data, 'base64'));
        return abs;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new SkillError('PAGE_CHANGED', `截图失败: ${lastErr?.message || ''}`, '窗口被最小化时 Chrome 可能无法截图');
  }

  /** 页面结构快照，用于选择器失效时排查 */
  async inspect() {
    return this.eval(`(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const label = (el) => (el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || (el.innerText || '').trim().slice(0, 40) || '').replace(/\\s+/g, ' ');
      return {
        url: location.href,
        title: document.title,
        inputs: [...document.querySelectorAll('input, textarea')].filter(vis).map((el) => ({ tag: el.tagName.toLowerCase(), type: el.type, placeholder: el.placeholder || '', accept: el.accept || '', cls: String(el.className || '').slice(0, 100) })),
        editables: [...document.querySelectorAll('[contenteditable="true"], [contenteditable=""]')].filter(vis).map((el) => ({ cls: String(el.className || '').slice(0, 120), placeholder: label(el), text: (el.innerText || '').slice(0, 40) })),
        buttons: [...document.querySelectorAll('button, [role="button"], a')].filter(vis).map((el) => ({ text: label(el), disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true', cls: String(el.className || '').slice(0, 100) })).filter((b) => b.text),
        imgs: [...document.querySelectorAll('img')].filter(vis).length,
        bodyHead: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
      };
    })()`);
  }
}
