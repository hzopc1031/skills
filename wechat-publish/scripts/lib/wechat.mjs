import { prepareGithubIntro } from './github-intro.mjs';
import { prepareWechatCover } from './wechat-cover.mjs';
import { acquireProfileLock } from './browser-lifecycle.mjs';
﻿// 微信公众号图文消息草稿保存流程（只存草稿，不发表）
import path from 'node:path';
import fs from 'node:fs';
import { Page, launch, httpJson } from './cdp.mjs';
import { sleep, log, SkillError, profileDir, artifactsDir, stamp, formatWechatHtml, readWechatHtml, assembleWechatHtml, localFile, preflight } from './util.mjs';

export const WECHAT = {
  home: 'https://mp.weixin.qq.com/',
  editor: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0',
};

export async function isLoggedIn(page) {
  return (await loginState(page)).loggedIn;
}

export async function loginState(page) {
  return page.eval(`(() => {
    const visible = el => { const r=el.getBoundingClientRect(), s=getComputedStyle(el); return r.width>1 && r.height>1 && s.display!=='none' && s.visibility!=='hidden'; };
    const texts=[...document.querySelectorAll('a,button,span,div,p,h1,h2')].filter(visible).map(el => (el.innerText||'').trim());
    const backend=texts.some(t => /^(新的创作|草稿箱|保存为草稿)$/.test(t));
    const qrText=texts.some(t => t.length<160 && /扫码登录|请使用微信扫码|使用微信扫描|扫描二维码.*登录/.test(t));
    const qrImage=[...document.querySelectorAll('img,canvas')].some(el=>visible(el) && /qrcode|qr_code|login_qr/i.test(el.className+' '+el.id+' '+(el.getAttribute('alt')||'')));
    return { loggedIn:location.hostname==='mp.weixin.qq.com' && backend && !(qrText&&qrImage), qrLogin:!backend && (qrText||qrImage), backend, reLogin:texts.some(t=>t==='请重新登录') };
  })()`, {timeout:5000});
}

export async function requireLoggedIn(page) {
  const state = await loginState(page);
  if (state.loggedIn) return state;
  if (state.qrLogin) throw new SkillError('LOGIN_REQUIRED', '当前工作标签确实显示微信扫码登录界面；已停止', '请用户在 9335 的公众号 Chrome 自行扫码');
  throw new SkillError('PAGE_CHANGED', '当前工作标签未确认后台就绪，且不是二维码登录页；不能判定整个会话失效');
}

