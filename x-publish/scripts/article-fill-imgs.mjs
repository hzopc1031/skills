// 补插 Article 正文图：第一步/第二步/第四步/第五步
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const URL_ = 'https://x.com/compose/articles/edit/2122285274046840833';
const CARDS = 'D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/cards';
const OUT = 'D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/rest-imgs.json';
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = { steps: [] };
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');

const jobs = [
  { para: '第一步', img: 'card-01.png' },
  { para: '第二步', img: 'card-02.png' },
  { para: '第四步', img: 'card-04.png' },
  { para: '第五步', img: 'card-05.png' },
];

await launch({ port: PORT, profile: profileDir('x'), startUrl: URL_, proxy: PROXY });
const p = await Page.attach(PORT);

for (const j of jobs) {
  await p.goto(URL_);
  await sleep(9000);
  const pos = await p.eval(`(()=>{const ed=document.querySelector('[contenteditable=true]');const ps=[...ed.querySelectorAll('div,p')].filter(e=>(e.innerText||'').trim().startsWith(${JSON.stringify(j.para)}));if(!ps.length)return null;ps[0].scrollIntoView({block:'center'});const r=ps[0].getBoundingClientRect();return{x:Math.round(r.x+r.width-20),y:Math.round(r.y+r.height-8)};})()`);
  if (!pos) { log.steps.push('no-para:' + j.para); continue; }
  await p.click(pos.x, pos.y);
  await sleep(400);
  await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(600);

  const ins = await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button')].filter(e=>(e.innerText||'').trim()==='Insert'&&e.getBoundingClientRect().width>0);if(!b.length)return null;const r=b[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  if (!ins) { log.steps.push('no-insert:' + j.para); continue; }
  await p.click(ins.x, ins.y);
  await sleep(1800);
  const media = await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button,[role=menuitem]')].filter(e=>(e.innerText||'').trim()==='Media'&&e.getBoundingClientRect().width>0);if(!b.length)return null;const r=b[b.length-1].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  if (!media) { log.steps.push('no-media:' + j.para); continue; }
  await p.click(media.x, media.y);
  await sleep(2500);

  const doc = await p.cdp.send('DOM.getDocument', { depth: -1 });
  const all = await p.cdp.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  const nodeId = all.nodeIds[all.nodeIds.length - 1];
  if (!nodeId) { log.steps.push('no-input:' + j.para); continue; }
  await p.cdp.send('DOM.setFileInputFiles', { files: [path.join(CARDS, j.img)], nodeId });
  log.steps.push(`${j.para} ok`);
  write();
  await sleep(9000);
}

await p.goto(URL_);
await sleep(9000);
log.imgs = await p.eval("document.querySelectorAll('[contenteditable=true] img').length");
log.media = await p.eval("(()=>document.querySelectorAll('[contenteditable=true] [aria-label],[contenteditable=true] figure,[role=img]').length)()");
log.shot = await p.screenshot(OUT.replace(/\.json$/, '.png'));
write();
process.exit(0);
