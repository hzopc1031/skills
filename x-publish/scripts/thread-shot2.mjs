import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, artifactsDir, sleep } from './lib/cdp.mjs';
const URL='https://x.com/PeanutPair/status/2121940819515240648';
await launch({port:9336,profile:profileDir('x'),startUrl:URL,proxy:process.env.X_PROXY});
const p=await Page.attach(9336);
await p.goto(URL);
await sleep(7000);
const seen=new Set();
for(let i=0;i<4;i++){
  const list=await p.eval("(()=>[...document.querySelectorAll('[data-testid=\"tweetText\"]')].map(e=>e.innerText.replace(/\\s+/g,' ').slice(0,20)))()");
  for(const t of list) seen.add(t);
  await p.eval('window.scrollBy(0,900)');
  await sleep(1500);
}
const shot=await p.screenshot(path.join(artifactsDir('x'),'thread-replies.png'));
console.log(JSON.stringify({count:seen.size,items:[...seen],shot},null,2));
process.exit(0);
