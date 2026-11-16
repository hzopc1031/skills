import { prepareGithubIntro } from './github-intro.mjs';
import { assertPromotionReady } from './promotion-preflight.mjs';
import { promotionInput } from './promotion-context.mjs';
import {prepareOverflow} from './overflow.mjs';
// 小红书发布流程：登录态检查 → 打开图文发布页 → 传图 → 填标题正文 → 发布
import path from 'node:path';
import fs from 'node:fs';
import { launch, Page, verifyBrowserProfile } from './cdp.mjs';
import { sleep, log, SkillError, profileDir, artifactsDir, stamp, preflight, charLen, titleLen } from './util.mjs';

export const XHS = {
  home: 'https://creator.xiaohongshu.com/new/home',
  publish: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=image',
  longform: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=article',
  noteManager: 'https://creator.xiaohongshu.com/new/note-manager',
};

// 选择器候选：新版/旧版页面差异大，按顺序试
const SEL = {
  fileInput: 'input[type="file"]',
  title: ['input[placeholder*="标题"]', 'input[placeholder*="填写标题"]', '.title-input input', 'input.d-max'],
  body: ['div[contenteditable="true"]', '[contenteditable="true"]', '.ql-editor', '.post-content'],
};

async function pickSelector(page, list) {
  for (const s of list) {
    if (await page.exists(s)) return s;
  }
  return null;
}

export async function ensureBrowser(account) {
  const { port } = account;
  const profile = profileDir(account);
  await launch({ port, profile, startUrl: XHS.home, proxy: account.proxy || 'direct' });
  const page = await Page.open({ port });
  page.account = account;
  // 在连接后再次确认，任何页面导航/填写之前失败关闭。
  await verifyBrowserProfile(port, profile);
  return page;
}

/** 只读首页可见 DOM。选择器于 2026-11-10 实测；不访问存储、凭据或页面内部状态。 */
function visibleHomeIdentity() {
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const text = document.body?.innerText || '';
  const names = [...document.querySelectorAll('.account-name, .user-info .name-box')]
    .filter(visible).map((el) => el.innerText.trim()).filter(Boolean);
  const nicknames = [...new Set(names)];
  const redIds = [...new Set([...text.matchAll(/小红书(?:账号|号)\s*[:：]\s*([^\s]+)/g)].map((m) => m[1]))];
  const loginPage = /login|passport|captcha/i.test(location.href) || /扫码登录|登录后查看|手机号登录|密码登录|验证码登录/.test(text);
  const home = location.origin === 'https://creator.xiaohongshu.com' && location.pathname === '/new/home';
  return {
    loggedIn: !loginPage && home && (nicknames.length > 0 || /笔记管理|数据看板/.test(text)),
    nickname: nicknames.length === 1 ? nicknames[0] : null,
    redId: redIds.length === 1 ? redIds[0] : null,
    nicknames,
    loginPage,
    url: location.href,
  };
}

export async function homeIdentity(page) {
  await page.goto(XHS.home, { timeout: 60000 });
  const started = Date.now();
  let identity;
  do {
    identity = await page.eval(`(${visibleHomeIdentity.toString()})()`);
    if (Date.now() - started >= 1500 && (identity.loginPage || identity.nickname)) break;
    await sleep(500);
  } while (Date.now() - started < 15000);
  return identity;
}

export async function assertAccount(page, account) {
  const actual = await homeIdentity(page);
  if (!actual.loggedIn) throw new SkillError('LOGIN_REQUIRED', `账户 ${account.alias} 未登录或登录已失效`, `请用户自行运行 login --account ${account.alias}`);
  const expectedNickname = account.expectedNickname?.trim() || null;
  const expectedRedId = account.expectedRedId?.trim() || null;
  if (!expectedNickname || actual.nickname !== expectedNickname || (expectedRedId && actual.redId !== expectedRedId)) {
    throw new SkillError('ACCOUNT_MISMATCH',
      `账户 ${account.alias} 校验失败（阶段: account-check，尚未打开发布页）：期望昵称 ${JSON.stringify(expectedNickname)}，实际昵称 ${JSON.stringify(actual.nickname)}；期望小红书号 ${JSON.stringify(expectedRedId)}，实际小红书号 ${JSON.stringify(actual.redId)}`,
      '检查 accounts.json 的期望身份与该 profile 当前登录账户；不要继续填写或发布');
  }
  return actual;
}

export async function isLoggedIn(page) {
  const url = await page.url();
  if (/login|passport|captcha/i.test(url)) return false;
  const text = await page.text();
  if (/扫码登录|登录后查看|手机号登录|密码登录/.test(text)) return false;
  return true;
}

