// 列出小红书「图文笔记」草稿标题
import { ensureBrowser } from './lib/xhs.mjs';
import { sleep } from './lib/util.mjs';

const acct = { alias: 'ai', label: 'AI/科技号', port: 9333, dataDir: 'xhs', expectedNickname: 'TwoPeanuts', expectedRedId: '7247802890' };
const out = {};
const p = await ensureBrowser(acct);
await p.goto('https://creator.xiaohongshu.com/publish/publish');
await sleep(4000);
const entry = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const a=[...document.querySelectorAll('div,span,a')].filter(vis).filter(e=>/草稿箱/.test((e.innerText||'').trim())&&(e.innerText||'').trim().length<12);if(!a.length)return null;const r=a[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
if (entry) { await p.clickAt(entry.x, entry.y); await sleep(3000); }
const tab = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const a=[...document.querySelectorAll('div,span')].filter(vis).filter(e=>/^图文笔记\\(\\d+\\)$/.test((e.innerText||'').trim()));if(!a.length)return null;const r=a[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),txt:a[0].innerText.trim()};})()");
out.tab = tab;
if (tab) { await p.clickAt(tab.x, tab.y); await sleep(3000); }
out.titles = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return [...document.querySelectorAll('div,span,p')].filter(vis).map(e=>(e.innerText||'').trim()).filter(t=>t&&t.length>4&&t.length<60).slice(0,25);})()");
out.shot = await p.screenshot('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/xhs-drafts2.png');
console.log(JSON.stringify(out, null, 2));
process.exit(0);
