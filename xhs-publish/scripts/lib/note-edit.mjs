// Scoped existing-note editor. Never opens a new-note route, calls post, or deletes a note.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const compareRenderedSourcesDefault=async(...args)=>(await import('./visual-proof.mjs')).compareRenderedSources(...args);
// Provenance stays in Node memory; persisted JSON/DOM/job objects cannot mint proof.
const trustedVisualEvidence=new WeakMap();
import { ensureBrowser, assertAccount, insertOfficialTopics, verifyTopicsHighlighted, XHS } from './xhs.mjs';
import { SkillError, sleep, artifactsDir, stamp, charLen } from './util.mjs';
import { prepareEditJob, preflightEditImages } from './edit-job.mjs';
import { assertPromotionReady } from './promotion-preflight.mjs';

const own = (o,k) => Object.hasOwn(o,k);
const norm = s => String(s ?? '').replace(/\r\n?/g,'\n').replace(/[ \t]+\n/g,'\n').trim();
const evaluate = (page, fn, ...args) => page.eval(`(${fn.toString()})(${args.map(v=>JSON.stringify(v)).join(',')})`);
const fail = (code,message) => { throw new SkillError(code,message); };

/** Only the public UI URL is read; no storage, credentials, or private API. */
export function editRoute(url, expectedId) {
  let u;
  try { u = new URL(url); } catch { fail('PAGE_CHANGED','无法读取原笔记编辑URL'); }
  if (u.origin !== 'https://creator.xiaohongshu.com' || !/^\/publish\/update\/?$/.test(u.pathname)) fail('PAGE_CHANGED','不在原笔记 /publish/update 编辑页，禁止保存或新建');
  const ids = [...new Set([...u.searchParams].filter(([key])=>/^(?:note_?id|id)$/i.test(key)).map(([,v])=>v))];
  if (ids.length !== 1 || !/^[a-zA-Z0-9_-]{8,128}$/.test(ids[0])) fail('PAGE_CHANGED','原编辑页URL未给出唯一可核验笔记ID');
  if (expectedId && ids[0] !== expectedId) fail('PAGE_CHANGED','笔记ID改变，停止编辑/保存');
  return { noteId:ids[0], url:u.href };
}