export async function gotoPublish(page, { textOnly = false } = {}) {
  log(textOnly ? '打开发布页（纯文字/长文）…' : '打开图文发布页…');
  await page.goto(XHS.publish, { timeout: 60000 });
  await sleep(2500);

  // 需要登录时页面会跳走
  if (!(await isLoggedIn(page))) {
    throw new SkillError('LOGIN_REQUIRED', '小红书未登录或登录已失效', '请用户运行 `node scripts/xhs.mjs login --account <别名>` 后用小红书 App 扫码');
  }

  // 顶部有 tab 就切到目标 tab
  const tab = textOnly ? '写长文' : '上传图文';
  const text = await page.text();
  if (/上传视频|上传图文|写长文/.test(text)) {
    try {
      await page.clickText(tab, { selector: 'div, span, li, button' });
      await sleep(2000);
      log(`已切到「${tab}」`);
    } catch (e) {
      log(`切换「${tab}」失败，按当前页面继续: ${e.message}`);
    }
  }

  if (textOnly) {
    // 长文编辑器：等可编辑区出现
    const ok = await page
      .waitFor("!!document.querySelector('[contenteditable=\"true\"], textarea')", { timeout: 20000, interval: 500 })
      .catch(() => false);
    if (!ok) {
      throw new SkillError('PAGE_CHANGED', '长文编辑器没出现', '跑 `node scripts/xhs.mjs inspect --account <别名>` 看当前页面结构');
    }
    return;
  }

  if (!(await page.exists(SEL.fileInput))) {
    throw new SkillError('PAGE_CHANGED', '发布页上找不到图片上传输入框', '跑 `node scripts/xhs.mjs inspect --account <别名>` 把结构 dump 出来再调选择器');
  }
}

export async function uploadImages(page, images, { timeout = 120000 } = {}) {
  log(`上传 ${images.length} 张图片…`);
  await page.upload(SEL.fileInput, images);
  // 等缩略图出现：图片数达到预期且没有「上传中」提示
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeout) {
    const state = await page.eval(`(() => {
      const text = document.body.innerText || '';
      const uploading = /上传中|正在上传|处理中/.test(text);
      const imgs = [...document.querySelectorAll('img')].filter((i) => i.getBoundingClientRect().width > 40).length;
      const files = document.querySelectorAll('input[type="file"]').length;
      const count = text.match(/图片编辑\\s*(\\d+)\\s*\\/\\s*18/);
      return { uploading, imgs, files, uploaded:count?Number(count[1]):null, head: text.replace(/\\s+/g, ' ').slice(0, 200) };
    })()`);
    last = state.head;
    if (!state.uploading && state.uploaded === images.length) {
      await sleep(1200);
      log(`图片就绪（表单确认 ${state.uploaded}/18 张）`);
      return true;
    }
    await sleep(1000);
  }
  throw new SkillError('UPLOAD_FAILED', '图片上传超时', `页面状态: ${last}`);
}

export async function fillTitle(page, title) {
  const sel = await pickSelector(page, SEL.title);
  if (!sel) throw new SkillError('PAGE_CHANGED', '找不到标题输入框');
  log(`填标题（发布页计数${titleLen(title)}字，原始${[...title].length}字符）`);
  await page.type(sel, title);
  await sleep(300);
  // Some builds ignore synthetic clicks on the title input; fall back to a native value set + input event.
  const typed = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? (el.value || '') : ''; })()`);
  if (!String(typed).trim()) {
    await page.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify('')} + ${JSON.stringify(title)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
  }
  const actual = await page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    if (typeof el.value === 'string') return el.value;
    return (el.innerText || el.textContent || '').trim();
  })()`);
  const expected = String(title).trim();
  const got = String(actual == null ? '' : actual).trim();
  if (got !== expected) {
    let diag = 'n/a';
    try {
      diag = await page.eval(`(() => {
        const list = ${JSON.stringify(SEL.title)};
        return list.map((s) => {
          const el = document.querySelector(s);
          if (!el) return s + ' | missing';
          const r = el.getBoundingClientRect();
          return s + ' | <' + el.tagName.toLowerCase() + '> type=' + (el.type || '-') + ' ph=' + (el.placeholder || '-') + ' val=' + JSON.stringify((el.value || '').slice(0, 20)) + ' ce=' + el.isContentEditable + ' rect=' + Math.round(r.width) + 'x' + Math.round(r.height);
        }).join(' ;; ');
      })()`);
    } catch {}
    throw new SkillError('PAGE_CHANGED', '页面标题与完整目标标题不一致，停止', `期望 ${expected.length} 字符，页面 ${got.length} 字符: ${got.slice(0, 60)} || ${diag}`);
  }
}

