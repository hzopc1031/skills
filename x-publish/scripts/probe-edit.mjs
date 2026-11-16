import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, artifactsDir, sleep } from './lib/cdp.mjs';
const PORT=9336;
await launch({port:PORT,profile:profileDir('x'),startUrl:'https://x.com/PeanutPair',proxy:process.env.X_PROXY});
const p=await Page.attach(PORT);
await p.goto('https://x.com/PeanutPair');
await sleep(6000);
const t=await p.eval(`(()=>{const pre='今天 GitHub 涨最快的五个仓库';const arts=[...document.querySelectorAll('article')];for(const a of arts){const x=a.querySelector('[data-testid="tweetText"]');if(x&&x.innerText.startsWith(pre)){const c=a.querySelector('[data-testid="caret"]');if(!c)continue;const r=c.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}}return null;})()`);
const out={caret:t};
if(t){
  await p.click(t.x,t.y); await sleep(2500);
  const e=await p.eval("(()=>{const it=[...document.querySelectorAll('[role=menuitem]')].find(e=>/Edit post|编辑/.test(e.innerText||''));if(!it)return null;const r=it.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  out.editBtn=e;
  if(e){ await p.click(e.x,e.y); await sleep(4000);
    out.state=await p.eval("(()=>({url:location.href,hasEditor:!!document.querySelector('[data-testid=tweetTextarea_0]'),buttons:[...document.querySelectorAll('[data-testid=tweetButton],[data-testid=tweetButtonInline]')].map(b=>b.innerText.trim())}))()");
    out.shot=await p.screenshot(path.join(artifactsDir('x'),'edit-modal.png'));
  }
}
console.log(JSON.stringify(out,null,2));
process.exit(0);