// Kept self-contained so the real DOM discovery can be tested offline.
export function managerCardsDom() {
  // Exact 20x20 pencil observed in the manager DOM on 2026-11-13. Unknown SVGs
  // remain unsupported: neither position nor absence of --del is edit evidence.
  const pencilPath='M16.1917 17.4916H3.80835C3.39168 17.4916 3.05835 17.1582 3.05835 16.7416C3.05835 16.3249 3.39168 15.9916 3.80835 15.9916H16.1917C16.6083 15.9916 16.9417 16.3249 16.9417 16.7416C16.9417 17.1582 16.6083 17.4916 16.1917 17.4916ZM7.89168 14.7166C8.41668 14.6582 8.90835 14.4166 9.28335 14.0416L16.7667 6.49157C17.6986 5.55969 17.6986 4.00678 16.7667 3.0749C15.825 2.13324 14.2917 2.13324 13.35 3.0749L5.85002 10.6416C5.48335 11.0082 5.25002 11.4999 5.19168 12.0166L5.02502 13.4999C4.98335 13.8832 5.11668 14.2582 5.38335 14.5332C5.62502 14.7666 5.94168 14.8999 6.26668 14.8999C6.80609 14.8999 7.35679 14.7827 7.89168 14.7166ZM15.7 4.1499C16.0532 4.50309 16.0549 5.10319 15.6917 5.4499L8.20835 12.9999C8.07502 13.1332 7.90002 13.2166 7.71668 13.2332L6.55002 13.3666L6.68335 12.1916C6.70002 12.0082 6.78335 11.8332 6.91668 11.7082L14.4083 4.1499C14.7667 3.79157 15.35 3.79157 15.7 4.1499Z';
  const visible = e => { const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'; };
  return [...document.querySelectorAll('.note-card')].map((card,index)=>{
    const titleNodes = [...card.querySelectorAll('.note-card__title, .note-title, .title, [data-testid="note-title"]')];
    const titles = titleNodes.flatMap(n=>[n.getAttribute('title'), n.innerText]).filter(Boolean).map(s=>s.trim());
    const lines = (card.innerText || '').split('\n').map(s=>s.trim()).filter(Boolean);
    const dateTexts = [...card.querySelectorAll('time, .note-card__time, .note-card__date, .publish-time, .date')].map(n=>n.getAttribute('datetime')||n.innerText);
    // Prefer publication/time nodes; a date embedded in the title is not publish-date evidence.
    const dateSources=dateTexts.filter(Boolean).length?dateTexts:lines.filter(s=>!titles.includes(s)&&/^(?:发布于?\s*|发布时间[:：]?\s*)?\d{4}[-/.年]/.test(s));
    const dates = [...new Set(dateSources.flatMap(s=>[...String(s).matchAll(/(?:^|\D)(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|(?=T|\s|$))/g)].map(m=>`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`)))];
    const actions = [...card.querySelectorAll('.note-card__action-btn, button, a[href], [role="button"]')].filter(visible).flatMap(el=>{
      const labels=[el.getAttribute('aria-label'),el.getAttribute('title'),el.innerText].filter(Boolean).map(s=>s.trim());
      const attrs=[el.getAttribute('data-testid'),el.getAttribute('data-action'),el.className].filter(s=>typeof s==='string');
      const icons=[...el.querySelectorAll('svg, use, [class*="icon"]')].flatMap(n=>[n.getAttribute('class'),n.getAttribute('href'),n.getAttribute('xlink:href'),n.getAttribute('aria-label')]).filter(Boolean);
      const href=el.getAttribute('href');
      let editHref=null;
      try { const u=new URL(href,location.href);if(href&&u.origin===location.origin&&/^\/publish\/update\/?$/.test(u.pathname)) editHref=u.href; } catch {}
      const semantic=labels.some(s=>/^(?:编辑(?:笔记)?|修改笔记|edit(?: note)?)$/i.test(s)) || [...attrs,...icons].some(s=>/(?:^|[-_/#\s])(?:edit|pencil)(?:$|[-_\s])/i.test(s));
      const svgs=[...el.querySelectorAll('svg')];
      const paths=svgs.length===1?[...svgs[0].querySelectorAll('path')]:[];
      const observedPencil=String(el.className||'').split(/\s+/).includes('note-card__action-btn')&&svgs.length===1&&String(svgs[0].getAttribute('viewBox')||'').trim().replace(/\s+/g,' ')==='0 0 20 20'&&paths.length===1&&String(paths[0].getAttribute('d')||'').trim().replace(/\s+/g,' ')===pencilPath;
      const isDelete=labels.some(s=>/删除|delete/i.test(s))||attrs.some(s=>/(?:^|[-_\s])(?:del|delete)(?:$|[-_\s])/i.test(s));
      if ((!editHref&&!semantic&&!observedPencil)||isDelete) return [];
      const r=el.getBoundingClientRect();return [{x:r.x+r.width/2,y:r.y+r.height/2,href:editHref,label:labels.join(' / ')||(observedPencil?'observed-pencil-icon':'semantic-edit-icon')}];
    });
    // Parent wrappers and their same-position child represent one action, not two.
    const unique=actions.filter((a,i)=>!actions.slice(0,i).some(b=>Math.abs(a.x-b.x)<3&&Math.abs(a.y-b.y)<3));
    return {index,titles:[...new Set(titles)],lines,dates,actions:unique};
  });
}

export function selectNoteCard(cards, { targetTitle, date }) {
  // A full visible line is the fallback when the platform has no dedicated title selector.
  const exact=cards.filter(c=>(c.titles.length?c.titles:c.lines).some(t=>t===targetTitle));
  if (date&&exact.some(c=>c.dates.length!==1)) fail('PAGE_CHANGED','同名笔记的业务发布日期不可唯一读取，停止而不猜测');
  const matches=exact.filter(c=>!date||c.dates[0]===date);
  if(matches.length!==1) fail('PAGE_CHANGED',`完整标题${date?'及业务日期':''}命中 ${matches.length} 篇笔记；必须唯一，不做子串匹配`);
  if(matches[0].actions.length!==1) fail('PAGE_CHANGED','原笔记没有唯一可辨认的编辑入口；不按第四个按钮猜测');
  return matches[0];
}

export function editorSnapshotDom() {
  const visible = e => {const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const titleNodes=[...document.querySelectorAll('input[placeholder*="标题"], textarea[placeholder*="标题"], .title-input input, input.d-max')].filter(visible);
  const bodies=[...document.querySelectorAll('[contenteditable="true"]')].filter(e=>visible(e)&&!e.parentElement?.closest('[contenteditable="true"]'));
  const status=document.querySelector('.img-list .status')?.innerText?.trim()||'';
  const count=/^(\d+)\s*\/\s*18$/.exec(status);
  if(titleNodes.length!==1||bodies.length!==1||!count) return {ready:false,url:location.href,reason:'标题/正文编辑区或图片计数不唯一'};
  const body=bodies[0];
  const topicNodes=[...body.querySelectorAll('a[data-topic]')];
  const topics=topicNodes.map(n=>{try {const d=JSON.parse(n.getAttribute('data-topic'));return {id:String(d.id||''),name:String(d.name||''),text:n.innerText};}catch{return {id:'',name:'',text:n.innerText};}});
  const malformed=topics.some(t=>!t.id||t.id==='newTopic_Id'||!t.name);
  // Reconstruct text from rendered DOM, excluding actual topic entities, preserving paragraphs.
  const render = n => {
    if(n.nodeType===3) return n.textContent;
    if(n.nodeType!==1) return '';
    if(n.matches('a[data-topic]')) return '';
    const style=getComputedStyle(n);
    if(style.display==='none'||style.visibility==='hidden') return '';
    if(n.tagName==='BR') return '\n';
    const value=[...n.childNodes].map(render).join('');
    return /^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(n.tagName)?(value==='\n'?'':value)+'\n':value;
  };
  const selector = el => {
    const parts=[];
    for(let e=el;e&&e!==document.body;e=e.parentElement){const i=[...e.parentElement.children].indexOf(e)+1;parts.unshift(e.tagName.toLowerCase()+':nth-child('+i+')');}
    return 'body > '+parts.join(' > ');
  };
  const images=[...document.querySelectorAll('.img-list img')].map((img,index)=>({index,src:img.currentSrc||img.src||'',alt:img.alt||'',loaded:img.complete&&img.naturalWidth>0}));
  const text=document.body?.innerText||'';
  return {ready:!malformed&&images.length===Number(count[1])&&images.every(i=>i.loaded)&&!/上传中|正在上传|处理中/.test(text),
    reason:malformed?'话题实体缺少真实ID/名称':'图片未全部就绪',url:location.href,title:titleNodes[0].value,
    body:body.innerText,content:[...body.childNodes].map(render).join(''),topics,images,imageCount:Number(count[1]),imageStatus:status,
    titleSelector:selector(titleNodes[0]),bodySelector:selector(body)};
}

export function imageIdentity(image) {
  const visual=trustedVisualEvidence.get(image);
  if(visual&&visual===image.visualEvidence&&visual.verified===true&&visual.sourceKey===image.src&&/^[a-f0-9]{64}$/.test(visual.referenceSha256)) return 'sha256:'+visual.referenceSha256;
  let u;
  try {u=new URL(image.src);}catch{fail('PAGE_CHANGED','图片没有可核验的URL');}
  if(!/^https?:$/.test(u.protocol)) fail('PAGE_CHANGED','图片仍为本地/blob临时预览，无法在保存后核验；停止保存');
  // CDN host and resize query/suffix may change; the object pathname must not.
  const object=u.pathname.split('!')[0];
  return /(^|\.)xhscdn\.(com|net)$/i.test(u.hostname)?object:u.origin+object+u.search;
}
const topicIds = topics => topics.map(t=>`${t.id}:${t.name.toLowerCase()}`).sort();
const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b);

export function verifyEditor(actual, expected, noteId, { images = true } = {}) {
  editRoute(actual.url,noteId);
  if(!actual.ready) fail('PAGE_CHANGED','原笔记编辑区未就绪');
  if(norm(actual.title)!==norm(expected.title)) fail('PAGE_CHANGED','读回标题与完整目标标题不一致');
  if(norm(actual.content)!==norm(expected.content)) fail('PAGE_CHANGED','读回正文与完整目标正文不一致（不忽略内部空白）');
  if(!equal(topicIds(actual.topics),topicIds(expected.topics))) fail('PAGE_CHANGED','读回正式话题ID/名称改变');
  if(images&&!equal(actual.images.map(imageIdentity),expected.images.map(imageIdentity))) fail('PAGE_CHANGED','读回图片对象/顺序与保存前不一致');
  return true;
}

// Read-only discovery: the actual click is trusted CDP input, never a synthetic
// event on a wrapper (the platform may attach the handler to its inner child).
export function deleteImageDom() {
  const list=document.querySelector('.img-list');
  const image=list?.querySelector('img');
  if(!image) return null;
  let tile=image.parentElement;
  while(tile&&tile!==list&&!(tile.querySelectorAll('img').length===1&&tile.querySelector('.close-btn'))) tile=tile.parentElement;
  if(!tile||tile.querySelectorAll('img').length!==1) return null;
  const visible=el=>{
    const r=el.getBoundingClientRect();
    if(r.width<=0||r.height<=0) return false;
    for(let n=el;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;if(n===list)break;}
    return getComputedStyle(el).pointerEvents!=='none';
  };
  const controls=[...tile.querySelectorAll('.close-btn')].filter(visible);
  if(controls.length!==1) return null;
  const control=controls[0],r=control.getBoundingClientRect();
  const point={x:r.x+r.width/2,y:r.y+r.height/2};
  const hit=document.elementFromPoint(point.x,point.y);
  if(!hit||!control.contains(hit)) return null;
  return point;
}
export function imageStateDom() {
  const status=document.querySelector('.img-list .status')?.innerText?.trim()||'';
  const match=/^(\d+)\s*\/\s*18$/.exec(status);
  const nodes=[...document.querySelectorAll('.img-list img')];
  const images=nodes.map((img,index)=>({index,src:img.currentSrc||img.src||'',alt:img.alt||'',loaded:img.complete&&img.naturalWidth>0}));
  const r=nodes[0]?.getBoundingClientRect();
  const count=match?Number(match[1]):null;
  const uploading=/上传中|正在上传|处理中/.test(document.body?.innerText||'');
  return {count,status,images,ready:count!==null&&images.length===count&&images.every(i=>i.loaded)&&!uploading,
    tile:r?{x:r.x+r.width/2,y:r.y+r.height/2}:null,uploading,uploadInput:!!document.querySelector('.img-list .top input[type=file]')};
}

export function saveStateDom() {
  const text=document.body?.innerText||'';
  const notices=[...document.querySelectorAll('[role="status"], [role="alert"], .el-message, .d-message, .toast')].map(n=>n.innerText).filter(Boolean);
  const lines=text.split('\n').map(s=>s.trim()).filter(s=>/^(?:修改成功|更新成功|保存成功|发布成功|提交成功|笔记修改成功|笔记更新成功)[！!。\s]*$/.test(s));
  const visible=el=>{
    const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;
    for(let n=el;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0)return false;}
    return true;
  };
  const nodes=[...document.querySelectorAll('h1, h2, h3, h4, h5, h6, header, main, section, div, span, p, strong')];
  const exactVisible=want=>nodes.some(n=>visible(n)&&(n.innerText||'').trim()===want);
  const returnButtons=[...document.querySelectorAll('button, [role="button"]')].filter(n=>visible(n)&&(n.innerText||'').trim()==='立即返回');
  // Observed update-only success UI, not a generic new-post success route/message.
  const updateSuccessPage=exactVisible('更新笔记')&&exactVisible('更新成功')&&returnButtons.length===1&&!returnButtons[0].disabled&&returnButtons[0].getAttribute('aria-disabled')!=='true';
  return {url:location.href,notices:[...notices,...lines],updateSuccessPage,
    failure:/保存失败|修改失败|更新失败|发布失败|提交失败|图片上传失败/.test(text)};
}

export function editDialogDom() {
  const dialogs=[...document.querySelectorAll('[role="dialog"], .el-dialog, .modal')].filter(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0;});
  const hits=[];
  for(const d of dialogs){
    if(!/修改|更新|保存|发布/.test(d.innerText)||/删除笔记|新建笔记/.test(d.innerText)) continue;
    for(const b of d.querySelectorAll('button, [role="button"]')){
      if(!/^(确认发布|继续发布|确认修改|保存修改|确认更新|确定|确认)$/.test(b.innerText.trim())||b.disabled||b.getAttribute('aria-disabled')==='true') continue;
      const r=b.getBoundingClientRect();if(r.width>0&&r.height>0) hits.push({x:r.x+r.width/2,y:r.y+r.height/2});
    }
  }
  return hits.length===1?hits[0]:null;
}

async function readSnapshot(page, deps, noteId, timeout=30000) {
  const start=deps.now();
  do {
    editRoute(await page.eval('location.href'),noteId);
    const state=await evaluate(page,editorSnapshotDom);
    if(state.ready) { state.noteId=editRoute(state.url,noteId).noteId;return state; }
    await deps.sleep(500);
  } while(deps.now()-start<timeout);
  fail('PAGE_CHANGED','原笔记标题/正文/图片/正式话题读回超时，状态未知');
}

async function verifyLocalVisualImages(page, images, inputs, noteId, deps, prefix) {
  if(images.length!==inputs.length) fail('PAGE_CHANGED','视觉核验图片与本地输入数量不一致');
  for(let index=0;index<images.length;index++){
    editRoute(await page.eval('location.href'),noteId);
    const image=images[index],input=inputs[index];
    if(!image.loaded||!/^https?:|^blob:/.test(image.src)) fail('PAGE_CHANGED','新图片尚未成为可见且已加载的浏览器图片');
    const bytes=fs.readFileSync(input.path);
    const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
    if(sha256!==input.sha256) fail('USAGE','本地参考图片在预检后发生改变，停止视觉核验/保存');
    const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(input.path).toLowerCase()];
    const referenceSrc=`data:${mime};base64,${bytes.toString('base64')}`;
    const result=await deps.compareRenderedSources(page,referenceSrc,image.src,{width:216,height:288,fit:'contain',prefix:prefix+'-'+(index+1)});
    const visual={verified:result?.verified===true,referenceSha256:sha256,sourceKey:image.src,inputIndex:index,
      meanAbsoluteError:result?.meanAbsoluteError,errorRatio:result?.errorRatio,changedFraction:result?.changedFraction,
      referenceScreenshot:result?.referenceScreenshot,actualScreenshot:result?.actualScreenshot,width:216,height:288,fit:'contain',
      thresholds:result?.thresholds,referencePixelSha256:result?.referencePixelSha256,actualPixelSha256:result?.actualPixelSha256,
      referenceNaturalWidth:result?.referenceNaturalWidth,referenceNaturalHeight:result?.referenceNaturalHeight,
      actualNaturalWidth:result?.actualNaturalWidth,actualNaturalHeight:result?.actualNaturalHeight};
    Object.freeze(visual);
    image.visualEvidence=visual;
    if(!visual.verified) fail('PAGE_CHANGED',`第${index+1}张新图与对应本地输入视觉不匹配，停止保存`);
    trustedVisualEvidence.set(image,visual);
    editRoute(await page.eval('location.href'),noteId);
  }
}

function bindStagingVisualEvidence(state,remainingOriginals,newImages) {
  // Preserve exact blob/HTTP source keys and order throughout original deletion.
  if(state.images.length!==remainingOriginals+newImages.length) fail('PAGE_CHANGED','暂存图片数量变化，无法传递视觉证据');
  for(let index=0;index<newImages.length;index++){
    const image=state.images[remainingOriginals+index],verified=newImages[index];
    const proof=trustedVisualEvidence.get(verified);
    if(image.src!==verified.src||!proof||proof.sourceKey!==image.src||proof.verified!==true) fail('PAGE_CHANGED','新图暂存来源键或顺序改变，不能复用视觉证据');
    image.visualEvidence=proof;trustedVisualEvidence.set(image,proof);
  }
  return state;
}

const orderedImageIds=state=>state.images.map(imageIdentity);
function requireImageOrder(state,expected,message) {
  if(!state.ready||state.count!==expected.length||!equal(orderedImageIds(state),expected)) fail('PAGE_CHANGED',message);
}

async function replaceImages(page, images, noteId, deps, originalIds, proof, record, inputs, prefix) {
  // Append first: never require a zero-image editor and never guess which item was removed.
  preflightEditImages(images);
  if(originalIds.length+images.length>18) fail('USAGE','原图加新图超过18张；不分批或先删图，停止修改');
  let state=await evaluate(page,imageStateDom);
  requireImageOrder(state,originalIds,'上传前原图对象/顺序改变，停止');
  if(!state.uploadInput) fail('PAGE_CHANGED','原图片上传入口不可用');
  editRoute(await page.eval('location.href'),noteId);
  await page.upload('.img-list .top input[type=file]',images);
  const total=originalIds.length+images.length,start=deps.now();
  let uploaded=false;
  do {
    await deps.sleep(500);editRoute(await page.eval('location.href'),noteId);
    state=await evaluate(page,imageStateDom);proof.lastState=state;
    if(state.count>total) fail('UPLOAD_FAILED','追加图片数量超过原图加新图的精确目标');
    if(state.ready&&state.count===total){uploaded=true;break;}
  }while(deps.now()-start<120000);
  if(!uploaded) fail('UPLOAD_FAILED','追加新图片超时或未全部加载/处理完成，未删除原图、未保存');
  const originalPrefix=state.images.slice(0,originalIds.length).map(imageIdentity);
  if(!equal(originalPrefix,originalIds)) fail('PAGE_CHANGED','追加后原图不再是完整有序前缀，未删除原图、未保存');
  const newImages=state.images.slice(originalIds.length);
  if(newImages.length!==images.length) fail('UPLOAD_FAILED','追加后的新图对象数量不符');
  await verifyLocalVisualImages(page,newImages,inputs,noteId,deps,prefix+'-visual-appended');
  const newIds=newImages.map(imageIdentity);
  proof.appendedImages=state.images;proof.newIds=newIds;proof.newSourceKeys=newImages.map(i=>i.src);proof.deletions=[];
  await record('images-appended');
  for(let index=0;index<originalIds.length;index++) {
    const expectedBefore=[...originalIds.slice(index),...newIds];
    editRoute(await page.eval('location.href'),noteId);
    state=await evaluate(page,imageStateDom);proof.lastState=state;
    bindStagingVisualEvidence(state,originalIds.length-index,newImages);
    requireImageOrder(state,expectedBefore,'删除前原图/新图对象或顺序发生变化，停止');
    if(!state.tile) fail('PAGE_CHANGED','找不到第一张原图片节点，停止删除');
    await page.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...state.tile,buttons:0});
    await deps.sleep(500);
    const close=await evaluate(page,deleteImageDom);
    if(!close) fail('PAGE_CHANGED','第一张原图删除入口缺失、不可见或不唯一');
    editRoute(await page.eval('location.href'),noteId);
    state=await evaluate(page,imageStateDom);
    bindStagingVisualEvidence(state,originalIds.length-index,newImages);
    requireImageOrder(state,expectedBefore,'点击删除前图片对象/顺序改变，停止');
    editRoute(await page.eval('location.href'),noteId);
    await page.clickAt(close.x,close.y);
    const expectedAfter=expectedBefore.slice(1),deleteStart=deps.now();
    let removed=false;
    do {
      await deps.sleep(400);editRoute(await page.eval('location.href'),noteId);
      state=await evaluate(page,imageStateDom);proof.lastState=state;
      if(state.count===null||![expectedBefore.length,expectedAfter.length].includes(state.count)) fail('PAGE_CHANGED','删除后的图片数量不是精确减一，停止');
      if(state.ready){
        bindStagingVisualEvidence(state,originalIds.length-index-(state.count===expectedAfter.length?1:0),newImages);
        const actual=orderedImageIds(state);
        if(state.count===expectedAfter.length){
          if(!equal(actual,expectedAfter)) fail('PAGE_CHANGED','删除的不是预期第一张原图，或新图对象/顺序改变，停止');
          removed=true;break;
        }
        if(!equal(actual,expectedBefore)) fail('PAGE_CHANGED','等待删除时图片对象/顺序意外改变，停止');
      }
    }while(deps.now()-deleteStart<8000);
    if(!removed) fail('PAGE_CHANGED','第一张原图未按预期减一并读回，停止保存');
    proof.deletions.push({removedOriginalId:originalIds[index],remainingIds:orderedImageIds(state)});
  }
  requireImageOrder(state,newIds,'替换完成后新图数量/对象/顺序不符，停止保存');
  proof.finalIds=orderedImageIds(state);
  return {images:state.images,newIds};
}

