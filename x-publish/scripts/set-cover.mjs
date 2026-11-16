// 换 Article 封面：点占位区 → 塞第一张图 → Edit media 里 Apply → 截图
import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const URL_ = 'https://x.com/compose/articles/edit/2122285274046840833';
const IMG = process.argv[2];
const OUT = process.argv[3];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = {};
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');

await launch({ port: PORT, profile: profileDir('x'), startUrl: URL_, proxy: PROXY });
const p = await Page.attach(PORT);
await p.goto(URL_);
await sleep(9000);

const spot = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const hint=[...document.querySelectorAll('div,span')].filter(vis).find(e=>/5:2 aspect ratio/.test(e.innerText||''));if(!hint)return null;hint.scrollIntoView({block:'center'});const r=hint.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2-40)};})()");
log.spot = spot;
if (!spot) { log.error = 'no placeholder'; write(); process.exit(1); }
await p.click(spot.x, spot.y);
await sleep(3000);

const doc = await p.cdp.send('DOM.getDocument', { depth: -1 });
const q = await p.cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
await p.cdp.send('DOM.setFileInputFiles', { files: [IMG], nodeId: q.nodeId });
await sleep(7000);

for (let i = 0; i < 10; i++) {
  const b = await p.eval("(()=>{const b=[...document.querySelectorAll('div,span,button')].filter(e=>(e.innerText||'').trim()==='Apply'&&e.getBoundingClientRect().width>0);if(!b.length)return null;const r=b[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  if (b) { await p.click(b.x, b.y); log.applied = true; break; }
  await sleep(1200);
}
await sleep(8000);
log.shot = await p.screenshot(OUT.replace(/\.json$/, '.png'));
write();
process.exit(0);
