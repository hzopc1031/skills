// X：把内容写进发帖框后关闭并「保存草稿」，不发布。
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const JOB = process.argv[2];
const OUT = process.argv[3];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const job = JSON.parse(fs.readFileSync(JOB, 'utf8'));
const log = { steps: [] };
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');

try {
  await launch({ port: PORT, profile: profileDir('x'), startUrl: 'https://x.com/compose/post', proxy: PROXY });
  const p = await Page.attach(PORT);
  for (let i = 0; i < 2; i++) {
    await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
    await sleep(400);
  }
  await p.goto('https://x.com/compose/post');
  await sleep(3500);

  const box = await p.eval("(()=>{const ed=document.querySelector('[data-testid=\"tweetTextarea_0\"]');if(!ed)return null;ed.focus();const r=ed.getBoundingClientRect();return{x:Math.round(r.x+40),y:Math.round(r.y+18)};})()");
  if (!box) throw new Error('没有输入框');
  await p.click(box.x, box.y);
  await sleep(300);
  await p.typeText(job.text);
  await sleep(600);

  const imgs = (job.images || []).map((x) => (path.isAbsolute(x) ? x : path.resolve(path.dirname(JOB), x))).filter((x) => fs.existsSync(x));
  if (imgs.length) {
    await p.upload('input[type=file]', imgs.slice(0, 4));
    await sleep(7000);
  }
  log.steps.push('filled');
  await p.screenshot(path.join('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete', 'x-draft-filled.png'));

  // 关闭发帖框 → 弹窗里选「保存 / Save」
  const close = await p.eval("(()=>{const b=document.querySelector('[data-testid=\"app-bar-close\"]');if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  if (!close) throw new Error('找不到关闭按钮');
  await p.click(close.x, close.y);
  await sleep(2000);
  const save = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const b=[...document.querySelectorAll('[role=\"button\"],button,div')].filter(vis).filter(e=>{const t=(e.innerText||'').trim();return t==='Save'||t==='保存';});if(!b.length)return null;const e=b[b.length-1];const r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),txt:e.innerText.trim()};})()");
  log.saveBtn = save;
  if (save) {
    await p.click(save.x, save.y);
    await sleep(3000);
  }
  log.steps.push(save ? 'saved' : 'no-save-dialog');
  log.ok = true;
} catch (e) {
  log.error = e.message;
}
write();
process.exit(0);