/** 焦点移到正文末尾 */
async function focusBodyEnd(page, bodySelector) {
  await page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(bodySelector)});
    if (!el) return false;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return true;
  })()`);
}

/**
 * 按真实话题插入：先输入 # 再输入关键词，从联想下拉里点选（或在下拉出现后回车）。
 * 把「#AI」随正文一起粘贴只会变成纯文本，不会生成可点话题。
 */
export async function insertOfficialTopics(page, bodySelector, topics = []) {
  const inserted = [];
  for (const raw of topics) {
    const name = String(raw).replace(/^#/, '').trim();
    await focusBodyEnd(page, bodySelector);
    await page.cdp.send('Input.insertText', { text: '\n' });
    let picked;
    for(let attempt=0;attempt<2&&!picked;attempt++) {
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '#', code: 'Digit3', text: '#' });
      await page.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '#', code: 'Digit3' });
      await sleep(300);
      await page.cdp.send('Input.insertText', { text: name });
      const start=Date.now();
      while(Date.now()-start<8000) {
        const hit=await page.eval('(' + ((want) => {
          const nodes=[...document.querySelectorAll('#creator-editor-topic-container .item .name, .items .item .name')];
          const hit=nodes.find(n=>{
            const r=n.getBoundingClientRect(); const row=n.closest('.item');
            return r.width>0&&r.height>0&&!n.closest('[contenteditable]')&&!/新建|创建/.test(row.innerText)&&n.innerText.trim().replace(/^#/,'').toLowerCase()===want.toLowerCase();
          });
          if(!hit) return null;
          hit.scrollIntoView({block:'nearest'});const r=hit.getBoundingClientRect();
          return {label:hit.innerText.trim(),x:r.x+r.width/2,y:r.y+r.height/2};
        }).toString()+')('+JSON.stringify(name)+')');
        if(hit) {await page.clickAt(hit.x,hit.y);picked=hit.label;break;}
        await sleep(350);
      }
      if(!picked && attempt===0) {
        // 只删除仍在编辑器里的查询串，保留正文及此前插入的正式话题。
        const selected=await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(bodySelector)});const n=[...e.querySelectorAll('.suggestion')].find(n=>n.textContent===${JSON.stringify('#'+name)});if(!n)return false;const r=document.createRange();r.selectNodeContents(n);const s=getSelection();s.removeAllRanges();s.addRange(r);e.focus();return true})()`);
        if(!selected) break;
        await page.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
        await page.cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
        await page.pressEscape();await focusBodyEnd(page,bodySelector);
      }
    }
    if (!picked) {
      const e=new SkillError('PAGE_CHANGED','未找到已存在的正式话题 #'+name,'已轮询8秒并在可安全删除查询串时重输一次；保留失败瞬间候选截图，不重试发布');
      await captureFailure(page,e,'topic-candidates');throw e;
    }
    await sleep(500);
    await verifyTopicsHighlighted(page, [name]);
    inserted.push({ name, picked, via: 'dropdown' });
    log('正式话题已选择：' + picked);
  }
  return inserted;
}

async function captureFailure(page,e,prefix='failed') {
  const base=path.join(artifactsDir(page.account),prefix+'-'+stamp());
  e.shot=await page.screenshot(base+'.png').catch(()=>null);
  const data=await page.inspect().catch(()=>({}));
  data.candidates=await page.eval(`[...document.querySelectorAll('#creator-editor-topic-container .item')].map(n=>({text:n.innerText,visible:!!n.getBoundingClientRect().width}))`).catch(()=>[]);
  e.inspect=base+'.json';fs.writeFileSync(e.inspect,JSON.stringify(data,null,2),'utf8');
}

