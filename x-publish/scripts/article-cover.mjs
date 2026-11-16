// 给 X Article 设置封面：点封面占位 → 拦截文件选择 → 选中图片
import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const URL_ = process.argv[2];
const IMG = process.argv[3];
const OUT = process.argv[4];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = {};
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');

await launch({ port: PORT, profile: profileDir('x'), startUrl: URL_, proxy: PROXY });
const p = await Page.attach(PORT);
await p.goto(URL_);
await sleep(7000);

await p.cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
const chooser = new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), 6000);
  p.cdp.on('Page.fileChooserOpened', (ev) => { clearTimeout(t); resolve(ev); });
});

const spot = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const t=document.body.innerText;const hint=[...document.querySelectorAll('div,span')].filter(vis).find(e=>/5:2 aspect ratio/.test(e.innerText||''));if(!hint)return null;hint.scrollIntoView({block:'center'});const r=hint.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2-40)};})()");
log.spot = spot;
if (!spot) { log.error = '找不到封面占位'; write(); process.exit(1); }
await p.click(spot.x, spot.y);
const ev = await chooser;
log.chooser = ev ? { backend: !!ev.backendNodeId } : null;
if (ev && ev.backendNodeId) {
  await p.cdp.send('DOM.setFileInputFiles', { files: [IMG], backendNodeId: ev.backendNodeId });
  log.steps = ['cover-set'];
  await sleep(8000);
}
log.shot = await p.screenshot(OUT.replace(/\.json$/, '.png'));
write();
process.exit(0);
