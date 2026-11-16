import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';
const URL='https://x.com/compose/articles/edit/2122285274046840833';
await launch({port:9336,profile:profileDir('x'),startUrl:URL,proxy:process.env.X_PROXY});
const p=await Page.attach(9336);
await p.goto(URL); await sleep(8000);
const ins=await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button')].filter(e=>(e.innerText||'').trim()==='Insert'&&e.getBoundingClientRect().width>0);if(!b.length)return null;const r=b[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
const out={ins};
if(ins){ await p.click(ins.x,ins.y); await sleep(2500); out.menu=await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return [...document.querySelectorAll('[role=menuitem],div,span')].filter(vis).map(e=>(e.innerText||'').trim()).filter(t=>t&&t.length<14).slice(0,20);})()"); }
out.shot=await p.screenshot('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/insert-menu.png');
fs.writeFileSync('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/insert-menu.json',JSON.stringify(out,null,2),'utf8');
console.log(JSON.stringify(out));
process.exit(0);