async function clickSaveOriginal(page,noteId) {
  editRoute(await page.eval('location.href'),noteId);
  const candidates=[];
  // On the verified update route, some platform builds still call this button 发布.
  const labels=['保存修改','提交修改','确认修改','更新笔记','保存','更新','发布','立即发布'];
  for(const [priority,label] of labels.entries()) {
    const hits=await page.axFind(label,{role:'button',exact:true});
    for(const h of hits.filter(h=>!h.disabled)) {
      const box=await page.cdp.send('DOM.getBoxModel',{backendNodeId:h.backendDOMNodeId});const q=box.model.border;
      candidates.push({priority,x:(q[0]+q[4])/2,y:(q[1]+q[5])/2,label});
    }
  }
  candidates.sort((a,b)=>a.priority-b.priority||b.y-a.y);
  if(!candidates.length) fail('PUBLISH_FAILED','原笔记编辑页没有可用保存/更新按钮；不调用新建发布');
  editRoute(await page.eval('location.href'),noteId);
  await page.clickAt(candidates[0].x,candidates[0].y);
  return candidates[0].label;
}

async function waitSaved(page,noteId,deps,priorNotices) {
  const start=deps.now();let confirmed=false;
  do {
    const s=await evaluate(page,saveStateDom);
    if(s.failure) fail('PUBLISH_FAILED','平台提示原笔记修改/保存失败');
    const u=new URL(s.url);
    const success=s.notices.some(n=>!priorNotices.includes(n)&&/修改成功|更新成功|保存成功|发布成功|提交成功/.test(n));
    if(u.origin!=='https://creator.xiaohongshu.com') fail('PUBLISH_FAILED','保存后跳到未知站点，结果未知');
    if(/^\/publish\/update\/?$/.test(u.pathname)) {
      editRoute(s.url,noteId);
      if(success) return {signal:'success-notice',url:s.url,notices:s.notices};
      if(!confirmed) {const hit=await evaluate(page,editDialogDom);if(hit){editRoute(await page.eval('location.href'),noteId);await page.clickAt(hit.x,hit.y);confirmed=true;}}
    } else if(u.pathname==='/new/note-manager') return {signal:'returned-to-note-manager',url:s.url,notices:s.notices};
    else if(s.updateSuccessPage===true&&!/^\/publish\/(?:publish|new)(?:\/|$)/.test(u.pathname)) return {signal:'verified-update-success-ui',url:s.url,notices:s.notices};
    else fail('PUBLISH_FAILED','保存后没有返回原笔记编辑页/笔记管理，也未核验到更新专用成功界面；结果未知，禁止重发');
    await deps.sleep(750);
  }while(deps.now()-start<60000);
  fail('PUBLISH_FAILED','原笔记保存超时，没有成功提示或管理页跳转；结果未知，切勿盲目重试');
}

