// 给 Article 正文逐段插入图片：光标放到「第N步」段末 → Insert 菜单 → 塞文件 → Apply
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const URL_ = process.argv[2];
const IMG_DIR = process.argv[3];
const OUT = process.argv[4];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = { steps: [] };
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');
const imgs = ['card-01.png', 'card-03.png', 'card-04.png', 'card-05.png'].map((f) => path.join(IMG_DIR, f));

async function setFile(p, file) {
  const doc = await p.cdp.send('DOM.getDocument', { depth: -1 });
  const q = await p.cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  if (!q.nodeId) return false;
  await p.cdp.send('DOM.setFileInputFiles', { files: [file], nodeId: q.nodeId });
  return true;
}

async function apply(p) {
  for (let i = 0; i < 12; i++) {
    const b = await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button')].filter(e=>(e.innerText||'').trim()==='Apply');if(!b.length)return null;const r=b[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
    if (b) { await p.click(b.x, b.y); await sleep(6000); return true; }
    await sleep(1200);
  }
  return false;
}

await launch({ port: PORT, profile: profileDir('x'), startUrl: URL_, proxy: PROXY });
const p = await Page.attach(PORT);
await p.goto(URL_);
await sleep(8000);

for (let n = 0; n < imgs.length; n++) {
  const stepNo = ['一','三','四','五'][n];
  // 光标放到「第N步」那段末尾
  const pos = await p.eval(`(()=>{const ed=document.querySelector('[contenteditable=true]');if(!ed)return null;const ps=[...ed.querySelectorAll('div,p')].filter(e=>/^第${stepNo}步/.test((e.innerText||'').trim()));if(!ps.length)return null;const el=ps[0];el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width-30),y:Math.round(r.y+r.height-10)};})()`);
  if (!pos) { log.steps.push('no-para:' + stepNo); continue; }
  await p.click(pos.x, pos.y);
  await sleep(400);
  await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(600);

  const ok = await setFile(p, imgs[n]);
  const applied = ok ? await apply(p) : false;
  log.steps.push(`step${stepNo} set=${ok} applied=${applied}`);
  write();
  await sleep(1500);
}

log.imgs = await p.eval("document.querySelectorAll('[contenteditable=true] img').length");
log.shot = await p.screenshot(OUT.replace(/\.json$/, '.png'));
write();
process.exit(0);
