// x-publish：把一条内容发到 X（真实推文，不是草稿）。
// 用法：
//   node x.mjs status
//   node x.mjs post --job <job.json> [--submit]
// job.json: { "text": "...", "images": ["a.png"], "alt": ["..."] }
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, artifactsDir, sleep } from './lib/cdp.mjs';

const PORT = 9336;
const PROXY = process.env.X_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:12334';
const PROFILE = profileDir('x');
const HOME = 'https://x.com/home';
const COMPOSE = 'https://x.com/compose/post';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name) { return process.argv.includes(name); }
function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  process.exit(code);
}

const cmd = process.argv[2];

async function open() {
  await launch({ port: PORT, profile: PROFILE, startUrl: HOME, proxy: PROXY });
  const page = await Page.attach(PORT);
  return page;
}

async function loggedIn(page) {
  const v = await page.eval("(()=>({url:location.href,compose:!!document.querySelector('[data-testid=\"SideNav_NewTweet_Button\"],[aria-label=\"Post\"]'),login:!!document.querySelector('[data-testid=\"SideNav_AccountSwitcher_Button\"]'),guest:/\\/i\\/flow\\/login|\\/login/.test(location.href)}))()");
  return v;
}

try {
  if (cmd === 'status') {
const page = await open();
    // 上一次可能留下半开的发帖框，先按 Esc 关掉，避免导航被拦截
    for (let i = 0; i < 2; i++) {
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
      await sleep(600);
    }
    await page.goto(HOME);
    await sleep(2500);
    const s = await loggedIn(page);
    const shot = await page.screenshot(path.join(artifactsDir('x'), `status-${Date.now()}.png`));
    out({ ok: s.login && !s.guest, port: PORT, profile: PROFILE, loggedIn: s.login, url: s.url, screenshot: shot });
  }

  if (cmd === 'post') {
    const jobPath = arg('--job');
    if (!jobPath) out({ ok: false, code: 'USAGE', message: '缺少 --job' }, 2);
    const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
    const text = String(job.text || '').trim();
    if (!text) out({ ok: false, code: 'USAGE', message: 'job.text 为空' }, 2);
    // X 对中日韩字符按 2 计权；Premium 账号可发长文，用 X_MAX_WEIGHT 或 --max 放宽（默认 280）。
    const weight = [...text].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2e80 ? 2 : 1), 0);
    const maxWeight = Number(process.env.X_MAX_WEIGHT || (has('--max') ? arg('--max') : 280));
    if (weight > maxWeight) out({ ok: false, code: 'USAGE', message: `按 X 计权 ${weight}/${maxWeight}，中文要再压缩` }, 2);

const page = await open();
    // 上一次可能留下半开的发帖框，先按 Esc 关掉，避免导航被拦截
    for (let i = 0; i < 2; i++) {
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
      await sleep(600);
    }
    await page.goto(HOME);
    await sleep(2500);
    const s = await loggedIn(page);
    if (!s.login || s.guest) {
      const shot = await page.screenshot(path.join(artifactsDir('x'), `login-required-${Date.now()}.png`));
      out({ ok: false, code: 'LOGIN_REQUIRED', message: 'X 未登录，请在打开的窗口里登录后重试', screenshot: shot }, 3);
    }

    // 打开发帖框
    await page.goto(COMPOSE);
    await sleep(3500);
    const ready = await page.eval("(()=>{const ed=document.querySelector('[data-testid=\"tweetTextarea_0\"]');return ed?{ok:true}:{ok:false,html:document.body.innerText.slice(0,200)};})()");
    if (!ready.ok) out({ ok: false, code: 'PAGE_CHANGED', message: '发帖框没出现', detail: ready.html }, 4);

    // 输入正文
    const box = await page.eval("(()=>{const ed=document.querySelector('[data-testid=\"tweetTextarea_0\"]');ed.focus();const r=ed.getBoundingClientRect();return{x:Math.round(r.x+40),y:Math.round(r.y+20)};})()");
    await page.click(box.x, box.y);
    await sleep(400);
    await page.typeText(text);
    await sleep(800);

    // 图片（可选）
    const images = (job.images || []).map((p) => (path.isAbsolute(p) ? p : path.resolve(path.dirname(jobPath), p))).filter((p) => fs.existsSync(p));
    if (images.length) {
      await page.upload('input[type=file]', images.slice(0, 4));
      await sleep(6000);
    }

    const typed = await page.eval("(()=>{const ed=document.querySelector('[data-testid=\"tweetTextarea_0\"]');return (ed&&ed.innerText||'').trim();})()");
    if (!typed) out({ ok: false, code: 'PAGE_CHANGED', message: '正文没写进去' }, 5);

    const shotBefore = await page.screenshot(path.join(artifactsDir('x'), `before-post-${Date.now()}.png`));

    if (!has('--submit')) {
      out({ ok: true, submitted: false, typed, screenshot: shotBefore, message: '已填入，未提交（加 --submit 才真发）' });
    }

    // 点 Post
    const btn = await page.eval("(()=>{const b=[...document.querySelectorAll('[data-testid=\"tweetButton\"],[data-testid=\"tweetButtonInline\"]')].filter(e=>e.getBoundingClientRect().width>0)[0];if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
    if (!btn) out({ ok: false, code: 'PAGE_CHANGED', message: '找不到 Post 按钮' }, 6);
    await page.click(btn.x, btn.y);
    await sleep(6000);

    const after = await page.eval("(()=>({url:location.href,toast:[...document.querySelectorAll('[data-testid=\"toast\"]')].map(e=>e.innerText.trim())}))()");
    const shotAfter = await page.screenshot(path.join(artifactsDir('x'), `after-post-${Date.now()}.png`));
    const ok = after.toast.some((t) => /Your post was sent|已发送|posted/i.test(t)) || /\/home|\/status\//.test(after.url);
    out({ ok, submitted: true, url: after.url, toast: after.toast, screenshot: shotAfter });
  }

  out({ ok: false, code: 'USAGE', message: '用法: status | post --job <file> [--submit]' }, 2);
} catch (e) {
  out({ ok: false, code: 'BROWSER_FAILED', message: e.message }, 1);
}
