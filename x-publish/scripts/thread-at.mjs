// 在指定主帖下补回复：可断点续跑（按已完成的序号跳过）
// 用法: node thread-at.mjs <statusUrl> <job.json> <out.json>
import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const URL_ = process.argv[2];
const JOB = process.argv[3];
const OUT = process.argv[4];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const job = JSON.parse(fs.readFileSync(JOB, 'utf8'));
let log = { url: URL_, done: [], steps: [] };
try { log = { ...log, ...JSON.parse(fs.readFileSync(OUT, 'utf8')) }; } catch { /* 首次运行 */ }
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');

try {
  await launch({ port: PORT, profile: profileDir('x'), startUrl: URL_, proxy: PROXY });
  const p = await Page.attach(PORT);

  for (let i = 0; i < job.replies.length; i++) {
    if (log.done.includes(i)) continue;
    let posted = false;
    for (let attempt = 1; attempt <= 2 && !posted; attempt++) {
      try {
        for (let k = 0; k < 2; k++) {
          await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
          await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
          await sleep(400);
        }
        await p.goto(URL_).catch(() => {});
        await sleep(5000);
        const rb = await p.eval("(()=>{const b=document.querySelector('[data-testid=\"reply\"]');if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
        if (!rb) throw new Error('没有回复按钮');
        await p.click(rb.x, rb.y);
        await sleep(2500);
        const box = await p.eval("(()=>{const ed=document.querySelector('[data-testid=\"tweetTextarea_0\"]');if(!ed)return null;ed.focus();const r=ed.getBoundingClientRect();return{x:Math.round(r.x+40),y:Math.round(r.y+18)};})()");
        if (!box) throw new Error('回复框没出现');
        await p.click(box.x, box.y);
        await sleep(300);
        await p.typeText(job.replies[i]);
        await sleep(800);
        const btn = await p.eval("(()=>{const el=document.querySelector('[data-testid=\"tweetButtonInline\"]')||document.querySelector('[data-testid=\"tweetButton\"]');if(!el)return null;const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
        if (!btn) throw new Error('没有发送按钮');
        await p.click(btn.x, btn.y);
        await sleep(7000);
        log.done.push(i);
        log.steps.push(`reply${i + 1} ok`);
        posted = true;
        write();
      } catch (e) {
        log.steps.push(`reply${i + 1} attempt${attempt} failed: ${e.message.slice(0, 50)}`);
        write();
        await sleep(2000);
      }
    }
    if (!posted) break;
  }
  log.ok = log.done.length === job.replies.length;
} catch (e) {
  log.error = e.message;
}
write();
process.exit(0);
