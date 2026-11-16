// 发 thread：主帖（可带图）→ 依次回复自己。
// job: { "text": "...", "images": [...], "replies": ["...", "..."] }
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, artifactsDir, sleep } from './lib/cdp.mjs';

const JOB = process.argv[2];
const OUT = process.argv[3];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = { steps: [] };
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');
const job = JSON.parse(fs.readFileSync(JOB, 'utf8'));
const sleepLong = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeInto(p, text) {
  const box = await p.eval("(()=>{const ed=document.querySelector('[data-testid=\"tweetTextarea_0\"]');if(!ed)return null;ed.focus();const r=ed.getBoundingClientRect();return{x:Math.round(r.x+40),y:Math.round(r.y+18)};})()");
  if (!box) throw new Error('没有输入框');
  await p.click(box.x, box.y);
  await sleepLong(300);
  await p.typeText(text);
  await sleepLong(600);
  return await p.eval("(()=>{const ed=document.querySelector('[data-testid=\"tweetTextarea_0\"]');return (ed&&ed.innerText||'').trim().length;})()");
}

async function clickPost(p) {
  const b = await p.eval("(()=>{const el=document.querySelector('xhs-publish-btn')||document.querySelector('[data-testid=\"tweetButtonInline\"]')||document.querySelector('[data-testid=\"tweetButton\"]');if(!el)return null;const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  if (!b) throw new Error('找不到发布按钮');
  await p.click(b.x, b.y);
  await sleepLong(5000);
}

try {
  await launch({ port: PORT, profile: profileDir('x'), startUrl: 'https://x.com/compose/post', proxy: PROXY });
  const p = await Page.attach(PORT);
  for (let i = 0; i < 2; i++) {
    await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await sleepLong(400);
  }
  await p.goto('https://x.com/compose/post');
  await sleepLong(3500);

  // 主帖
  const mainLen = await typeInto(p, job.text);
  log.mainLen = mainLen;
  const imgs = (job.images || []).map((x) => (path.isAbsolute(x) ? x : path.resolve(path.dirname(JOB), x))).filter((x) => fs.existsSync(x));
  if (imgs.length) {
    await p.upload('input[type=file]', imgs.slice(0, 4));
    await sleepLong(6000);
  }
  await clickPost(p);
  log.steps.push('main-posted');
  write();
  await sleepLong(4000);

  // 取刚发主帖的 URL
  await p.goto('https://x.com/PeanutPair');
  await sleepLong(5000);
  const url = await p.eval("(()=>{const a=document.querySelector('article a[href*=\"/status/\"]');return a?a.href:null;})()");
  log.url = url;
  if (!url) throw new Error('拿不到主帖链接');
  write();

  // 逐条回复
  for (let i = 0; i < (job.replies || []).length; i++) {
    const text = job.replies[i];
    await p.goto(url);
    await sleepLong(4000);
    const replyBtn = await p.eval("(()=>{const b=document.querySelector('[data-testid=\"reply\"]');if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
    if (!replyBtn) throw new Error('找不到回复按钮');
    await p.click(replyBtn.x, replyBtn.y);
    await sleepLong(2500);
    const len = await typeInto(p, text);
    log.steps.push(`reply${i + 1}:${len}`);
    await clickPost(p);
    await sleepLong(2500);
    write();
  }
  log.ok = true;
} catch (e) {
  log.error = e.message;
}
write();
process.exit(0);
