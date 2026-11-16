import fs from 'node:fs';
import path from 'node:path';
import { launch, Page, profileDir, artifactsDir, sleep } from './lib/cdp.mjs';
const PORT=9336, PROXY=process.env.X_PROXY;
await launch({port:PORT,profile:profileDir('x'),startUrl:'https://x.com/PeanutPair',proxy:PROXY});
const p=await Page.attach(PORT);
await p.goto('https://x.com/PeanutPair');
await sleep(6000);
const t=await p.eval("(()=>{const a=document.querySelector('article');const c=a&&a.querySelector('[data-testid=\"caret\"]');if(!c)return null;const r=c.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
if(t){ await p.click(t.x,t.y); await sleep(1500); }
const menu=await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return [...document.querySelectorAll('[role=menuitem],[role=menu] *')].filter(vis).map(e=>({tag:e.tagName,txt:(e.innerText||'').trim().slice(0,20),role:e.getAttribute('role')})).slice(0,12);})()");
const all=await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return [...document.querySelectorAll('[role=menuitem]')].length;})()");
console.log(JSON.stringify({menu,count:all}));
process.exit(0);
