import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';
await launch({port:9336,profile:profileDir('x'),startUrl:'https://x.com/compose/articles',proxy:process.env.X_PROXY});
const p=await Page.attach(9336);
await p.goto('https://x.com/compose/articles');
await sleep(6000);
const w=await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const b=[...document.querySelectorAll('div,span,a,button')].filter(vis).filter(e=>(e.innerText||'').trim()==='Write');if(!b.length)return null;const r=b[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
const out={write:w};
if(w){ await p.click(w.x,w.y); await sleep(8000); out.url=await p.eval('location.href'); out.editors=await p.eval("(()=>({ce:[...document.querySelectorAll('[contenteditable=true]')].map(e=>({cls:String(e.className).slice(0,40),ph:e.getAttribute('data-placeholder')||e.getAttribute('aria-label')||''})),inputs:[...document.querySelectorAll('input,textarea')].map(e=>({tag:e.tagName,ph:e.placeholder||''})).slice(0,6)}))()"); out.text=await p.eval("document.body.innerText.slice(0,300)"); }
out.shot=await p.screenshot('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/x-article-editor.png');
fs.writeFileSync('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/x-article-editor.json',JSON.stringify(out,null,2),'utf8');
console.log(JSON.stringify(out,null,1));
process.exit(0);
