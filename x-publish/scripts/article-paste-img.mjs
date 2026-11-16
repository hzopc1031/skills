// 在 Article 正文光标处粘贴剪贴板里的图片（配套 PowerShell 先把 PNG 放进剪贴板）
import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const URL_ = process.argv[2];
const OUT = process.argv[3];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = {};
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');

await launch({ port: PORT, profile: profileDir('x'), startUrl: URL_, proxy: PROXY });
const p = await Page.attach(PORT);
await p.goto(URL_);
await sleep(7000);

// 光标放到正文最后一个段落末尾
const pos = await p.eval("(()=>{const ed=document.querySelector('[contenteditable=true]');if(!ed)return null;ed.focus();const ps=[...ed.querySelectorAll('div,p,span')].filter(e=>e.isContentEditable||e.tagName==='P');const last=[...ed.childNodes].filter(n=>n.nodeType===1).pop();const r=ed.getBoundingClientRect();return{x:Math.round(r.x+80),y:Math.round(r.y+Math.min(r.height-40, 320))};})()");
log.pos = pos;
if (!pos) { log.error = '没有正文区'; write(); process.exit(1); }
await p.click(pos.x, pos.y);
await sleep(500);

// Ctrl+V（VK 86）
await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2 });
await sleep(6000);

log.imgs = await p.eval("document.querySelectorAll('[contenteditable=true] img').length");
log.shot = await p.screenshot(OUT.replace(/\.json$/, '.png'));
write();
process.exit(0);
