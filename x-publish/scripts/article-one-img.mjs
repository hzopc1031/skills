// 插入一张图并截图验证：用第一个 file input（第一次成功时用的就是它）
import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const URL_ = 'https://x.com/compose/articles/edit/2122285274046840833';
const PARA = process.argv[2] || '第一步';
const IMG = process.argv[3];
const OUT = process.argv[4];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = { para: PARA };
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');

await launch({ port: PORT, profile: profileDir('x'), startUrl: URL_, proxy: PROXY });
const p = await Page.attach(PORT);
await p.goto(URL_);
await sleep(9000);

const pos = await p.eval(`(()=>{const ed=document.querySelector('[contenteditable=true]');const ps=[...ed.querySelectorAll('div,p')].filter(e=>(e.innerText||'').trim().startsWith(${JSON.stringify(PARA)}));if(!ps.length)return null;ps[0].scrollIntoView({block:'center'});const r=ps[0].getBoundingClientRect();return{x:Math.round(r.x+r.width-20),y:Math.round(r.y+r.height-8)};})()`);
log.pos = pos;
if (!pos) { write(); process.exit(1); }
await p.click(pos.x, pos.y);
await sleep(500);
await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(700);

const ins = await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button')].filter(e=>(e.innerText||'').trim()==='Insert'&&e.getBoundingClientRect().width>0);if(!b.length)return null;const r=b[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
log.insert = ins;
await p.click(ins.x, ins.y);
await sleep(2000);
const media = await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button,[role=menuitem]')].filter(e=>(e.innerText||'').trim()==='Media'&&e.getBoundingClientRect().width>0);if(!b.length)return null;const r=b[b.length-1].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
log.media = media;
await p.click(media.x, media.y);
await sleep(3000);

// 关键：第一个 input（第一次成功用的就是 querySelector 第一个）
const doc = await p.cdp.send('DOM.getDocument', { depth: -1 });
const q = await p.cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
log.nodeId = q.nodeId;
await p.cdp.send('DOM.setFileInputFiles', { files: [IMG], nodeId: q.nodeId });
await sleep(14000);

// 滚到该段落截图验证
await p.eval(`(()=>{const ed=document.querySelector('[contenteditable=true]');const ps=[...ed.querySelectorAll('div,p')].filter(e=>(e.innerText||'').trim().startsWith(${JSON.stringify(PARA)}));if(ps[0])ps[0].scrollIntoView({block:'start'});})()`);
await sleep(1500);
log.shot = await p.screenshot(OUT.replace(/\.json$/, '.png'));
write();
process.exit(0);