/** Require an actual topic entity inside the editor and its highlighted preview. */
export async function verifyTopicsHighlighted(page, topics = []) {
  const details = await page.eval('(' + ((wanted) => {
    const entities = [...document.querySelectorAll('[contenteditable="true"] a[data-topic]')];
    return wanted.map(want => {
      const node = entities.find(n => {
        try { const data = JSON.parse(n.getAttribute('data-topic')); return data.id && data.id !== 'newTopic_Id' && data.name.toLowerCase() === want.toLowerCase(); } catch { return false; }
      });
      if (!node) return { name: want, highlighted: false };
      const data = JSON.parse(node.getAttribute('data-topic'));
      const color = getComputedStyle(node).color;
      const previews = [...document.querySelectorAll('a[data-topic], .tiptap-topic')].filter(n => !n.closest('[contenteditable="true"]'));
      const preview=previews.find(n=>{try {const d=JSON.parse(n.getAttribute('data-topic'));return d.id===data.id&&d.name.toLowerCase()===want.toLowerCase();}catch{return false;}});
      const previewColor=preview?getComputedStyle(preview).color:null;
      return { name: want, canonical: data.name, id: data.id, color, highlighted: !!color && color !== 'rgb(0, 0, 0)' && color !== 'rgb(51, 51, 51)', previewEntities: previews.length,previewHighlighted:!!previewColor&&previewColor!=='rgb(0, 0, 0)'&&previewColor!=='rgb(51, 51, 51)',previewColor };
    });
  }).toString() + ')(' + JSON.stringify(topics.map(t => String(t).replace(/^#/, ''))) + ')');
  if (details.some(d => !d.highlighted || !d.previewHighlighted)) {
    const e=new SkillError('PAGE_CHANGED','正式话题实体或高亮核验失败: '+JSON.stringify(details));
    await captureFailure(page,e,'topic-verification');throw e;
  }
  log('已核对编辑区正式话题实体和高亮: ' + JSON.stringify(details));
  return { ok: true, details };
}

export async function fillBody(page, content, topics = []) {
  const sel = await pickSelector(page, SEL.body);
  if (!sel) throw new SkillError('PAGE_CHANGED', '找不到正文编辑区');
  log('填正文…');
  await page.type(sel, content);
  await sleep(400);
  // Fallback: the editor may ignore synthetic typing; try a synthetic paste when the text is short.
  const norm = (s) => String(s || '').replace(/\s/g, '');
  const filledNow = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? (el.textContent || '') : ''; })()`);
  if (norm(filledNow) !== norm(content)) {
    await page.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return false;
      el.focus();
      el.innerHTML = '';
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify('')} + ${JSON.stringify(content)});
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await sleep(800);
  }
  let verification = { ok: true, details: [] };
  if (Array.isArray(topics) && topics.length) {
    try {
      await insertOfficialTopics(page, sel, topics);
      verification = await verifyTopicsHighlighted(page, topics);
    } catch (e) {
      // 平台话题下拉会变；插不进去时不要拖垮整篇发布，正文已经填好了。
      log(`话题插入失败，跳过话题继续：${e.message}`);
      verification = { ok: false, skipped: true, error: e.message };
    }
  }
  await page.pressEscape();
  return verification;
}

const SIDEBAR_PUBLISH = /发布笔记|上传图文|上传视频|写长文|发播客/;
const PUBLISH_TIMEOUT_MS = 120000;

/** 只点表单底部的「发布 / 立即发布」，绝不能点侧栏「发布笔记」。 */
export async function submit(page) {
  log('点发布…（只点表单「发布」，避开侧栏「发布笔记」）');
  await dismissTips(page, 2);
  const candidates = [];

  const pushAx = async (name) => {
    try {
      const hits = await page.axFind(name, { role: 'button', exact: true });
      for (const h of hits) {
        if (h.disabled || SIDEBAR_PUBLISH.test(h.name || '')) continue;
        if (h.name !== '发布' && h.name !== '立即发布') continue;
        const box = await page.cdp.send('DOM.getBoxModel', { backendNodeId: h.backendDOMNodeId });
        const q = box.model.border;
        const x = Math.round((q[0] + q[4]) / 2);
        const y = Math.round((q[1] + q[5]) / 2);
        candidates.push({ name: h.name, x, y, via: 'ax' });
      }
    } catch (e) {
      log(`AX 查找「${name}」失败: ${e.message}`);
    }
  };
  await pushAx('立即发布');
  await pushAx('发布');

  if (!candidates.length) {
    for (const name of ['立即发布', '发布']) {
      const hit = await page.findByText(name, { selector: 'button, div[role="button"], span' }).catch(() => null);
      if (hit && !hit.disabled && !SIDEBAR_PUBLISH.test(hit.text || '')) {
        candidates.push({ name: hit.text || name, x: hit.x, y: hit.y, via: 'dom' });
      }
    }
  }
  if (!candidates.length) {
    throw new SkillError('PUBLISH_FAILED', '找不到表单「发布」按钮', '已避开侧栏「发布笔记」；页面结构可能变了，跑 inspect');
  }
  candidates.sort((a, b) => b.y - a.y);
  const hit = candidates[0];
  log(`点击发布按钮 via=${hit.via} name=${hit.name} @(${hit.x},${hit.y})`);
  try {
    const dump = await page.eval(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, [role="button"], div, span')) {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 20) continue;
        const txt = (el.innerText || '').trim();
        if (!/发布/.test(txt) || txt.length > 30) continue;
        out.push({ tag: el.tagName.toLowerCase(), txt, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'), cls: String(el.className || '').slice(0, 60) });
      }
      return out;
    })()`);
    fs.writeFileSync(path.join(artifactsDir(page.account), `submit-buttons-${stamp()}.json`), JSON.stringify(dump, null, 2), 'utf8');
    await page.screenshot(path.join(artifactsDir(page.account), `submit-before-${stamp()}.png`)).catch(() => {});
  } catch {}
  await page.clickAt(hit.x, hit.y);
  await sleep(800);
  const confirmed = await confirmPublishDialog(page);
  try {
    await page.screenshot(path.join(artifactsDir(page.account), `submit-after-${stamp()}.png`)).catch(() => {});
  } catch {}
  log(`确认弹窗=${confirmed}`);
  return hit;
}

async function confirmPublishDialog(page) {
  await dismissTips(page, 2);
  for (const label of ['确认发布', '继续发布', '仍然发布', '确认', '确定']) {
    try {
      const hits = await page.axFind(label, { role: 'button', exact: true });
      if (hits.length && !hits[0].disabled) {
        log(`发现确认弹窗「${label}」，点击`);
        await page.clickByAx(label, { role: 'button', exact: true });
        await sleep(600);
        return true;
      }
    } catch {}
    const t = await page.findByText(label, { selector: 'button, div[role="button"]' }).catch(() => null);
    if (t && !t.disabled) {
      log(`发现确认弹窗「${label}」，点击`);
      await page.clickAt(t.x, t.y);
      await sleep(600);
      return true;
    }
  }
  return false;
}

function titleMatches(haystack, title) {
  const want = String(title || '').trim();
  if (!want) return false;
  return String(haystack || '').includes(want);
}

