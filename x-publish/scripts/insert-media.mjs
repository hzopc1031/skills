import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';
const URL='https://x.com/compose/articles/edit/2122285274046840833';
const IMG='D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/cards/card-03.png';
await launch({port:9336,profile:profileDir('x'),startUrl:URL,proxy:process.env.X_PROXY});
const p=await Page.attach(9336);
await p.goto(URL); await sleep(8000);
const out={};
// 光标放进「第三步」段末
const pos=await p.eval("(()=>{const ed=document.querySelector('[contenteditable=true]');const ps=[...ed.querySelectorAll('div,p')].filter(e=>/^第三步/.test((e.innerText||'').trim()));if(!ps.length)return null;ps[0].scrollIntoView({block:'center'});const r=ps[0].getBoundingClientRect();return{x:Math.round(r.x+r.width-20),y:Math.round(r.y+r.height-8)};})()");
out.pos=pos;
if(pos){ await p.click(pos.x,pos.y); await sleep(400); }
const ins=await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button')].filter(e=>(e.innerText||'').trim()==='Insert'&&e.getBoundingClientRect().width>0);if(!b.length)return null;const r=b[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
await p.click(ins.x,ins.y); await sleep(2000);
const media=await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button,[role=menuitem]')].filter(e=>(e.innerText||'').trim()==='Media'&&e.getBoundingClientRect().width>0);if(!b.length)return null;const r=b[b.length-1].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
out.media=media;
if(media){ await p.click(media.x,media.y); await sleep(3000); }
out.inputs=await p.eval("(()=>[...document.querySelectorAll('input[type=file]')].map((e,i)=>({i,accept:(e.accept||'').slice(0,30)})))()");
const doc=await p.cdp.send('DOM.getDocument',{depth:-1});
const q=await p.cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type=file]'});
if(q.nodeId){ await p.cdp.send('DOM.setFileInputFiles',{files:[IMG],nodeId:q.nodeId}); out.set=true; await sleep(8000); }
out.shot=await p.screenshot('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/media-insert.png');
fs.writeFileSync('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/media-insert.json',JSON.stringify(out,null,2),'utf8');
console.log(JSON.stringify(out));
process.exit(0);
