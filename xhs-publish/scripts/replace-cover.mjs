#!/usr/bin/env node
// 替换已发布笔记的封面图（实测可用路径）。
// 用法:
//   node replace-cover.mjs --title "笔记标题" --image "D:\path\cover.png" [--submit]
// 说明:
//   1. 笔记管理里按标题找到笔记，点铅笔图标进编辑页；
//   2. 用完整鼠标事件序列点掉旧图（只派发 click 会被 hover 浮层忽略）；
//   3. 上传新图并等 1/18；
//   4. 用无障碍树点「发布」保存（按钮在闭合 shadow DOM 里）。
import fs from 'node:fs';
import { ensureBrowser, assertAccount, submit, XHS } from './lib/xhs.mjs';
import { sleep, log, artifactsDir, stamp, SkillError, jsonOut, readAccounts, resolveAccount } from './lib/util.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const title = arg('title');
const image = arg('image');
const account = resolveAccount(readAccounts(), arg('account', 'ai'));
const submitFlag = process.argv.includes('--submit');
if (!title || !image) {
  jsonOut({ ok: false, code: 'USAGE', message: '需要 --title 与 --image' });
  process.exit(1);
}

const page = await ensureBrowser(account);
await assertAccount(page, account);
await page.goto(XHS.noteManager, { timeout: 60000 });
await sleep(4000);

const opened = await page.eval(`(() => {
  const card = [...document.querySelectorAll('.note-card')].find(e => (e.innerText || '').includes(${JSON.stringify(title)}));
  if (!card) return 'not-found';
  const btns = [...card.querySelectorAll('.note-card__action-btn')];
  if (btns.length < 4) return 'no-edit-button';
  btns[3].click();
  return 'ok';
})()`);
if (opened !== 'ok') throw new SkillError('PAGE_CHANGED', '找不到可编辑的笔记: ' + opened);
await sleep(6000);

const count = () => page.eval(`(() => { const el = document.querySelector('.img-list .status'); return el ? el.innerText.trim() : ''; })()`);
log('编辑页图片:', await count());

// 删除旧图：hover 到图上，再派发完整鼠标事件序列
for (let i = 0; i < 8; i++) {
  const status = await count();
  if (!status || status.startsWith('0')) break;
  const tile = await page.eval(`(() => { const img = document.querySelector('.img-list img'); if (!img) return null; const r = img.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; })()`);
  if (!tile) { await sleep(800); continue; }
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tile.x, y: tile.y, buttons: 0 });
  await sleep(800);
  const ok = await page.eval(`(() => {
    const el = document.querySelector('.img-list .close-btn');
    if (!el) return false;
    for (const t of ['mouseenter','mouseover','mousedown','mouseup','click']) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  })()`);
  log('删除:', ok, await count());
  await sleep(1500);
}

await page.upload('.img-list .top input[type=file]', [image]);
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  if ((await count()) === '1/18') break;
}
log('新图就绪:', await count());
const before = await page.screenshot(`${artifactsDir('ai')}/replace-before-${stamp()}.png`).catch(() => null);

if (!submitFlag) {
  jsonOut({ ok: true, submitted: false, dryRun: true, screenshot: before });
  process.exit(0);
}

await submit(page);
await sleep(2500);
for (const label of ['确认发布', '继续发布', '确定', '确认']) {
  const hits = await page.axFind(label, { role: 'button', exact: true }).catch(() => []);
  if (hits.length && !hits[0].disabled) {
    await page.clickByAx(label, { role: 'button', exact: true }).catch(() => {});
    await sleep(2000);
    break;
  }
}
await sleep(6000);
const url = await page.eval('location.href');
const after = await page.screenshot(`${artifactsDir('ai')}/replace-after-${stamp()}.png`).catch(() => null);
jsonOut({ ok: true, submitted: true, url, screenshot: after });