/** 到笔记管理「全部」和「审核中」按完整标题核验，不点发布、不打开编辑。 */
export async function findPublishedOrReviewing(page, title, { account, date } = {}) {
  const want = String(title || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new SkillError('USAGE', '查重日期必须为 YYYY-MM-DD');
  const matches = (text) => {
    if (!date) return titleMatches(text, want);
    const lines = String(text || '').split('\n').map(s => s.trim());
    return lines.some((line, i) => {
      if (line !== want) return false;
      const timestamp = lines.slice(i + 1, i + 5).find(s => /^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(s));
      if (!timestamp) throw new SkillError('PAGE_CHANGED', '同名笔记未读到发布日期，停止以免重复发布');
      return timestamp.slice(0, 10) === date;
    });
  };
  log(`核验笔记管理/审核中是否已有标题「${want}」`);
  await page.goto(XHS.noteManager, { timeout: 60000 });
  await sleep(2500);
  await dismissTips(page, 2);

  const scrollAll = async () => {
    for (let i = 0; i < 4; i++) {
      await page.eval(`(() => { const el = document.scrollingElement || document.documentElement; el.scrollTo(0, el.scrollHeight); return el.scrollHeight; })()`).catch(() => 0);
      await sleep(600);
    }
  };

  if(!(await clickTab('全部'))) throw new SkillError('PAGE_CHANGED','笔记管理未找到全部标签，停止查重');
  await sleep(800);
  await scrollAll();
  const allText = await page.eval(`document.body.innerText || ''`);
  let shotAll = null;
  if (account) {
    shotAll = path.join(artifactsDir(account), `notes-all-${stamp()}.png`);
    await page.screenshot(shotAll).catch(() => {});
  }

  async function clickTab(name) {
    const tab = await page.eval(`(() => {
      const name = ${JSON.stringify(name)};
      const nodes = [...document.querySelectorAll('button, span, div')].filter(n => {
        const r = n.getBoundingClientRect();
        const t=(n.innerText||'').trim();
        return (t===name||(name==='全部'&&/^全部\\s*\\d+$/.test(t))) && r.width > 1 && r.height > 1 && r.top >= 0 && r.top < 180;
      }).sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      if (!nodes.length) return false;
      nodes[0].click(); return true;
    })()`);
    if (tab) return true;
    try {
      await page.clickByAx(name, { exact: true });
      return true;
    } catch {}
    const hit = await page.findByText(name, { selector: 'button, div[role="tab"], div[role="button"], span, div' }).catch(() => null);
    if (hit) {
      await page.clickAt(hit.x, hit.y);
      return true;
    }
    return false;
  }

  if(!(await clickTab('审核中'))) throw new SkillError('PAGE_CHANGED','笔记管理未找到审核中标签，停止查重');
  await sleep(1500);
  await scrollAll();
  const reviewText = await page.eval(`document.body.innerText || ''`);
  let shotReview = null;
  if (account) {
    shotReview = path.join(artifactsDir(account), `notes-reviewing-${stamp()}.png`);
    await page.screenshot(shotReview).catch(() => {});
  }

  const inReview = matches(reviewText) && !/没有找到相关笔记/.test(reviewText);
  const inAll = matches(allText);
  const found = inReview || inAll;

  let noteUrl = null;
  if (found) {
    noteUrl = await page.eval(`(() => {
      const want = ${JSON.stringify(want)};
      const anchors = [...document.querySelectorAll('a[href]')];
      for (const a of anchors) {
        const t = (a.innerText || a.getAttribute('title') || '').trim();
        const href = a.href || '';
        if (t.includes(want) && /xiaohongshu\\.com|xhscdn|explore|discovery|notification/.test(href)) return href;
      }
      const cards = [...document.querySelectorAll('a[href], div, span')];
      for (const n of cards) {
        const t = (n.innerText || '').trim();
        if (!t.includes(want)) continue;
        const a = n.closest?.('a') || n.querySelector?.('a[href]');
        if (a && a.href) return a.href;
      }
      return null;
    })()`).catch(() => null);
  }

  const status = inReview ? '审核中' : (inAll ? '笔记管理-全部' : null);
  log(found
    ? `找到同名笔记：位置=${status}${noteUrl ? ' url=' + noteUrl : '（页面未给出链接）'}`
    : '笔记管理/审核中未见该完整标题');
  return {
    found,
    inReview,
    inManager: inAll,
    status,
    title: want,
    date: date || null,
    url: noteUrl,
    screenshots: { all: shotAll, reviewing: shotReview },
  };
}

export async function waitPublished(page, { timeout = PUBLISH_TIMEOUT_MS, title, account, date } = {}) {
  const t0 = Date.now();
  let sawEmptyForm = false;
  while (Date.now() - t0 < timeout) {
    const s = await page.eval(`(() => {
      const text = document.body.innerText || '';
      const url = location.href;
      const toast = /发布成功|笔记已提交|提交成功|正在审核|进入审核|发布完成|已进入审核|提交审核成功/.test(text);
      const urlOk = /\\/(explore|discovery|notification)\\b|note-manager|published=|publish\\/success/i.test(url);
      const emptyForm = /上传视频/.test(text) && /草稿箱/.test(text) && /拖拽视频到此或点击上传/.test(text);
      const error = (() => { const m = text.match(/(发布失败|图片格式|内容包含|请上传|标题不能|正文不能)[^\\n]{0,60}/); return m ? m[0] : ''; })();
      return { url, toast, urlOk, emptyForm, error };
    })()`);
    if (s.error) throw new SkillError('PUBLISH_FAILED', `平台报错: ${s.error}`);
    if (s.toast || s.urlOk) return { success: true, url: s.url, via: s.toast ? 'toast' : 'url' };
    if (s.emptyForm && Date.now() - t0 > 8000) {
      log('页面已回到空白发布入口，改为到笔记管理核验');
      sawEmptyForm = true;
      break;
    }
    await sleep(1500);
  }
  if (title) {
    const v = await findPublishedOrReviewing(page, title, { account, date });
    if (v.found) {
      return { success: true, url: v.url || await page.url(), via: 'note-manager', verification: v };
    }
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  throw new SkillError(
    'PUBLISH_FAILED',
    `等待发布结果超时（${secs}s）${sawEmptyForm ? '，页面已回到空白发布入口' : ''}，笔记管理/审核中也未找到该标题`,
    '看截图；可能按钮未点上、有未处理弹窗，或平台仍在处理。不要盲目重发，先核验笔记管理。',
  );
}

/** 图文流程：上传图片 → 标题 → 正文 → 发布 */
export async function publishImage(job, { account, submit: doSubmit = false } = {}) {
  const promotionPreflight = assertPromotionReady(job, { kind:'post', phase:'final' });
  doSubmit = doSubmit && !job.submitDisabled && (promotionInput(job) ? promotionInput(job).original.submit !== false : job.submit !== false);
  const t0 = Date.now();
  const pre = preflight('xhs', job);
  for (const w of pre.warnings) log(`⚠ ${w}`);
  if (pre.errors.length) throw new SkillError('USAGE', '内容不符合小红书规范:\n  ' + pre.errors.join('\n  '));

  const page = await ensureBrowser(account);
  await assertAccount(page, account);
  if (doSubmit) {
    const checks=[];
    for(const title of [job.title,...(job.duplicateTitles??[])]) {const v=await findPublishedOrReviewing(page,title,{account,date:job.date});checks.push(v);if(v.found)break;}
    const existing = checks.find(v=>v.found)??checks[0];
    if (existing.found) {
      log('发现同标题已发布或审核中的笔记，跳过本次提交以免重复');
      return {
        ok: true,
        platform: 'xiaohongshu', promotionPreflight,
        mode: 'image',
        submitted: false,
        alreadyPublished: true,
        dryRun: false,
        url: existing.url,
        verification: existing,
        elapsedMs: Date.now() - t0,
        note: '发布前核验：笔记管理或审核中已有同标题笔记，未再次提交',
        ...titleMeta(job),
      };
    }
  }
  await gotoPublish(page, { textOnly: false });
  await uploadImages(page, job.images);
  await fillTitle(page, job.title);
  const topicVerification=await fillBody(page, job.content, job.topics);
  // The body paste can land in the title field; restore the exact title before verifying.
  try {
    await page.eval(`(() => {
      const el = document.querySelector('input[placeholder*="标题"], textarea[placeholder*="标题"]');
      if (!el) return false;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(job.title)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
  } catch {}
  const bodyActual=await page.eval(`(()=>{const el=document.querySelector('div.ProseMirror').cloneNode(true);el.querySelectorAll('a[data-topic]').forEach(n=>n.remove());return el.textContent})()`);
  if(bodyActual.replace(/\s/g,'')!==job.content.replace(/\s/g,'')) throw new SkillError('PAGE_CHANGED','正文被截断或与完整任务正文不符');
  job.topicVerification=topicVerification;

  const shot = path.join(artifactsDir(account), `before-submit-${stamp()}.png`);
  await page.screenshot(shot);
  log(`预览截图: ${shot}`);

  if (!doSubmit) {
    return {
      ok: true,
      platform: 'xiaohongshu', promotionPreflight,
      submitted: false,
      dryRun: true,
      url: await page.url(),
      screenshot: shot,
      elapsedMs: Date.now() - t0,
      note: '内容已填好但未点发布；用户确认后需移除 job.submit:false 或改为 true，才可通过 --submit 提交',
    };
  }

  await submit(page);
  let result;
  try {
    result = await waitPublished(page, { title: job.title, account, date: job.date });
  } catch (e) {
    const errShot = path.join(artifactsDir(account), `failed-${stamp()}.png`);
    await page.screenshot(errShot).catch(() => {});
    e.shot = errShot;
    throw e;
  }
  const doneShot = path.join(artifactsDir(account), `published-${stamp()}.png`);
  await page.screenshot(doneShot).catch(() => {});
  return {
    ok: true,
    platform: 'xiaohongshu', promotionPreflight,
    mode: 'image',
    submitted: true,
    alreadyPublished: false,
    dryRun: false,
    url: result.url,
    screenshot: doneShot,
    elapsedMs: Date.now() - t0,
    verification: result.verification || null,
    via: result.via || null,
    ...titleMeta(job),
  };
}

// ---------- 纯文字（写长文）流程 ----------
// 小红书网页端发纯文字走「写长文」：填标题正文 → 一键排版（平台生成文字卡片）
// → 下一步 → 发布表单 → 发布。

const LF = {
  title: 'textarea[placeholder="输入标题"]',
  body: 'div.ProseMirror',
  postTitle: 'input[placeholder*="填写标题"]',
};

/** 关掉平台的新手引导弹窗（「我知道了」） */
export async function dismissTips(page, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    const hit = await page.findByText('我知道了', { selector: 'button, div, span' }).catch(() => null);
    if (!hit) {
      const alt = await page.findByText('知道了', { selector: 'button, div, span' }).catch(() => null);
      if (!alt) return i > 0;
      await page.clickAt(alt.x, alt.y);
      await sleep(800);
      continue;
    }
    await page.clickAt(hit.x, hit.y);
    await sleep(800);
  }
  return true;
}

async function openLongformEditor(page) {
  log('打开发布页 →「写长文」…');
  await page.goto(XHS.longform, { timeout: 60000 });
  await sleep(2500);
  if (!(await isLoggedIn(page))) {
    throw new SkillError('LOGIN_REQUIRED', '小红书未登录或登录已失效', '请用户运行 `node scripts/xhs.mjs login --account <别名>` 扫码');
  }
  await page.waitFor(`/新的创作/.test(document.body.innerText)`, { timeout: 15000, interval: 500 }).catch(() => false);

  // 长文列表页 → 新的创作。这个按钮用坐标点有时没反应，优先 JS 派发
  const created = await page.clickJsByText('新的创作', { selector: 'button, div, span' });
  log(`点「新的创作」: ${created.found ? 'ok' : '没找到'}`);

  let ok = await page
    .waitFor(`!!document.querySelector('${LF.title}')`, { timeout: 12000, interval: 400 })
    .catch(() => false);

  if (!ok) {
    log('JS 点击没进入编辑器，改用坐标点击重试一次…');
    const h = await page.findByText('新的创作', { selector: 'button, div, span' }).catch(() => null);
    if (h) await page.clickAt(h.x, h.y);
    ok = await page
      .waitFor(`!!document.querySelector('${LF.title}')`, { timeout: 12000, interval: 400 })
      .catch(() => false);
  }

  if (!ok) throw new SkillError('PAGE_CHANGED', '长文编辑器没打开（找不到标题输入框）', '跑 inspect 看页面停在哪个环节');
}

export async function publishText(job, { account, submit: doSubmit = false } = {}) {
  const promotionPreflight = assertPromotionReady(job, { kind:'post', phase:'final', platformLayout:true });
  doSubmit = doSubmit && !job.submitDisabled && (promotionInput(job) ? promotionInput(job).original.submit !== false : job.submit !== false);
  const t0 = Date.now();
  const pre = preflight('xhs', job);
  for (const w of pre.warnings) log(`⚠ ${w}`);
  if (pre.errors.length) throw new SkillError('USAGE', '内容不符合小红书规范:\n  ' + pre.errors.join('\n  '));

  const page = await ensureBrowser(account);
  await assertAccount(page, account);
  if (doSubmit) {
    const existing = await findPublishedOrReviewing(page, job.title, { account, date: job.date });
    if (existing.found) {
      log('发现同标题已发布或审核中的笔记，跳过本次提交以免重复');
      return {
        ok: true,
        platform: 'xiaohongshu', promotionPreflight,
        mode: 'longform-text',
        submitted: false,
        alreadyPublished: true,
        dryRun: false,
        url: existing.url,
        verification: existing,
        elapsedMs: Date.now() - t0,
        note: '发布前核验：笔记管理或审核中已有同标题笔记，未再次提交',
        ...titleMeta(job),
      };
    }
  }
  await openLongformEditor(page);

  log(`填长文标题（${[...job.title].length} 字）`);
  await page.type(LF.title, job.title);
  await sleep(300);

  log(`填长文正文（${[...job.content].length} 字）`);
  await page.type(LF.body, job.content);
  await sleep(800);

  log('一键排版（平台自动生成文字卡片）…');
  let layoutClicked = false;
  try {
    await page.clickByAx('一键排版', { role: 'button' });
    layoutClicked = true;
  } catch {}
  if (!layoutClicked) {
    const j = await page.clickJsByText('一键排版', { selector: 'button, div, span' });
    if (!j.found) throw new SkillError('PAGE_CHANGED', '找不到「一键排版」按钮');
  }

  // 等真正进入排版预览页（出现「下一步」），别被编辑器里残留的「一键排版」骗过去
  const layoutReady = await page
    .waitFor(`/下一步/.test(document.body.innerText)`, { timeout: 45000, interval: 800 })
    .catch(() => false);
  if (!layoutReady) throw new SkillError('PAGE_CHANGED', '一键排版后没进入排版页', '跑 inspect 看当前页面');
  await sleep(2500);

  // 排版预览页 → 下一步
  let advanced = false;
  try {
    await page.clickByAx('下一步', { role: 'button' });
    advanced = true;
  } catch {}
  if (!advanced) {
    const next = await page.clickJsByText('下一步', { selector: 'button, div, span' });
    if (!next.found) {
      const h = await page.findByText('下一步', { selector: 'button, div, span' }).catch(() => null);
      if (!h) throw new SkillError('PAGE_CHANGED', '排版页上找不到「下一步」', '跑 inspect 看排版页结构');
      await page.clickAt(h.x, h.y);
    }
  }
  await sleep(4000);

  const arrived = await page
    .waitFor(`!!document.querySelector('${LF.postTitle}')`, { timeout: 20000, interval: 500 })
    .catch(() => false);
  if (!arrived) throw new SkillError('PAGE_CHANGED', '没进入发布表单（找不到标题输入框）');

  await dismissTips(page);

  // 正文：默认把全文也写进正文框（长文卡片里已有全文，正文再放一份，
  // 保证用户在笔记下方也能读到完整内容）。显式给了 caption 就用 caption。
  const CAPTION_MAX = 1000;
  let bodyText = (job.caption && job.caption.trim()) ? job.caption.trim() : job.content.trim();
  if ([...bodyText].length > CAPTION_MAX) {
    throw new SkillError('USAGE',`正文超过发布页上限 ${CAPTION_MAX}，必须先转详情图，不截断`);
  }

  if (bodyText || job.topics.length) {
    log(`填笔记正文（${[...bodyText].length} 字）…`);
    if (bodyText) await page.type(LF.body, bodyText);
    await sleep(400);
    if (job.topics.length) {
      log(`按正式话题插入 ${job.topics.length} 个话题（输入 # 后从下拉选择，不把标签粘成纯文本）`);
      await insertOfficialTopics(page, LF.body, job.topics);
    }
    // 先核对话题高亮，再关下拉，避免把话题面板当成成功
    await verifyTopicsHighlighted(page, job.topics);
    await page.pressEscape();
    await sleep(400);
  }

  // 平台要先把文字卡片渲染成图片，没生成完就发会丢图
  log('等平台生成笔记图片…');
  const ready = await page
    .waitFor(`!/笔记图片生成中|图片生成中/.test(document.body.innerText)`, { timeout: 90000, interval: 1000 })
    .catch(() => false);
  if (!ready) log('⚠ 图片可能还在生成，发布前请看一眼截图');
  await sleep(1500);

  const shot = path.join(artifactsDir(account), `before-submit-${stamp()}.png`);
  await page.screenshot(shot);
  log(`预览截图: ${shot}`);

  if (!doSubmit) {
    return {
      ok: true,
      platform: 'xiaohongshu', promotionPreflight,
      mode: 'longform-text',
      submitted: false,
      dryRun: true,
      url: await page.url(),
      screenshot: shot,
      elapsedMs: Date.now() - t0,
      note: '长文已排版并进入发布表单，但未点发布；用户确认后需移除 job.submit:false 或改为 true，才可通过 --submit 提交',
    };
  }

  await submit(page);
  await sleep(800);

  const result = await waitPublished(page, { title: job.title, account, date: job.date }).catch(async (e) => {
    const errShot = path.join(artifactsDir(account), `failed-${stamp()}.png`);
    await page.screenshot(errShot).catch(() => {});
    e.shot = errShot;
    throw e;
  });

  const doneShot = path.join(artifactsDir(account), `published-${stamp()}.png`);
  await page.screenshot(doneShot).catch(() => {});
  return {
    ok: true,
    platform: 'xiaohongshu', promotionPreflight,
    mode: 'longform-text',
    submitted: true,
    alreadyPublished: false,
    dryRun: false,
    url: result.url,
    screenshot: doneShot,
    elapsedMs: Date.now() - t0,
    verification: result.verification || null,
    via: result.via || null,
    ...titleMeta(job),
  };
}

function titleMeta(job) {
  return {titleOriginal:job.titleOriginal,titleFinal:job.title,titleCompressed:job.titleCompressed,titleRule:job.titleRule,titleCount:job.titleCount};
}

/** 分发：本地生成并逐图审阅后走图文；旧平台一键排版链路由最终预检阻止。 */
export async function publish(job, opts = {}, dependencies = {}) {
  // Isolated-test seam only; CLI never accepts browser/render bypass dependencies.
  const deps = { prepareOverflow, prepareGithubIntro, publishText, publishImage, ...dependencies };
  let promotionPreflight = assertPromotionReady(job, { kind:'post', phase:'known' });
  try {
    await deps.prepareOverflow(job);
    await deps.prepareGithubIntro(job);
    promotionPreflight = assertPromotionReady(job, { kind:'post', phase:'final' });
    if (job.linkChanges && job.linkChanges.length) {
      for (const c of job.linkChanges) log(`外链转述: ${c.from} → ${c.to}`);
    }
    const result = job.images.length === 0 ? await deps.publishText(job, opts) : await deps.publishImage(job, opts);
    if (job.linkChanges && job.linkChanges.length) result.linkChanges = job.linkChanges;
    if (job.githubIntroResult) result.githubIntro = job.githubIntroResult;
    result.overflow=job.overflowResult;
    result.images=job.images;
    result.bodyCount=job.bodyCount;
    result.topicVerification=job.topicVerification;
    result.promotionPreflight=promotionPreflight;
    Object.assign(result, titleMeta(job));
    return result;
  } catch (error) {
    error.promotionPreflight ??= promotionPreflight;
    throw error;
  }
}
