import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';
await launch({port:9336,profile:profileDir('x'),startUrl:'https://x.com/home',proxy:process.env.X_PROXY});
const p=await Page.attach(9336);
await p.goto('https://x.com/home');
await sleep(6000);
const link=await p.eval("(()=>{const a=[...document.querySelectorAll('a')].find(e=>(e.innerText||'').trim()==='Articles');return a?a.href:null;})()");
const out={link};
if(link){ await p.goto(link); await sleep(7000); out.url=await p.eval('location.href'); out.text=await p.eval("document.body.innerText.slice(0,500)"); }
out.shot=await p.screenshot('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/x-articles.png');
fs.writeFileSync('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/x-articles.json',JSON.stringify(out,null,2),'utf8');
console.log(JSON.stringify(out));
process.exit(0);
