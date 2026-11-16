// 小红书：填入内容后点「存草稿 / 暂存离开」，不发布。
import fs from 'node:fs';
import path from 'node:path';
import { ensureBrowser, assertAccount, gotoPublish, uploadImages, fillTitle, fillBody, dismissTips } from './lib/xhs.mjs';
import { sleep } from './lib/util.mjs';

const JOB = process.argv[2];
const OUT = process.argv[3];
const job = JSON.parse(fs.readFileSync(JOB, 'utf8'));
const log = { steps: [] };
const write = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 2), 'utf8');
const acct = { alias: 'ai', label: 'AI/科技号', port: 9333, dataDir: 'xhs', expectedNickname: 'TwoPeanuts', expectedRedId: '7247802890' };

const BTN_EXPR = [
  "(()=>{",
  "const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};",
  "const all=[...document.querySelectorAll('button,div,span,a')].filter(vis);",
  "const hit=all.filter(e=>{const t=(e.innerText||'').trim();return t==='存草稿'||t==='暂存离开'||t==='保存草稿';});",
  "if(!hit.length)return null;",
  "const e=hit[hit.length-1];const r=e.getBoundingClientRect();",
  "return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),txt:e.innerText.trim()};",
  "})()",
].join('');

try {
  const page = await ensureBrowser(acct);
  await assertAccount(page, acct);
  await gotoPublish(page, { textOnly: false });
  const imgs = (job.images || []).map((p) => (path.isAbsolute(p) ? p : path.resolve(path.dirname(JOB), p)));
  await uploadImages(page, imgs);
  log.steps.push('images:' + imgs.length);
  await fillTitle(page, job.title);
  await fillBody(page, job.content, job.topics || []);
  await dismissTips(page, 3);
  log.steps.push('filled');
  await sleep(1500);

  log.texts = await page.eval("(()=>{const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};return [...document.querySelectorAll('button,div,span,a')].filter(vis).map(e=>(e.innerText||'').trim()).filter(t=>t&&t.length<=8).slice(-30);})()");
  const btn = await page.eval(BTN_EXPR);
  log.btn = btn;
  if (!btn) throw new Error('找不到存草稿按钮');
  await page.clickAt(btn.x, btn.y);
  await sleep(4000);
  log.after = await page.eval("(()=>[...document.querySelectorAll('div,span')].map(e=>(e.innerText||'').trim()).filter(x=>/草稿|成功/.test(x)).slice(0,6))()");
  log.url = await page.url();
  log.ok = true;
} catch (e) {
  log.error = e.message;
}
write();
process.exit(log.ok ? 0 : 1);