/** Third argument is an isolated-test dependency seam, never a browser/profile bypass in CLI. */
export async function editNote(input, {account,submit:requested=false}={}, dependencies={}) {
  const deps={ensureBrowser,assertAccount,insertOfficialTopics,verifyTopicsHighlighted,compareRenderedSources:compareRenderedSourcesDefault,sleep,now:()=>Date.now(),artifactsDir,...dependencies};
  const job=prepareEditJob(input,{baseDir:input.jobFile?path.dirname(input.jobFile):process.cwd()});
  const plan=job.edit;
  const doSubmit=requested&&!job.submitDisabled;
  // Local preflight and explicit fields are resolved before connecting to any browser.
  let promotionPreflight=assertPromotionReady(job,{kind:'edit',phase:'known'});
  const page=await deps.ensureBrowser(account);
  await deps.assertAccount(page,account);
  const base=path.join(deps.artifactsDir(account),'edit-'+stamp());
  const evidence={targetTitle:plan.targetTitle,date:plan.date??null,requested:plan,inputImages:job.imagePreflight,submissionAttempted:false};
  const record=async phase => {
    const shot=base+'-'+phase+'.png';
    evidence.screenshots??={};evidence.screenshots[phase]=await page.screenshot(shot).catch(()=>null);
    fs.writeFileSync(base+'.json',JSON.stringify(evidence,null,2),'utf8');
    return evidence.screenshots[phase];
  };
  try {
    await page.goto(XHS.noteManager,{timeout:60000});
    await deps.sleep(2500);
    const card=selectNoteCard(await evaluate(page,managerCardsDom),plan);
    evidence.managerMatch=card;
    await page.clickAt(card.actions[0].x,card.actions[0].y);
    const start=deps.now();let route;
    do {await deps.sleep(500);try{route=editRoute(await page.eval('location.href'));}catch(e){if(deps.now()-start>=15000) throw e;}}
    while(!route&&deps.now()-start<15000);
    if(!route) fail('PAGE_CHANGED','没有进入原笔记编辑页');
    if(card.actions[0].href&&editRoute(card.actions[0].href).noteId!==route.noteId) fail('PAGE_CHANGED','实际打开笔记与编辑入口ID不一致');
    const before=await readSnapshot(page,deps,route.noteId);
    evidence.before=before;
    if(norm(before.title)!==plan.targetTitle) fail('PAGE_CHANGED','编辑页原题与定位完整标题不同，尚未修改');
    // Require stable, ordered original-image identities for before/after evidence.
    before.images.forEach(imageIdentity);
    await record('before');
    const wantedTopics=own(plan,'topics')?plan.topics:before.topics.map(t=>t.name);
    const wantedContent=own(plan,'content')?plan.content:before.content;
    promotionPreflight=assertPromotionReady(job,{kind:'edit',phase:'final',
      visible:{title:plan.title??before.title,content:wantedContent,topics:wantedTopics},
      retained:plan.replaceImages?undefined:{noteId:route.noteId,images:before.images}});
    evidence.promotionPreflight=promotionPreflight;
    if((own(plan,'content')||own(plan,'topics'))&&charLen(norm(wantedContent))+wantedTopics.reduce((n,t)=>n+charLen(t)+4,0)>1000) fail('USAGE','新正文与保留/替换的正式话题合计超过1000字，尚未修改');
    // All retained-content limits, image files, and input capability are checked before mutation.
    let replacement;
    if(plan.replaceImages){
      const originalIds=before.images.map(imageIdentity);
      if(before.imageCount!==originalIds.length) fail('PAGE_CHANGED','原图计数与完整有序对象不符，尚未修改');
      if(originalIds.length+job.images.length>18) fail('USAGE','上传优先替换要求原图加新图不超过18张，尚未修改；不分批或先删原图');
      preflightEditImages(job.images);
      const s=await evaluate(page,imageStateDom);
      requireImageOrder(s,originalIds,'原图对象/顺序未能再次确认，尚未修改');
      if(!s.uploadInput) fail('PAGE_CHANGED','无法确认图片上传能力，尚未修改');
      evidence.imageReplacement={strategy:'upload-first',originalIds,combinedCount:originalIds.length+job.images.length};
    }
    editRoute(await page.eval('location.href'),route.noteId);
    if(own(plan,'title')) await page.type(before.titleSelector,plan.title);
    if(own(plan,'content')||own(plan,'topics')) {
      editRoute(await page.eval('location.href'),route.noteId);
      await page.type(before.bodySelector,norm(wantedContent));
      if(wantedTopics.length) {
        await deps.insertOfficialTopics(page,before.bodySelector,wantedTopics);
        await deps.verifyTopicsHighlighted(page,wantedTopics);
      }
      await page.pressEscape();
    }
    if(plan.replaceImages) replacement=await replaceImages(page,job.images,route.noteId,deps,evidence.imageReplacement.originalIds,evidence.imageReplacement,record,job.imagePreflight,base);
    const staged=await readSnapshot(page,deps,route.noteId);
    evidence.staged=staged;
    if(plan.replaceImages) await verifyLocalVisualImages(page,staged.images,job.imagePreflight,route.noteId,deps,base+'-visual-before-save');
    const expected={...before,title:plan.title??before.title,content:wantedContent,images:plan.replaceImages?replacement.images:before.images,
      topics:own(plan,'topics')?staged.topics:before.topics};
    if(own(plan,'topics')&&!equal(staged.topics.map(t=>t.name.toLowerCase()).sort(),wantedTopics.map(t=>t.toLowerCase()).sort())) fail('PAGE_CHANGED','新正式话题与明确请求不一致');
    if(plan.replaceImages&&staged.imageCount!==job.images.length) fail('UPLOAD_FAILED','新图数量与有序输入清单不一致');
    staged.images.forEach(imageIdentity);
    verifyEditor(staged,expected,route.noteId);
    const shot=await record('before-save');
    if(!doSubmit) return {ok:true,platform:'xiaohongshu',mode:'edit',submitted:false,dryRun:true,noteId:route.noteId,url:route.url,
      title:staged.title,images:job.images,screenshot:shot,before,staged,promotionPreflight,editEvidence:base+'.json',saveVerified:false};
    const prior=await evaluate(page,saveStateDom);
    editRoute(prior.url,route.noteId);
    evidence.submissionAttempted=true;
    await record('save-attempt');
    evidence.saveButton=await clickSaveOriginal(page,route.noteId);
    evidence.saveSignal=await waitSaved(page,route.noteId,deps,prior.notices);
    // Hard reload the exact original UI edit URL, not a same-title replacement or new note.
    await page.goto(route.url,{timeout:60000});
    const after=await readSnapshot(page,deps,route.noteId);
    evidence.after=after;
    if(plan.replaceImages){
      // A fresh saved editor must expose persistent HTTP/CDN sources; a retained
      // local blob preview is not proof that the original note was saved.
      after.images.forEach(imageIdentity);
      await verifyLocalVisualImages(page,after.images,job.imagePreflight,route.noteId,deps,base+'-visual-saved-readback');
    }
    verifyEditor(after,staged,route.noteId);
    evidence.saveVerified=true;
    const savedShot=await record('saved-readback');
    return {ok:true,platform:'xiaohongshu',mode:'edit',submitted:true,saveVerified:true,noteId:route.noteId,url:route.url,
      title:after.title,images:job.images,screenshot:savedShot,before,staged,after,promotionPreflight,editEvidence:base+'.json',verification:{ok:true,sameNote:true,title:true,content:true,topics:true,orderedImages:true}};
  } catch(error) {
    const e=error instanceof SkillError?error:new SkillError('PAGE_CHANGED',error.message);
    evidence.error={code:e.code,message:e.message};evidence.saveVerified=false;
    e.promotionPreflight??=promotionPreflight;
    evidence.promotionPreflight=e.promotionPreflight;
    e.editEvidence=base+'.json';e.submissionAttempted=evidence.submissionAttempted;
    e.saveOutcome=evidence.submissionAttempted?'unknown':'not-submitted';
    await record('failed').catch(()=>{});
    e.shot??=evidence.screenshots?.failed;
    throw e;
  }
}
