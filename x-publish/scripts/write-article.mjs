// 写一篇 X Article：填标题 + 正文（段落间留图位），自动存草稿，不发布。
import fs from 'node:fs';
import { launch, Page, profileDir, sleep } from './lib/cdp.mjs';

const URL_ = process.argv[2];
const TITLE = process.argv[3];
const BODY_FILE = process.argv[4];
const OUT = process.argv[5];
const PORT = 9336;
const PROXY = process.env.X_PROXY || 'http://127.0.0.1:12334';
const log = { url: URL_, steps: [] };
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');
const blocks = JSON.parse(fs.readFileSync(BODY_FILE, 'utf8')); // [{type:'p',text} | {type:'img',path}]

await launch({ port: PORT, profile: profileDir('x'), startUrl: URL_, proxy: PROXY });
const p = await Page.attach(PORT);
await p.goto(URL_);
await sleep(7000);

// 标题
const t = await p.eval("(()=>{const ta=[...document.querySelectorAll('textarea')].find(e=>(e.placeholder||'')==='Add a title');if(!ta)return null;ta.focus();const r=ta.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
if (!t) throw new Error('没有标题框');
await p.click(t.x, t.y);
await sleep(300);
await p.cdp.send('Input.insertText', { text: TITLE });
await sleep(1200);
log.steps.push('title');

// 正文
const body = await p.eval("(()=>{const ed=document.querySelector('[contenteditable=true]');if(!ed)return null;ed.focus();const r=ed.getBoundingClientRect();return{x:Math.round(r.x+60),y:Math.round(r.y+30)};})()");
if (!body) throw new Error('没有正文区');
await p.click(body.x, body.y);
await sleep(400);

for (const b of blocks) {
  if (b.type === 'p') {
    await p.cdp.send('Input.insertText', { text: b.text });
    await sleep(300);
    await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await p.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(250);
  } else if (b.type === 'img') {
    log.steps.push('img-skip:' + b.path);
  }
}
log.steps.push('body');
await sleep(4000);
log.saved = await p.eval("(()=>{const t=document.body.innerText;return /Last saved|Saved/.test(t);})()");
log.shot = await p.screenshot(OUT.replace(/\.json$/, '.png'));
write();
process.exit(0);
