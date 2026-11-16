// 给最近一条主帖补 thread 回复
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const JOB = process.argv[2];
const OUT = process.argv[3];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const job = JSON.parse(fs.readFileSync(JOB, 'utf8'));
const START = Number(process.argv[4] || 0);
const log = { steps: [] };
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');

try {
  await launch({ port: PORT, profile: profileDir('x'), startUrl: 'https://x.com/PeanutPair', proxy: PROXY });
  const p = await Page.attach(PORT);
  for (let i = 0; i < 2; i++) {
    await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await sleep(400);
  }
  await p.goto('https://x.com/PeanutPair');
  await sleep(6000);
  const url = await p.eval("(()=>{const a=document.querySelector('article a[href*=\"/status/\"]');return a?a.href:null;})()");
  log.url = url;
  write();
  if (!url) throw new Error('拿不到主帖链接');

  for (let i = 0; i < job.replies.length; i++) {
    await p.goto(url);
    await sleep(4500);
    const rb = await p.eval("(()=>{const b=document.querySelector('[data-testid=\"reply\"]');if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
    if (!rb) throw new Error('找不到回复按钮');
    await p.click(rb.x, rb.y);
    await sleep(2500);
    const box = await p.eval("(()=>{const ed=document.querySelector('[data-testid=\"tweetTextarea_0\"]');if(!ed)return null;ed.focus();const r=ed.getBoundingClientRect();return{x:Math.round(r.x+40),y:Math.round(r.y+18)};})()");
    if (!box) throw new Error('回复框没出现');
    await p.click(box.x, box.y);
    await sleep(300);
    await p.typeText(job.replies[i]);
    await sleep(800);
    const btn = await p.eval("(()=>{const el=document.querySelector('[data-testid=\"tweetButtonInline\"]')||document.querySelector('[data-testid=\"tweetButton\"]');if(!el)return null;const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
    if (!btn) throw new Error('回复按钮没出现');
    await p.click(btn.x, btn.y);
    await sleep(5000);
    log.steps.push('reply' + (i + 1));
    write();
  }
  log.ok = true;
} catch (e) {
  log.error = e.message;
}
write();
process.exit(0);
