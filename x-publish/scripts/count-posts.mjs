import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, artifactsDir, sleep } from './lib/cdp.mjs';
const PORT=9336;
await launch({port:PORT,profile:profileDir('x'),startUrl:'https://x.com/PeanutPair',proxy:process.env.X_PROXY});
const p=await Page.attach(PORT);
await p.goto('https://x.com/PeanutPair');
await sleep(6000);
const seen=new Set();
for(let i=0;i<3;i++){
  const list=await p.eval("(()=>[...document.querySelectorAll('[data-testid=\"tweetText\"]')].map(e=>e.innerText.replace(/\\s+/g,' ').slice(0,26)))()");
  for(const t of list) seen.add(t);
  await p.eval('window.scrollBy(0, 900)');
  await sleep(1800);
}
console.log(JSON.stringify({count:seen.size, items:[...seen].slice(0,10)},null,2));
process.exit(0);
