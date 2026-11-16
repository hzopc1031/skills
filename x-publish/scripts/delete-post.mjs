// 删除自己的一条推文：按正文前缀定位（先滚动到视野内）→ 三点菜单 → Delete → 确认
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, artifactsDir, sleep } from './lib/cdp.mjs';

const PREFIX = process.argv[2];
const OUT = process.argv[3] || path.join(artifactsDir('x'), 'delete.json');
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = { prefix: PREFIX, steps: [] };
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

  // 目标可能在更下面：边滚动边找（X 时间线是虚拟列表）
  let found = false;
  for (let i = 0; i < 30 && !found; i++) {
    found = await p.eval(`(()=>{const t=${JSON.stringify(PREFIX)};const arts=[...document.querySelectorAll('article')];for(const a of arts){const txt=a.querySelector('[data-testid="tweetText"]');if(txt&&txt.innerText.startsWith(t)){a.scrollIntoView({block:'center'});return true;}}return false;})()`);
    if (found) break;
    await p.eval('window.scrollBy(0, 700)');
    await sleep(1400);
  }
  await sleep(1200);
  const target = await p.eval(`(()=>{const t=${JSON.stringify(PREFIX)};const arts=[...document.querySelectorAll('article')];for(const a of arts){const txt=a.querySelector('[data-testid="tweetText"]');if(!txt||!txt.innerText.startsWith(t))continue;const caret=a.querySelector('[data-testid="caret"]');if(!caret)continue;const r=caret.getBoundingClientRect();if(r.top<40||r.top>window.innerHeight-60)continue;return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}return null;})()`);
  if (!target) { log.error = '找不到目标推文（可能不在视野）'; write(); process.exit(1); }
  await sleep(400);
  await p.click(target.x, target.y);
  await sleep(2500);
  const del = await p.eval(`(()=>{const items=[...document.querySelectorAll('[role="menuitem"]')];const hit=items.find(e=>{const s=(e.innerText||'').trim();return s==='Delete'||s==='删除';});if(!hit)return null;const r=hit.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  if (!del) { log.error = '菜单里没有 Delete'; write(); process.exit(1); }
  await p.click(del.x, del.y);
  await sleep(1500);
  const ok = await p.eval("(()=>{const b=document.querySelector('[data-testid=\"confirmationSheetConfirm\"]');if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  if (!ok) { log.error = '没有确认按钮'; write(); process.exit(1); }
  await p.click(ok.x, ok.y);
  await sleep(3500);
  const gone = await p.eval(`(()=>{const t=${JSON.stringify(PREFIX)};return ![...document.querySelectorAll('[data-testid="tweetText"]')].some(e=>e.innerText.startsWith(t));})()`);
  log.deleted = gone;
  write();
  process.exit(gone ? 0 : 1);
} catch (e) {
  log.error = e.message;
  write();
  process.exit(1);
}
