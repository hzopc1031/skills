// 清理小红书重复草稿：保留最新一份，删掉同名旧稿
import { ensureBrowser } from './lib/xhs.mjs';
import { sleep } from './lib/util.mjs';

const TITLE = process.argv[2];
const KEEP = Number(process.argv[3] || 1);
const acct = { alias: 'ai', label: 'AI/科技号', port: 9333, dataDir: 'xhs', expectedNickname: 'TwoPeanuts', expectedRedId: '7247802890' };
const log = { deleted: 0, steps: [] };
const p = await ensureBrowser(acct);
await p.goto('https://creator.xiaohongshu.com/publish/publish');
await sleep(4000);

const open = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const a=[...document.querySelectorAll('div,span,a')].filter(vis).filter(e=>/草稿箱/.test((e.innerText||'').trim())&&(e.innerText||'').trim().length<12);if(!a.length)return null;const r=a[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
if (open) { await p.clickAt(open.x, open.y); await sleep(2500); }
const tab = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const a=[...document.querySelectorAll('div,span')].filter(vis).filter(e=>/^图文笔记\\(\\d+\\)$/.test((e.innerText||'').trim()));if(!a.length)return null;const r=a[0].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
if (tab) { await p.clickAt(tab.x, tab.y); await sleep(2500); }

for (let round = 0; round < 6; round++) {
  const rows = await p.eval(`(()=>{const t=${JSON.stringify(TITLE)};const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const items=[...document.querySelectorAll('div')].filter(vis).filter(e=>(e.innerText||'').includes(t)&&(e.innerText||'').includes('删除')&&e.getBoundingClientRect().height<200&&e.getBoundingClientRect().height>40);return items.length;})()`);
  log.steps.push('rows:' + rows);
  if (rows <= KEEP) break;
  const delBtn = await p.eval(`(()=>{const t=${JSON.stringify(TITLE)};const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const items=[...document.querySelectorAll('div')].filter(vis).filter(e=>(e.innerText||'').includes(t)&&(e.innerText||'').includes('删除')&&e.getBoundingClientRect().height<200&&e.getBoundingClientRect().height>40);
    const old=items[items.length-1];
    const b=[...old.querySelectorAll('div,span,a,button')].filter(e=>(e.innerText||'').trim()==='删除')[0];
    if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  if (!delBtn) break;
  await p.clickAt(delBtn.x, delBtn.y);
  await sleep(1500);
  const confirm = await p.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};const b=[...document.querySelectorAll('button,div,span')].filter(vis).filter(e=>/^(删除|确定|确认)$/.test((e.innerText||'').trim()));if(!b.length)return null;const r=b[b.length-1].getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()");
  if (confirm) { await p.clickAt(confirm.x, confirm.y); await sleep(2000); }
  log.deleted++;
}
log.shot = await p.screenshot('D:/AIInfra/publish-jobs/2026-11-15-feishu-delete/xhs-dedup.png');
console.log(JSON.stringify(log, null, 2));
process.exit(0);
