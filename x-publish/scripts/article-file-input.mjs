// 直接给 Article 页面的隐藏 input[type=file] 塞图片（封面或正文图）
import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const URL_ = process.argv[2];
const IMG = process.argv[3];
const OUT = process.argv[4];
const MODE = process.argv[5] || 'direct'; // direct = 直接塞第一个 file input
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = {};
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');

await launch({ port: PORT, profile: profileDir('x'), startUrl: URL_, proxy: PROXY });
const p = await Page.attach(PORT);
await p.goto(URL_);
await sleep(8000);

log.inputs = await p.eval("(()=>[...document.querySelectorAll('input[type=file]')].map((e,i)=>({i,accept:(e.accept||'').slice(0,40),hidden:e.offsetParent===null})))()");
write();

const doc = await p.cdp.send('DOM.getDocument', { depth: -1 });
const q = await p.cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
if (!q.nodeId) { log.error = '页面没有 file input'; write(); process.exit(1); }
await p.cdp.send('DOM.setFileInputFiles', { files: [IMG], nodeId: q.nodeId });
log.set = true;
await sleep(9000);
log.imgs = await p.eval("document.querySelectorAll('[contenteditable=true] img').length");
log.cover = await p.eval("(()=>{const b=document.querySelector('[alt=\"Image\"],img');return document.querySelectorAll('img').length;})()");
log.shot = await p.screenshot(OUT.replace(/\.json$/, '.png'));
write();
process.exit(0);
