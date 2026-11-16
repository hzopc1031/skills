import fs from 'node:fs';
import { Page, httpJson, sleep } from './lib/cdp.mjs';
const list=(await httpJson('http://127.0.0.1:9336/json/list')).filter(t=>t.type==='page');
const t=list.find(x=>x.url.includes('/compose/articles/edit'))||list[0];
const { CDP } = await import('./lib/cdp.mjs');
const cdp=await CDP.connect(t.webSocketDebuggerUrl);
const p=new Page(cdp);
const btn=await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button')].filter(e=>(e.innerText||'').trim()==='Apply');if(!b.length)return null;const r=b[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
let out={btn};
if(btn){ await p.click(btn.x,btn.y); await sleep(7000); out.imgs=await p.eval("document.querySelectorAll('img').length"); out.saved=await p.eval("/Last saved|Saved/.test(document.body.innerText)"); }
out.shot=await p.screenshot('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/cover3.png');
fs.writeFileSync('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/cover3.json',JSON.stringify(out,null,2),'utf8');
console.log(JSON.stringify(out));
process.exit(0);