// 只识别认证参数是否存在，绝不提取其值、构造或导航认证 URL。
export async function ensureBrowser(port = 9335, {allowQr=false} = {}) {
  if (port !== 9335) throw new SkillError('BROWSER_FAILED', '公众号固定使用 9335，拒绝占用 ai/house 端口');
  // 串行化：同一 profile 同时只允许一个 DSH 进程，避免会话被并发顶掉。
  await acquireProfileLock(profileDir('wechat'));
  await launch({ port, profile: profileDir('wechat'), startUrl: WECHAT.home });
  const targets = await httpJson(`http://127.0.0.1:${port}/json/list`);
  const candidates = targets.filter(t => t.type === 'page' && /^https:\/\/mp\.weixin\.qq\.com\/cgi-bin\//.test(t.url) && /[?&]token=[^&]+/.test(t.url) && !/appmsg_edit/.test(t.url));
  const priority=t=>/action=list_card/.test(t.url)?2:(/\/home\?/.test(t.url)?1:0);
  candidates.sort((a,b) => priority(b)-priority(a));
  for (const t of candidates) {
    const page = await Page.attachTarget({ port, id:t.id }).catch(() => null);
    if (!page) continue;
    if (await isLoggedIn(page).catch(() => false)) { log('已选中带 token 的后台工作标签（URL 已脱敏）'); return page; }
    await page.dispose();
  }
  const page = await Page.openWithUrl({ port, url:WECHAT.home });
  try {
    await page.waitFor("document.readyState === 'complete'", { timeout:30000 });
    for (let i=0;i<20;i++) {
      const state=await loginState(page);
      if (state.loggedIn) return page;
      if (i>=3 && state.qrLogin) { if(allowQr) return page; await requireLoggedIn(page); }
      await sleep(500);
    }
    await requireLoggedIn(page);
    return page;
  } catch(e) { await page.dispose({ closeOwned:e.code!=='LOGIN_REQUIRED' }); throw e; }
}

/** 关掉可能挡住界面的引导弹窗（优选联盟带货等） */
async function dismissPromo(page) {
  for (const label of ['稍后再说', '我知道了', '以后再说']) {
    const r = await page.clickJsByText(label, { selector: 'button, a, div, span' }).catch(() => ({ found: false }));
    if (r.found) {
      log(`关掉弹窗: ${label}`);
      await sleep(800);
    }
  }
}

/** 等编辑器就绪：出现第一个 ProseMirror（标题） */
async function waitEditor(page) {
  const ready = await page
    .waitFor(`document.querySelectorAll('div.ProseMirror').length >= 2`, { timeout: 30000, interval: 500 })
    .catch(() => false);
  if (!ready) throw new SkillError('PAGE_CHANGED', '编辑器没加载出来（ProseMirror 少于 2 个）', '跑 inspect 看页面');
  await sleep(1200);
}

/** 标题是这个编辑器里的第一个 ProseMirror，会同步到隐藏的 textarea#title */
async function fillTitle(page, title) {
  await page.type('div.ProseMirror', title);
  await sleep(600);
  const counter = await page.eval(`(() => (document.body.innerText.match(/(\\d+)\\/64/) || [])[1] || null)()`);
  log(`标题已填（计数器 ${counter}/64）`);
  if (counter === '0' || counter === null) {
    throw new SkillError('PAGE_CHANGED', '标题没写进去', '第一个 ProseMirror 可能不是标题，跑 inspect 确认');
  }
}

/** 正文是第二个 ProseMirror；优先插入带内联样式的 HTML */
export async function fillBody(page, text, { html = false } = {}) {
  const sel = await page.eval(`(() => {
    const pms = [...document.querySelectorAll('div.ProseMirror')];
    const el = pms[1];
    if (!el) return null;
    el.setAttribute('data-wx-body', '1');
    return '[data-wx-body="1"]';
  })()`);
  if (!sel) throw new SkillError('PAGE_CHANGED', '找不到正文编辑区');
  if (html) {
    // 真实按键清空使编辑器 selection/state 同步；原生 insertHTML 会被编辑器归一化成无格式文本。
    await page.type(sel, '');
    const inserted = await page.eval(`(() => {
      const el = document.querySelector('[data-wx-body="1"]');
      if (!el) return { ok: false };
      el.focus();
      const data = new DataTransfer();
      data.setData('text/html', ${JSON.stringify(text)});
      const plain = document.createElement('div'); plain.innerHTML = ${JSON.stringify(text)};
      data.setData('text/plain', plain.textContent);
      const event = new ClipboardEvent('paste', { bubbles:true, cancelable:true, clipboardData:data });
      el.dispatchEvent(event);
      return { ok:event.defaultPrevented, len:(el.innerText||'').length, hasQuote:!!el.querySelector('blockquote'), hasLink:!!el.querySelector('a') };
    })()`);
    if (!inserted?.ok) throw new SkillError('PAGE_CHANGED', '编辑器未处理 HTML 粘贴，停止保存');
    await page.waitFor(`(() => {
      const el=document.querySelector('[data-wx-body="1"]');
      const expected=document.createElement('div');expected.innerHTML=${JSON.stringify(text)};
      const norm=s=>s.replace(/\\s+/g,'');
      return norm(el.innerText)===norm(expected.textContent) && el.querySelectorAll('a').length>=expected.querySelectorAll('a').length;
    })()`, {timeout:15000});
    const actual=await page.eval(`(() => {const el=document.querySelector('[data-wx-body="1"]'); return {len:el.innerText.length,hasQuote:!!el.querySelector('blockquote'),hasLink:!!el.querySelector('a')}})()`);
    log(`正文 HTML 粘贴读回已确认（计数 ${actual.len}，引用=${actual.hasQuote}，链接=${actual.hasLink}）`);
    return actual.len;
  }
  await page.type(sel, text);
  await sleep(800);
  const len = await page.eval(`(() => {
    const m = (document.body.innerText.match(/正文字数\\s*(\\d+)/) || [])[1];
    return m ? Number(m) : null;
  })()`);
  log(`正文已填（编辑器计数 ${len}）`);
  return len;
}

/** 尝试把配图插进正文（封面仍走 makeCover） */
export async function insertBodyImages(page, images = []) {
  const files = (images || []).filter(Boolean);
  if (!files.length) return false;
  for (const file of files) localFile(file, process.cwd(), /\.(png|jpe?g|webp|gif|bmp)$/i, '上传图片');
  const beforeCount = await page.eval("document.querySelectorAll('div.ProseMirror')[1]?.querySelectorAll('img[src]').length || 0");
  let clicked = false;
  try {
    await page.clickByAx('图片', { exact: true });
    clicked = true;
  } catch {}
  if (!clicked) {
    const hit = await page.findByText('图片', { selector: 'button, span, div, a, li' }).catch(() => null);
    if (hit) { await page.clickAt(hit.x, hit.y); clicked = true; }
  }
  await sleep(600);
  const input = await page.eval(`(() => {
    const ins = [...document.querySelectorAll('input[type=file]')];
    const el = ins.find((i) => /image|png|jpe?g|webp/i.test(i.accept || '') || (i.accept || '').includes('*'));
    if (!el) return null;
    el.setAttribute('data-wx-img-input', '1');
    return 'input[data-wx-img-input="1"]';
  })()`);
  if (!input) {
    throw new SkillError('UPLOAD_FAILED', '找不到正文插图的文件框');
  }
  await page.upload(input, files);
  const uploaded = await page.waitFor(`document.querySelectorAll('div.ProseMirror')[1]?.querySelectorAll('img[src]').length >= ${beforeCount + files.length}`, {timeout:30000}).catch(() => false);
  if (!uploaded) throw new SkillError('UPLOAD_FAILED', '正文图片上传未完成，停止保存');
  await sleep(1000);
  log(`已向正文插入 ${files.length} 张配图`);
  return true;
}


/** Upload each section image separately so UI completion order cannot swap section identities. */
export async function uploadInlineImages(page, images) {
  const uploaded = new Map();
  for (const item of images) {
    await page.eval(`(() => { const body=document.querySelectorAll('div.ProseMirror')[1]; window.__wechatBeforeInlineImages=new Set(body.querySelectorAll('img[src]')); body.focus(); const range=document.createRange(); range.selectNodeContents(body); range.collapse(false); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`);
    try {
      await insertBodyImages(page, [item.file]);
      const ready = await page.waitFor(`(() => { const added=[...document.querySelectorAll('div.ProseMirror')[1].querySelectorAll('img[src]')].filter(im=>!window.__wechatBeforeInlineImages.has(im)); return added.length===1 && /^https:\\/\\//i.test(added[0].src) && added[0].complete && added[0].naturalWidth>0; })()`, {timeout:30000}).catch(() => false);
      if (!ready) throw new SkillError('UPLOAD_FAILED', `章节图片 ${item.id} 未确认实际上传完成，停止保存`);
      const image = await page.eval(`(() => { const im=[...document.querySelectorAll('div.ProseMirror')[1].querySelectorAll('img[src]')].filter(im=>!window.__wechatBeforeInlineImages.has(im)); if(im.length!==1) return null; const clone=im[0].cloneNode(true); clone.style.maxWidth='100%'; clone.style.height='auto'; clone.style.display='block'; clone.style.margin='0 auto'; return clone.outerHTML; })()`);
      if (!image) throw new SkillError('UPLOAD_FAILED', `章节图片 ${item.id} 映射不唯一，停止保存`);
      uploaded.set(item.id, image);
    } finally {
      await page.eval('delete window.__wechatBeforeInlineImages').catch(() => {});
    }
  }
  return uploaded;
}

/** Fail closed if rich paste loses authored formatting, image identity/order, or image loading. */
export async function verifyRichBody(page, html) {
  // Re-pasting real uploaded images may reload them asynchronously; do not race their cache.
  const loaded = await page.waitFor(`(() => { const body=document.querySelectorAll('div.ProseMirror')[1]; return !!body && [...body.querySelectorAll('img[src]')].every(im=>im.complete && im.naturalWidth>0); })()`, {timeout:30000}).catch(() => false);
  if (!loaded) throw new SkillError('UPLOAD_FAILED', '正文图片未加载完成，停止保存');
  const result = await page.eval(`(() => {
    const body=document.querySelectorAll('div.ProseMirror')[1];
    const expected=document.createElement('section'); expected.innerHTML=${JSON.stringify(html)};
    const norm=s=>(s||'').replace(/\\s+/g,'');
    const expectedImages=[...expected.querySelectorAll('img[src]')].map(im=>im.src);
    const actualImages=[...body.querySelectorAll('img[src]')];
    const imageOk=expectedImages.length===actualImages.length && actualImages.every((im,i)=>im.src===expectedImages[i] && im.complete && im.naturalWidth>0);
    const props=['color','background-color','font-size','font-weight','text-decoration','text-decoration-line','border-left'];
    const actualStyles=[...body.querySelectorAll('[style]')].filter(el=>norm(el.textContent)).map(el=>el.style);
    const marks=[...expected.querySelectorAll('[style]')].filter(el=>norm(el.textContent)).flatMap(el=>props.filter(p=>el.style.getPropertyValue(p)).map(p=>[p,el.style.getPropertyValue(p)]));
    const missing=marks.filter(([p,v])=>!actualStyles.some(style=>style.getPropertyValue(p)===v));
    return {ok:norm(body.innerText)===norm(expected.textContent) && imageOk && marks.length>0 && missing.length===0, images:actualImages.length, missingStyles:[...new Set(missing.map(([p,v])=>p+':'+v))]};
  })()`);
  if (!result?.ok) throw new SkillError('PAGE_CHANGED', `富文本/配图读回不匹配，停止保存（丢失样式：${result?.missingStyles?.join('；') || '正文或图片'}）`);
  return result;
}

/** 摘要 */
async function fillDigest(page, text) {
  if (!text) return;
  const ok = await page.exists('textarea#js_description');
  if (!ok) return;
  await page.type('textarea#js_description', [...text].slice(0, 120).join(''));
  await sleep(400);
  log('摘要已填');
}

/**
 * 封面：点封面区 → 菜单（CSS 隐藏）→ 一键生成封面 → 等生成完 → 使用 AI 图片
 * 整个过程必须在一个进程里完成，弹窗跨连接会自己关掉。
 */
async function makeCover(page) {
  const box = await page.box('.js_cover_btn_area');
  if (!box) throw new SkillError('PAGE_CHANGED', '找不到封面区域');
  await page.clickAt(box.x, box.y);
  await sleep(1200);

  // 菜单容器是 display/visibility 隐藏的，先强制显示再点
  const item = await page.eval(`(() => {
    const el = document.querySelector('.js_aiImage');
    if (!el) return { ok: false };
    let p = el;
    while (p && p !== document.body) {
      const s = getComputedStyle(p);
      if (s.display === 'none') p.style.display = 'block';
      if (s.visibility === 'hidden') p.style.visibility = 'visible';
      if (s.opacity === '0') p.style.opacity = '1';
      p = p.parentElement;
    }
    const r = el.getBoundingClientRect();
    return { ok: r.width > 0, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!item.ok) throw new SkillError('PAGE_CHANGED', '封面菜单打不开');
  await page.clickAt(item.x, item.y);
  log('已触发 AI 封面生成，等待结果…');

  // 等生成出图（一张 >100px 的 mpimageai 图）
  let img = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    img = await page.eval(`(() => {
      const im = [...document.querySelectorAll('img')].find(i => /mpimageai/.test(i.src) && i.getBoundingClientRect().width > 100);
      if (!im) return null;
      const b = im.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    })()`);
    if (img) break;
  }
  if (!img) throw new SkillError('UPLOAD_FAILED', 'AI 封面生成超时', '看截图；也可以手动选封面');

  // 悬停图片才会出现「使用」按钮（.ai-image-op-btn）
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: img.x, y: img.y });
  await sleep(1500);
  const useBtn = await page.eval(`(() => {
    const btns = [...document.querySelectorAll('.ai-image-op-btn')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 10 && (e.innerText || '').trim() === '使用';
    });
    if (!btns.length) return null;
    const b = btns[0].getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), count: btns.length };
  })()`);
  if (!useBtn) throw new SkillError('PAGE_CHANGED', '找不到封面「使用」按钮', 'hover 图片后应出现 .ai-image-op-btn');

  // 点「使用」后可能弹「编辑封面」，再点「确认」；两种顺序都兜住
  let hasCover = false;
  for (let round = 0; round < 3 && !hasCover; round++) {
    if (round === 0) {
      const js = await page.clickJsByText('使用', { selector: '.ai-image-op-btn' });
      log(`JS 点「使用」: ${js.found ? 'ok' : '没找到'}`);
    } else {
      const again = await page.eval(`(() => {
        const b = [...document.querySelectorAll('.ai-image-op-btn')].filter((e) => (e.innerText || '').trim() === '使用')[0];
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })()`);
      if (again) await page.clickAt(again.x, again.y);
    }
    await sleep(2000);

    // 出现「编辑封面」就点确认。按钮可能是 button 也可能是 div/a，用文字找 + JS 点
    const cropDlg = await page
      .waitFor(`/编辑封面/.test(document.body.innerText)`, { timeout: 8000, interval: 700 })
      .catch(() => false);
    if (cropDlg) {
      log('进入「编辑封面」，点确认…');
      const hit = await page.eval(`(() => {
        const cands = [...document.querySelectorAll('button, a, div, span')].filter((e) => {
          const t = (e.innerText || '').trim();
          if (t !== '确认' && t !== '确定') return false;
          const r = e.getBoundingClientRect();
          return r.width > 20 && r.height > 16;
        });
        if (!cands.length) return null;
        cands.sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return ra.width * ra.height - rb.width * rb.height;
        });
        const el = cands[0];
        const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), count: cands.length };
      })()`);
      if (hit) {
        log(`确认按钮: ${hit.tag}.${hit.cls} (${hit.count} 个候选)`);
        await page.eval(`(() => {
          const cands = [...document.querySelectorAll('button, a, div, span')].filter((e) => {
            const t = (e.innerText || '').trim();
            if (t !== '确认' && t !== '确定') return false;
            const r = e.getBoundingClientRect();
            return r.width > 20 && r.height > 16;
          });
          cands.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height - rb.width * rb.height; });
          if (!cands.length) return false;
          const el = cands[0];
          const o = { bubbles: true, cancelable: true, view: window };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const E = t.startsWith('pointer') ? PointerEvent : MouseEvent;
            el.dispatchEvent(new E(t, o));
          }
          return true;
        })()`);
        await sleep(1200);
        if (await page.exists('.weui-desktop-dialog__wrp')) await page.clickAt(hit.x, hit.y);
      } else {
        log('没找到确认按钮（可能已自动确认）');
      }
      await sleep(2000);

      // 等「编辑封面」关掉，避免把弹窗里的预览误判成封面
      for (let i = 0; i < 10; i++) {
        const stillOpen = await page.eval(`/编辑封面/.test(document.body.innerText)`);
        if (!stillOpen) break;
        await sleep(1000);
      }
    }

    for (let i = 0; i < 8; i++) {
      hasCover = await coverApplied(page);
      if (hasCover) break;
      await sleep(1200);
    }
  }
  log(hasCover ? '封面已应用' : '⚠ 封面可能没应用');
  return Boolean(hasCover);
}

/** 封面是否已设置：微信用 background-image 渲染封面预览，且不能在「编辑封面」弹窗里的预览上误判 */
async function coverApplied(page) {
  return page.eval(`(() => {
    // 弹窗还开着就说明没确认完，直接算没设置
    if (/编辑封面/.test(document.body.innerText)) return false;
    const area = document.querySelector('.setting-group__cover');
    if (!area) return false;
    const prev = area.querySelector('.js_cover_preview_new') || area.querySelector('[class*="cover__preview"]');
    if (prev) {
      const bg = getComputedStyle(prev).backgroundImage || '';
      if (/url\\(/.test(bg) && !/data:image\\/svg/.test(bg)) return true;
    }
    const img = area.querySelector('img');
    if (img && (img.src || '').length > 10) return true;
    const none = document.querySelector('.js_share_type_none_image');
    if (none && getComputedStyle(none).display === 'none') return true;
    return false;
  })()`);
}

let coverDiagnosticSequence = 0;
/** Read only visible cover UI; never dump outerHTML, authenticated URLs, hidden state or credentials. */
export async function captureCoverFailure(page, firstBodySrc, {diagnosticDir, stage = 'body-cover-thumbnail'} = {}) {
  const result = {shot:null, diagnostic:null};
  try {
    const dir = diagnosticDir || artifactsDir('wechat');
    fs.mkdirSync(dir, {recursive:true});
    const base = path.join(dir, `cover-thumb-failed-${stamp()}-${process.pid}-${++coverDiagnosticSequence}`);
    const shot = base + '.png';
    try { await page.screenshot(shot); result.shot=shot; } catch {}
    const summary = await page.eval(`(() => {
      const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0;};
      const clean=s=>String(s||'').replace(/https?:\\/\\/[^\\s<>"']+/gi,'[URL]').replace(/\\b(token|key|tempkey|ticket|auth|access_token)\\s*[:=]\\s*[^\\s,;]+/gi,'$1=REDACTED').replace(/\\s+/g,' ').slice(0,300);
      const publicSrc=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&/^(?:mmbiz\\.qpic\\.cn|mmbiz\\.qlogo\\.cn|wx\\.qlogo\\.cn|res\\.wx\\.qq\\.com)$/i.test(u.hostname)?u.origin+u.pathname:'[non-public image URL withheld]';}catch{return '[unavailable]';}};
      const describe=el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,classes:clean(el.className),visible:visible(el),text:clean(el.innerText),rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}};};
      const media=el=>{const bg=getComputedStyle(el).backgroundImage||'';const raw=[...bg.matchAll(/url\\(["']?(.*?)["']?\\)/g)].map(m=>m[1]);if(el.tagName!=='IMG'&&!raw.length)return null;return {...describe(el),src:el.tagName==='IMG'?publicSrc(el.getAttribute('src')||el.src):null,backgroundImages:raw.map(publicSrc)};};
      const roots=[...document.querySelectorAll('[role="dialog"],[class*="dialog"],[class*="modal"],[class*="cover_select"],[class*="cover-select"]')].filter(visible);
      const dialogs=roots.slice(0,12).map(el=>({...describe(el),media:[...el.querySelectorAll('*')].slice(0,1500).filter(visible).map(media).filter(Boolean).slice(0,80)}));
      const fallbackMedia=[...document.querySelectorAll('img,[style]')].slice(0,4000).filter(el=>visible(el)&&!el.closest('div.ProseMirror')).map(media).filter(Boolean).slice(0,80);
      return {stage:${JSON.stringify(stage)},firstBodySrc:publicSrc(${JSON.stringify(firstBodySrc)}),dialogRootCount:roots.length,dialogs,visibleMediaOutsideEditor:fallbackMedia,limits:{dialogs:12,descendantsPerDialog:1500,mediaPerList:80},urlPolicy:'public WeChat CDN origin/path only; query/hash/userinfo omitted; other image URLs withheld'};
    })()`).catch(() => ({stage,captureError:'visible DOM summary unavailable'}));
    const diagnostic = base + '.json';
    fs.writeFileSync(diagnostic, JSON.stringify(summary,null,2), {encoding:'utf8',flag:'wx'});
    result.diagnostic=diagnostic;
  } catch { result.diagnosticCaptureFailed=true; }
  return result;
}

/** Explicitly requested cover: visible UI only; no AI fallback or hidden editor state. */
export async function selectCoverFromBody(page, {diagnosticDir, compareRenderedSources: compareSources, source: explicitSource, bodyIndex = 0} = {}) {
  const source = explicitSource || await page.eval(`(() => { const im=document.querySelectorAll('div.ProseMirror')[1]?.querySelector('img[src]'); return im && /^https:\\/\\//i.test(im.src) && im.complete && im.naturalWidth>0 ? im.src : null; })()`);
  if (!source) throw new SkillError('UPLOAD_FAILED', '从正文设置封面需要一张已上传且已加载的正文图片，停止保存');
  const fail = async (code, message, stage, proof) => {
    const diagnostic = await captureCoverFailure(page, source, {diagnosticDir, stage});
    throw Object.assign(new SkillError(code, message, '查看封面失败截图和安全DOM摘要；不得重复创建草稿或放宽图片身份匹配'), diagnostic, proof ? {coverVisualVerification:proof} : {});
  };
  const visible = `const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0;};`;
  const key = `const key=s=>{try{const u=new URL(s);return u.origin+u.pathname;}catch{return '';}};`;
  const dialogs = `const dialogs=[...document.querySelectorAll('.weui-desktop-dialog__wrp,.weui-desktop-dialog,[role="dialog"]')].filter(visible);`;
  const coverState = `const publicKey=src=>{try{const u=new URL(src),ref=new URL(${JSON.stringify(source)});return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname===ref.hostname&&/^(?:mmbiz\\.qpic\\.cn|mmbiz\\.qlogo\\.cn)$/.test(u.hostname)?u.origin+u.pathname:'';}catch{return '';}};const nodeKey=el=>{const urls=[...new Set([...el.querySelectorAll('img[src]')].filter(visible).map(im=>im.src))];const bg=(getComputedStyle(el).backgroundImage||'').trim();if(bg&&bg!=='none'){const matches=[...bg.matchAll(/url\\((["']?)(.*?)\\1\\)/g)];if(matches.length!==1||matches[0][0]!==bg)return '';urls.push(matches[0][2]);}const unique=[...new Set(urls.map(publicKey))];return unique.length===1?unique[0]:'';};const readCoverState=()=>{const previews=[...document.querySelectorAll('.setting-group__cover .js_cover_preview_new')].filter(visible),cards=[...document.querySelectorAll('.js_appmsg_thumb_new')].filter(visible);return {previewCount:previews.length,cardCount:cards.length,previewKeys:previews.map(nodeKey),cardKeys:cards.map(nodeKey)};};`;
  const beforeCover = await page.eval(`(() => { ${visible} ${coverState} return readCoverState(); })()`).catch(() => null);
  if (!beforeCover) await fail('PAGE_CHANGED', '无法读取选择前封面状态，停止保存', 'body-cover-before-preview');
  const trigger = await page.eval(`(() => { ${visible} const area=document.querySelector('.setting-group__cover'); if(!area)return null; area.scrollIntoView({block:'center'}); const el=[...area.querySelectorAll('.js_cover_btn_area,.js_chooseCover')].find(visible); if(!el)return null; const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  if (!trigger) throw new SkillError('PAGE_CHANGED', '找不到可见封面选择入口，停止保存');
  await page.clickAt(trigger.x, trigger.y);
  const menu = await page.waitFor(`(() => { ${visible} const items=[...document.querySelectorAll('.js_selectCoverFromContent')].filter(el=>visible(el)&&/从正文选择/.test(el.innerText||'')); if(items.length!==1)return null; const r=items[0].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`, {timeout:8000}).catch(() => null);
  if (!menu) throw new SkillError('PAGE_CHANGED', '「从正文选择」入口不可见或不唯一，停止保存');
  await page.clickAt(menu.x, menu.y);
  // Current UI evidence: picker thumbnails are SPAN.appmsg_content_img.cover with one CSS background URL.
  const thumb = await page.waitFor(`(() => { ${visible} ${key} ${dialogs} const candidates=[...new Set(dialogs.filter(d=>/下一步/.test(d.innerText||'')).flatMap(d=>[...d.querySelectorAll('img[src],span.appmsg_content_img.cover')]))].filter(el=>{if(!visible(el))return false;let src=el.src;if(el.tagName!=='IMG'){const bg=(getComputedStyle(el).backgroundImage||'').trim();const urls=[...bg.matchAll(/url\\((["']?)(.*?)\\1\\)/g)];if(urls.length!==1||urls[0][0]!==bg)return false;src=urls[0][2];}return key(src)===key(${JSON.stringify(source)});}); if(candidates.length!==1)return null; const r=candidates[0].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`, {timeout:10000}).catch(() => null);
  if (!thumb) await fail('PAGE_CHANGED', '正文首图在封面选择弹窗中缺失或不唯一，停止保存', 'body-cover-thumbnail');
  await page.clickAt(thumb.x, thumb.y);
  const button = async (labels) => {
    const hit = await page.waitFor(`(() => { ${visible} ${dialogs} const labels=${JSON.stringify(labels)};const candidates=[...new Set(dialogs.flatMap(d=>[...d.querySelectorAll('button,a,span,div[role="button"]')]))].filter(el=>visible(el)&&labels.includes((el.innerText||'').trim())&&!el.closest('[disabled],[aria-disabled="true"],[class*="disabled"]'));if(candidates.length!==1)return null;const r=candidates[0].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`, {timeout:10000}).catch(() => null);
    if (!hit) await fail('PAGE_CHANGED', `封面弹窗「${labels.join('/')}」不可用或不唯一，停止保存`, labels.includes('下一步') ? 'body-cover-next' : 'body-cover-confirm');
    await page.clickAt(hit.x, hit.y);
  };
  await button(['下一步']);
  const crop = await page.waitFor(`(() => { ${visible} ${dialogs} return dialogs.some(d=>/编辑封面/.test(d.innerText||'')); })()`, {timeout:10000}).catch(() => false);
  if (!crop) await fail('PAGE_CHANGED', '未出现「编辑封面」确认界面，停止保存', 'body-cover-crop');
  await button(['确认','确定']);
  const appliedCover = await page.waitFor(`(() => { ${visible} ${dialogs} ${coverState} if(dialogs.some(d=>/编辑封面|下一步/.test(d.innerText||'')))return false;const state=readCoverState();if(state.previewCount!==1||state.cardCount!==1||!state.previewKeys[0]||state.previewKeys[0]!==state.cardKeys[0])return false;return {...state,src:state.previewKeys[0]}; })()`, {timeout:15000}).catch(() => null);
  if (!appliedCover?.src || !await coverApplied(page).catch(() => false)) await fail('UPLOAD_FAILED', '未确认唯一封面预览和文章卡片来源一致，停止保存；不回退随机AI封面', 'body-cover-applied-preview');
  const reference = new URL(source);
  let coverVisualVerification = {verified:true,method:'exact-source',previewAndCardAgree:true};
  if (appliedCover.src !== reference.origin + reference.pathname) {
    if (beforeCover.previewKeys?.includes(appliedCover.src) || beforeCover.cardKeys?.includes(appliedCover.src)) await fail('UPLOAD_FAILED', '派生封面并非本次新应用的图片，停止保存', 'body-cover-stale-preview');
    // 微信裁切锚点不总是中心；同一张图按中心/顶部/底部各比一次，任一通过即确认来自该正文图。
    const compare = compareSources || (await import('./visual-proof.mjs')).compareRenderedSources;
    const dir = diagnosticDir || artifactsDir('wechat');
    let verified = null, best = null, lastError = null;
    for (const anchor of ['center', 'top', 'bottom']) {
      let proof;
      try {
        proof = await compare(page, source, appliedCover.src, {width:235,height:100,fit:'cover',objectPosition:anchor,prefix:path.join(dir,`cover-visual-proof-${stamp()}-${process.pid}-${anchor}`)});
      } catch (e) { lastError = e; continue; }
      if (!best || (proof.meanAbsoluteError ?? Infinity) < (best.meanAbsoluteError ?? Infinity)) best = proof;
      if (proof?.verified === true) { verified = proof; break; }
    }
    if (!verified && !best && lastError) await fail('UPLOAD_FAILED', '封面派生图视觉证明无法完成，停止保存', 'body-cover-visual-proof');
    if (!verified) await fail('UPLOAD_FAILED', '封面派生图未通过正文图视觉证明（已试中心/顶部/底部锚点），停止保存', 'body-cover-visual-proof', best);
    coverVisualVerification = {...verified,verified:true,method:'rendered-derived-image',previewAndCardAgree:true,newlyApplied:true};
  }
  log('封面已确认来自正文图');
  return {source: bodyIndex === 0 ? 'body-first-image' : 'body-image', bodyImageIndex: bodyIndex, coverVisualVerification};
}

/** 只点击「保存为草稿」，并等待点击后新出现的可见保存成功提示。 */
export async function saveDraft(page) {
  try {
    const clicked = await page.eval(`(() => {
      const state = window.__wechatDraftSave = { message: '' };
      const messages = () => new Map(
        [...document.querySelectorAll('div, span, p, [role="status"], [role="alert"]')]
          .map((el) => [el, (el.innerText || '').replace(/\\s+/g, '').replace(/[。！!]+$/, '')])
          .filter(([el, text]) => {
            if (!/^(已保存|保存成功|已保存为草稿|保存草稿成功|草稿保存成功|已保存到草稿箱|已保存至草稿箱)$/.test(text)) return false;
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
          })
      );
      // 记录点击前已有提示，避免把旧提示当成本次保存成功。
      let previous = messages();
      state.observer = new MutationObserver(() => {
        const current = messages();
        for (const [el, text] of current) {
          if (previous.get(el) !== text) {
            state.message = text;
            state.observer.disconnect();
            break;
          }
        }
        previous = current;
      });
      const candidates = [...document.querySelectorAll('button, a, div[role="button"], span')]
        .filter((el) => {
          if ((el.innerText || '').replace(/\\s+/g, '') !== '保存为草稿') return false;
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return r.width > 1 && r.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
        });
      candidates.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      });
      const el = candidates[0];
      if (!el) return { clicked: false, message: '找不到可见的「保存为草稿」按钮' };
      for (let parent = el; parent; parent = parent.parentElement) {
        if (parent.disabled || parent.getAttribute('aria-disabled') === 'true' || /disabled/i.test(String(parent.className || ''))) {
          return { clicked: false, message: '「保存为草稿」按钮处于禁用状态，请检查必填项和封面' };
        }
      }
      el.scrollIntoView({ block: 'center' });
      state.observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
      el.click();
      return { clicked: true };
    })()`);
    if (!clicked.clicked) throw new SkillError('PUBLISH_FAILED', clicked.message);
    const confirmed = await page.waitFor(`Boolean(window.__wechatDraftSave?.message)`, { timeout: 15000, interval: 200 });
    if (!confirmed) throw new SkillError('PUBLISH_FAILED', '已点击「保存为草稿」，但未读到新的保存成功提示');
    const message = await page.eval(`window.__wechatDraftSave.message`);
    log(`草稿保存已确认：${message}`);
    return message;
  } catch (e) {
    throw Object.assign(
      new SkillError('PUBLISH_FAILED', `草稿保存未确认：${e.message}`, '请查看保存前截图，并手动核对草稿箱；不要假定已保存，重试前先核对以免重复'),
      { savedAsDraft: false }
    );
  } finally {
    await page.eval(`(() => { window.__wechatDraftSave?.observer?.disconnect(); delete window.__wechatDraftSave; })()`).catch(() => {});
  }
}

export async function publish(job, options = {}) {
  // 自动重试只覆盖「还没点保存」的填写阶段；保存点击之后绝不重试，避免重复建草稿。
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await publishOnce(job, options);
      return attempt > 1 ? { ...result, attempts: attempt } : result;
    } catch (e) {
      const retryable = !e.savedAsDraft && !e.afterSaveClick && ['PAGE_CHANGED', 'UPLOAD_FAILED', 'BROWSER_FAILED'].includes(e.code);
      if (!retryable || attempt >= maxAttempts) throw e;
      log(`第 ${attempt} 次填写失败（${e.code}）：${e.message}；尚未点击保存，自动重试一次`);
      await sleep(2000);
    }
  }
}

/** 从正文图片里挑封面候选：显式 coverImage 优先，否则取最接近 21:9 的一张。 */
async function chooseBodyCover(page, job, uploaded) {
  const images = await page.eval(`(() => [...document.querySelectorAll('div.ProseMirror')[1].querySelectorAll('img[src]')].map((im,i)=>({i,src:im.src,w:im.naturalWidth,h:im.naturalHeight,ok:/^https:\\/\\//i.test(im.src)&&im.complete&&im.naturalWidth>0})))()`);
  const usable = (images || []).filter((x) => x.ok && x.w > 0 && x.h > 0);
  if (!usable.length) throw new SkillError('UPLOAD_FAILED', '正文没有已上传且已加载的图片，无法从正文设置封面');
  if (job.coverImage) {
    const base = job.jobFile ? path.dirname(job.jobFile) : process.cwd();
    const abs = localFile(job.coverImage, base, /\.(png|jpe?g|webp|gif|bmp)$/i, 'coverImage');
    const item = (job.inlineImages || []).find((im) => im.file === abs);
    const markup = item ? uploaded?.get(item.id) : null;
    const src = typeof markup === 'string' ? /<img\b[^>]*\bsrc="([^"]+)"/.exec(markup)?.[1] : null;
    const hit = src ? usable.find((u) => u.src === src) : null;
    if (!hit) throw new SkillError('USAGE', 'coverImage 必须是 inlineImages 中已上传且出现在正文的图片');
    return hit;
  }
  const score = (x) => Math.abs(x.w / x.h - 2.35);
  return [...usable].sort((a, b) => score(a) - score(b) || a.i - b.i)[0];
}

/** 保存后的自动核对：以完整标题在草稿箱里找，只作证据，不改变保存结论。 */
export async function verifyDraftInList(home, title) {
  if (!await home.exists('input[placeholder="输入标题/关键词"]')) {
    const hit = await home.clickJsByText('草稿箱', { selector: 'a, button, span, div, li' });
    if (!hit.found) throw new SkillError('PAGE_CHANGED', '找不到草稿箱入口，未能核对草稿列表');
  }
  const ready = await home.waitFor(`Boolean(document.querySelector('input[placeholder="输入标题/关键词"]'))`, { timeout: 15000 }).catch(() => false);
  if (!ready) throw new SkillError('PAGE_CHANGED', '草稿列表未就绪');
  const keyword = (title.match(/[A-Za-z][A-Za-z0-9-]{2,}/) || [])[0] || [...title].slice(0, 6).join('');
  await home.type('input[placeholder="输入标题/关键词"]', keyword);
  await home.pressEnter();
  await sleep(2500);
  const titles = await home.eval(`[...document.querySelectorAll('a.weui-desktop-publish__cover__title')].map(e=>(e.innerText||'').trim().replace(/\\u00a0/g,' '))`);
  const norm = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const matches = titles.filter((t) => norm(t) === norm(title)).length;
  const screenshot = await home.screenshot(path.join(artifactsDir('wechat'), `draft-list-${stamp()}.png`)).catch(() => null);
  return { matches, verified: matches === 1, keyword, screenshot, titles: titles.slice(0, 20) };
}

async function publishOnce(job, options = {}) {
  if (Object.hasOwn(options, 'submit') || job.submit) {
    throw Object.assign(new SkillError('USAGE', 'submit 已禁用：只保存草稿，绝不会发表'), { savedAsDraft: false });
  }
  // Validate all local HTML/assets before any browser or optional renderer is touched.
  job = { images: [], content: '', ...job, ...readWechatHtml(job) };
  await prepareGithubIntro(job);
  // 公众号内容一律要有封面：没有现成 21:9 首图时先本地出一张。
  await prepareWechatCover(job);
  const pre = preflight('wechat', job);
  if (pre.errors.length) throw new SkillError('USAGE', pre.errors.join('；'));
  const { port = 9335 } = options;
  const t0 = Date.now();
  const home = await ensureBrowser(port);
  let page;
  try {
  await requireLoggedIn(home);
  // Enter through visible UI; never extract or build authentication parameters.
  const existingIds = (await httpJson(`http://127.0.0.1:${port}/json/list`)).map(t => t.id);
  let hit;
  if (!await home.exists('input[placeholder="输入标题/关键词"]')) {
    hit = await home.clickJsByText('草稿箱', { selector: 'a, button, span, div, li' });
    if (!hit.found) throw new SkillError('PAGE_CHANGED', '找不到草稿箱入口');
  }
  await home.waitFor(`/新的创作/.test(document.body.innerText)`, {timeout:15000});
  hit = await home.clickJsByText('新的创作', { selector: 'button, a, div, span' });
  if (!hit.found) throw new SkillError('PAGE_CHANGED', '找不到新的创作按钮');
  await sleep(500);
  hit = await home.clickJsByText('文章', { selector: 'span, div, li, a' });
  if (!hit.found) throw new SkillError('PAGE_CHANGED', '找不到文章入口');
  await sleep(1800);
  for (let attempt = 0; attempt < 12 && !page; attempt++) {
    page = await Page.attachByUrl({ port, match: '/cgi-bin/appmsg', excludeIds: existingIds }).catch(() => null);
    if (!page && await home.eval(`document.querySelectorAll('div.ProseMirror').length >= 2`)) page = home;
    if (!page) await sleep(700);
  }
  if (!page) throw new SkillError('PAGE_CHANGED', '本次文章编辑器未就绪');
  await waitEditor(page);
  await dismissPromo(page);

  await fillTitle(page, job.title);
  const html = formatWechatHtml(job);
  await fillBody(page, html, { html: true });
  let legacyHtml = '';
  if (job.images && job.images.length) {
    await insertBodyImages(page, job.images);
    // Only reuse image DOM actually produced by the existing file uploader.
    legacyHtml=await page.eval(`[...document.querySelectorAll('div.ProseMirror')[1].querySelectorAll('img[src]')].map(im=>'<p>'+im.outerHTML+'</p>').join('')`);
    const imageCount = await page.eval("document.querySelectorAll('div.ProseMirror')[1].querySelectorAll('img[src]').length");
    if (imageCount !== job.images.length) throw new SkillError('UPLOAD_FAILED', '正文图片读回数量不匹配，停止保存');
  }
  const uploaded = await uploadInlineImages(page, job.inlineImages);
  const finalHtml = assembleWechatHtml(html, job.inlineImages, uploaded, legacyHtml);
  if (job.images.length || job.inlineImages.length) {
    await fillBody(page, finalHtml, {html:true});
    const imageCount = await page.eval("document.querySelectorAll('div.ProseMirror')[1].querySelectorAll('img[src]').length");
    if (imageCount !== job.images.length + job.inlineImages.length) throw new SkillError('UPLOAD_FAILED', '正文缺少预期配图，停止保存');
  }
  if (job.htmlFile) await verifyRichBody(page, finalHtml);
  await fillDigest(page, job.caption || job.content.slice(0, 100));

  let coverOk = false;
  let bodyCover;
  if (job.coverFromBody) {
    // 图片刚插入时可能还在解码；不等加载完就选封面会误判成「没有正文图」。
    const loaded = await page.waitFor(`(() => { const body=document.querySelectorAll('div.ProseMirror')[1]; if(!body) return false; const imgs=[...body.querySelectorAll('img[src]')]; return imgs.length>0 && imgs.every(im=>im.complete && im.naturalWidth>0); })()`, { timeout: 30000 }).catch(() => false);
    if (!loaded) throw new SkillError('UPLOAD_FAILED', '正文图片未加载完成，无法从正文设置封面；停止保存');
    // Explicit request must succeed or abort; never swallow errors or generate a random cover.
    const target = await chooseBodyCover(page, job, uploaded);
    bodyCover = await selectCoverFromBody(page, { source: target.src, bodyIndex: target.i });
    coverOk = true;
  } else {
    // 没有封面就不存草稿：空白封面的稿子必须人工补，等于没做完。
    for (let attempt = 1; attempt <= 2 && !coverOk; attempt++) {
      try {
        coverOk = await makeCover(page);
      } catch (e) {
        log(`第 ${attempt} 次自动封面失败: ${e.message}`);
        if (attempt === 2) throw new SkillError('UPLOAD_FAILED', `自动封面两次都失败：${e.message}`, '改用 coverFromBody 指定正文图作封面，或先确认编辑器封面入口可用', { coverFailed: true });
        await sleep(1500);
      }
    }
    if (!coverOk) throw new SkillError('UPLOAD_FAILED', '封面未应用，停止保存；空白封面草稿需要人工补', '改用 coverFromBody 指定正文图作封面');
  }

  // 读回校验：确认编辑器里到底是我们的内容，还是被草稿恢复/别的进程覆盖了
  const actual = await page.eval(`(() => {
    const pms = [...document.querySelectorAll('div.ProseMirror')];
    return {
      title: pms[0] ? (pms[0].innerText || '').trim().slice(0, 80) : '',
      body: pms[1] ? (pms[1].innerText || '').trim().slice(0, 120) : '',
      digest: (document.querySelector('textarea#js_description') || {}).value || '',
    };
  })()`);
  const expectedTitle = job.title.trim();
  const titleOk = actual.title.replace(/\s+/g, '') === expectedTitle.replace(/\s+/g, '');
  const bodyOk = /#AI/.test(actual.body) || actual.body.length > 20;
  if (!titleOk) log(`⚠ 标题对不上：期望「${expectedTitle}」，实际「${actual.title}」`);
  if (!bodyOk) log(`⚠ 正文对不上：期望开头「${job.content.trim().slice(0, 20)}」，实际「${actual.body}」`);
  if (!titleOk || !bodyOk) throw new SkillError('PAGE_CHANGED', '读回标题或正文不匹配，停止保存');

  if (job.htmlFile) await verifyRichBody(page, finalHtml);
  const shot = path.join(artifactsDir('wechat'), `before-save-${stamp()}.png`);
  await page.screenshot(shot).catch(() => {});
  log(`预览截图: ${shot}`);

  let confirmation;
  try {
    confirmation = await saveDraft(page);
  } catch (e) {
    e.shot = shot;
    e.afterSaveClick = true;
    throw e;
  }

  const savedScreenshot = path.join(artifactsDir('wechat'), `saved-draft-${stamp()}.png`);
  await page.screenshot(savedScreenshot).catch(() => {});

  // 保存后的列表核对只作附加证据；列表选择器变化不影响已确认的保存结果。
  let draftListCheck;
  try {
    draftListCheck = await verifyDraftInList(home, job.title);
    if (draftListCheck.matches > 1) log(`⚠ 草稿箱有 ${draftListCheck.matches} 篇同名草稿，请人工确认是否重复`);
  } catch (e) {
    draftListCheck = { verified: false, matches: null, error: e.message };
  }

  return {
    ok: true,
    platform: 'wechat',
    submitted: false,
    savedAsDraft: true,
    draftVerified: draftListCheck.verified === true,
    draftListCheck,
    coverOk,
    ...(bodyCover ? {coverSource:bodyCover.source, coverBodyImageIndex:bodyCover.bodyImageIndex, coverVisualVerification:bodyCover.coverVisualVerification} : {}),
    ...(job.htmlFile ? {htmlFile:job.htmlFile, inlineImageIds:job.inlineImages.map(im=>im.id), bodyImageCount:job.images.length + job.inlineImages.length, richBodyVerified:true} : {}),
    ...(job.githubIntroResult ? {githubIntro:job.githubIntroResult} : {}),
    url: (await page.url()).split(/[?#]/)[0],
    screenshot: shot,
    savedScreenshot,
    confirmation,
    elapsedMs: Date.now() - t0,
  };
  } finally {
    if (page && page !== home) await page.dispose({closeOwned:true});
    await home.dispose({closeOwned:true});
  }
}
