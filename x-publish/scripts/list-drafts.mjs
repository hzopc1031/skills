// 打开 X 的 Drafts 面板，列出草稿首行，确认飞书那条在
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';
import fs from 'node:fs';

const OUT = process.argv[2];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = {};
await launch({ port: PORT, profile: profileDir('x'), startUrl: 'https://x.com/compose/post', proxy: PROXY });
const p = await Page.attach(PORT);
await p.goto('https://x.com/compose/post');
await sleep(3500);
// 点 Drafts 打开草稿列表
const d = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const a=[...document.querySelectorAll('div,span,a')].filter(vis).filter(e=>(e.innerText||'').trim()==='Drafts');if(!a.length)return null;const r=a[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
log.draftsBtn = d;
if (d) { await p.click(d.x, d.y); await sleep(3000); }
log.texts = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return [...document.querySelectorAll('div,span')].filter(vis).map(e=>(e.innerText||'').trim()).filter(t=>t&&t.length>6&&t.length<80).slice(0,15);})()");
log.shot = await p.screenshot('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/x-drafts.png');
fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');
process.exit(0);
