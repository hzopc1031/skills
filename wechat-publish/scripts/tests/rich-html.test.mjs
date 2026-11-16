// Offline only: no CDP, process/profile queries, browser launch, or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJob, formatWechatHtml, assembleWechatHtml, preflight, SkillError, coverPlan, imageDimensions } from '../lib/util.mjs';
import { saveDraft, verifyRichBody, uploadInlineImages, selectCoverFromBody, captureCoverFailure, publish, verifyDraftInList } from '../lib/wechat.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-rich-test-'));
// Only this exact newly-created temp tree is deleted, never a profile or caller's job.
test.after(() => {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.match(path.basename(root), /^wechat-rich-test-/);
  fs.rmSync(root, {recursive:true, force:true});
});
fs.mkdirSync(path.join(root, 'images'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
fs.writeFileSync(path.join(root, 'images', 'one.png'), png);
fs.writeFileSync(path.join(root, 'images', 'two.png'), png);
fs.mkdirSync(path.join(root, 'directory.png'));
let serial = 0;
const html = '<section style="font-size:15px;color:#222;">\n<section style="border-left:3px solid #07c160;"><span leaf="">导语与原样格式。</span></section>\n<!--WECHAT_INLINE_IMAGE:one-->\n<p style="margin:14px 0;"><span leaf="">第二节。</span></p><!--WECHAT_INLINE_IMAGE:two-->\n<p style="color:#576b95;"><span leaf="">#AI</span></p></section>\n';
const manifest = [{id:'two',file:'images/two.png'}, {id:'one',file:'images/one.png'}];
function fixture(patch = {}, source = html) {
  const stem = 'case-' + (++serial);
  const htmlFile = stem + '.html';
  fs.writeFileSync(path.join(root, htmlFile), source);
  const file = path.join(root, stem + '.json');
  fs.writeFileSync(file, JSON.stringify({title:'AI 更新', htmlFile, inlineImages:manifest, type:'ai-update', caption:'摘要', images:[], submit:false, ...patch}));
  return file;
}
const usage = fn => assert.throws(fn, e => e instanceof SkillError && e.code === 'USAGE');

test('UTF-8 HTML is preserved byte-for-byte; paths resolve beside job, not cwd', () => {
  const file = fixture();
  const before = fs.readFileSync(file);
  const job = readJob(file);
  assert.equal(job.html, html);
  assert.equal(formatWechatHtml(job), html);
  assert.equal(job.inlineImages[0].file, path.join(root, 'images', 'two.png'));
  assert.equal(job.htmlFile, path.join(root, path.basename(file, '.json') + '.html'));
  assert.match(job.content, /导语与原样格式/);
  assert.deepEqual(preflight('wechat', job).errors, []);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('stable ids determine placement even when manifest order differs from section order', () => {
  const job = readJob(fixture());
  // Fixture-only DOM strings, not fabricated remote image URLs.
  const first = '<img src="fixture-upload-one" style="max-width:100%;height:auto;">';
  const second = '<img src="fixture-upload-two" style="max-width:100%;height:auto;">';
  const result = assembleWechatHtml(job.html, job.inlineImages, new Map([['two',second],['one',first]]));
  assert.equal(result, html.replace('<!--WECHAT_INLINE_IMAGE:one-->', first).replace('<!--WECHAT_INLINE_IMAGE:two-->', second));
  assert.ok(result.indexOf(first) < result.indexOf('第二节。'));
  assert.ok(result.indexOf(second) > result.indexOf('第二节。'));
});

test('legacy images and default formatter continue working', () => {
  const job = readJob(fixture({htmlFile:null, inlineImages:[], type:undefined, content:'导语。\n\n正文。', images:['images/one.png']}));
  assert.equal(job.images.length, 1);
  assert.match(formatWechatHtml(job), /WECHAT_BODY_IMAGE/);
  assert.match(formatWechatHtml(job), /blockquote/);
  assert.match(formatWechatHtml(job), /#AI/);
});

test('legacy images in authored HTML require explicit body slot', () => {
  usage(() => readJob(fixture({images:['images/one.png']})));
  const source = html.replace('</section>\n', '<!--WECHAT_BODY_IMAGE--></section>\n');
  const job = readJob(fixture({images:['images/one.png']}, source));
  const result = assembleWechatHtml(job.html, job.inlineImages, new Map([['one','<img src="fixture-one">'],['two','<img src="fixture-two">']]), '<p><img src="fixture-legacy"></p>');
  assert.match(result, /fixture-legacy/);
  assert.doesNotMatch(result, /WECHAT_BODY_IMAGE/);
});

test('missing, URL, unsupported-extension and directory image paths fail', () => {
  for (const file of ['missing.png','https://example.invalid/a.png','file:///a.png','data:image/png;base64,AAAA','directory.png','bad.txt']) {
    usage(() => readJob(fixture({inlineImages:[{id:'one',file},{id:'two',file:'images/two.png'}]})));
  }
});

test('HTML paths are local regular UTF-8 files', () => {
  for (const htmlFile of ['missing.html','https://example.invalid/a.html','directory.png','images/one.png']) usage(() => readJob(fixture({htmlFile})));
  const invalid = path.join(root, 'invalid.html'); fs.writeFileSync(invalid, Buffer.from([0xff,0xfe,0x80]));
  usage(() => readJob(fixture({htmlFile:invalid})));
});

test('unbound, duplicate, absent and misspelled placeholders fail', () => {
  usage(() => readJob(fixture({inlineImages:[manifest[0]]})));
  usage(() => readJob(fixture({}, html.replace('<!--WECHAT_INLINE_IMAGE:one-->',''))));
  usage(() => readJob(fixture({}, html.replace('<!--WECHAT_INLINE_IMAGE:one-->','<!--WECHAT_INLINE_IMAGE:one--><!--WECHAT_INLINE_IMAGE:one-->'))));
  usage(() => readJob(fixture({}, html.replace('WECHAT_INLINE_IMAGE:one','WECHAT_INLINE_IMAGE: one'))));
  usage(() => readJob(fixture({inlineImages:[manifest[0],manifest[0]]})));
  usage(() => readJob(fixture({inlineImages:[{id:'bad id',file:'images/one.png'}]})));
});

test('AI updates cannot silently degrade to image-free or text-only drafts', () => {
  usage(() => readJob(fixture({htmlFile:null, inlineImages:[], content:'正文'})));
  usage(() => readJob(fixture({inlineImages:[]}, '<section style="color:#222"><span leaf="">正文</span></section>')));
  usage(() => readJob(fixture({type:undefined, requireInlineImages:true, htmlFile:null, inlineImages:[], content:'正文'})));
});

test('unsafe wrappers, scripts, event handlers and preexisting img URLs are refused', () => {
  for (const extra of ['<script>alert(1)</script>','<img src="https://example.invalid/fake.png">','<img src="images/one.png">','<div>bad</div>','<span onclick="alert(1)">bad</span>']) {
    usage(() => readJob(fixture({}, html.replace('第二节。', extra))));
  }
  usage(() => readJob(fixture({}, '<html><body>' + html + '</body></html>')));
});

test('missing upload results and unresolved slots are fatal, not text-only fallbacks', () => {
  const job = readJob(fixture());
  assert.throws(() => assembleWechatHtml(job.html, job.inlineImages, new Map()), e => e.code === 'UPLOAD_FAILED');
  assert.throws(() => assembleWechatHtml(job.html, [], new Map()), e => e.code === 'UPLOAD_FAILED');
});

test('preflight counts legacy plus section images and uses actual HTML text length', () => {
  const job = readJob(fixture());
  assert.ok(preflight('wechat', {...job, images:Array(20).fill(job.inlineImages[0].file)}).errors.some(s => /22/.test(s)));
  assert.ok(preflight('wechat', {...job, html:'<section>' + '字'.repeat(20001) + '</section>'}).errors.some(s => /20001/.test(s)));
});

test('runtime rich readback rejects stripped styles or missing images; generated JS parses offline', async () => {
  const page = {waitFor:async code => { new vm.Script(code); return true; }, eval:async code => { new vm.Script(code); return {ok:false,missingStyles:['color:rgb(34, 34, 34)']}; }};
  await assert.rejects(verifyRichBody(page, html), e => e.code === 'PAGE_CHANGED');
  page.eval = async code => { new vm.Script(code); return {ok:true,images:2,missingStyles:[]}; };
  assert.equal((await verifyRichBody(page, html)).images, 2);
});

test('section uploads are serial, use local files and clean transient mapping state', async () => {
  const calls = [], cleaned = [];
  let current = null, count = 0;
  const page = {
    eval:async code => {
      new vm.Script(code);
      if (code.includes('length || 0')) return count;
      if (code.includes('input[type=file]')) return 'input[data-wx-img-input="1"]';
      if (code.includes('return clone.outerHTML')) return '<img src="fixture-' + path.basename(current) + '">';
      if (code.startsWith('delete ')) cleaned.push(current);
      return null;
    },
    clickByAx:async () => {},
    upload:async (selector, files) => { assert.equal(files.length,1); current=files[0]; calls.push(current); count++; },
    waitFor:async code => { new vm.Script(code); return true; },
  };
  const job = readJob(fixture());
  const mapped = await uploadInlineImages(page, job.inlineImages);
  assert.deepEqual(calls, job.inlineImages.map(im => im.file));
  assert.deepEqual([...mapped.keys()], ['two','one']);
  assert.equal(cleaned.length,2);
});

test('savedAsDraft stays gated by explicit save confirmation', async () => {
  let calls = 0;
  const page = {eval:async code => { new vm.Script(code); calls++; if (code.includes('clicked: true')) return {clicked:true}; return '保存成功'; }, waitFor:async () => false};
  await assert.rejects(saveDraft(page), e => e.code === 'PUBLISH_FAILED' && e.savedAsDraft === false);
  page.waitFor = async () => true;
  assert.equal(await saveDraft(page), '保存成功');
  assert.ok(calls >= 4);
});

test('CLI check validates offline without creating a data/profile directory or claiming save success', () => {
  const sentinel = path.join(root, 'must-not-create-data');
  const cli = fileURLToPath(new URL('../wechat.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'check', '--job', fixture()], {encoding:'utf8', env:{...process.env,PUBLISH_SKILL_DATA:sentinel}});
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.offline, true);
  assert.equal(report.ok, true);
  assert.equal(report.bodyImageCount, 2);
  assert.deepEqual(report.inlineImageIds, ['two','one']);
  assert.equal(Object.hasOwn(report, 'savedAsDraft'), false);
  assert.equal(fs.existsSync(sentinel), false);
});

test('identity/port guard, explicit saveDraft and CLI finally cleanup are unchanged from backups', () => {
  const scripts = fileURLToPath(new URL('../', import.meta.url));
  const same = (relative, start, end) => {
    const file = path.join(scripts, relative);
    const before = fs.readFileSync(file + '.before-rich-html-20261113-1901','utf8');
    const after = fs.readFileSync(file,'utf8');
    const section = source => { const a=source.indexOf(start); assert.ok(a>=0); const b=source.indexOf(end,a); assert.ok(b>a); return source.slice(a,b); };
    assert.equal(section(after),section(before), relative + ' protected guard changed');
  };
  same('lib/wechat.mjs','export async function ensureBrowser','/** 关掉');
  same('lib/wechat.mjs','async function makeCover','/** 封面是否');
  same('lib/wechat.mjs','export async function saveDraft','export async function publish');
  same('wechat.mjs','  } finally {\n    try {','  process.exit(exitCode)');
});

test('coverFromBody is explicit boolean, preserved by readJob and requires a body image', () => {
  assert.equal(readJob(fixture({coverFromBody:true})).coverFromBody, true);
  assert.equal(readJob(fixture()).coverFromBody, false);
  usage(() => readJob(fixture({coverFromBody:'true'})));
  const job = readJob(fixture({coverFromBody:true, htmlFile:null, inlineImages:[], type:undefined, content:'正文'}));
  assert.ok(preflight('wechat',job).errors.some(s=>s.includes('coverFromBody')));
});

function coverPage({noImage=false, missingStage=-1, applied=true, source='https://mmbiz.qpic.cn/sz_mmbiz_png/test-fixture-first/0', derived=source, beforeKeys=[]} = {}) {
  let stage=0; const clicks=[]; const expressions=[];
  // Mock-only page. This fixture never performs network requests or supplies runtime assets.
  const finalCover={previewCount:1,cardCount:1,previewKeys:[derived],cardKeys:[derived],src:derived};
  const outcomes=[{x:1,y:1},{x:2,y:2},{x:3,y:3},true,{x:4,y:4},finalCover];
  return {clicks,expressions,
    eval:async code=>{new vm.Script(code);expressions.push(code);if(code.includes('dialogRootCount:'))return vm.runInNewContext(code,{URL,document:{querySelectorAll:()=>[]},getComputedStyle:()=>({})});if(code.includes('return readCoverState();'))return {previewCount:beforeKeys.length,cardCount:beforeKeys.length,previewKeys:beforeKeys,cardKeys:beforeKeys};if(code.includes('im.complete'))return noImage?null:source;if(code.includes('scrollIntoView'))return {x:0,y:0};return applied;},
    screenshot:async file=>fs.writeFileSync(file,png),
    waitFor:async code=>{new vm.Script(code);expressions.push(code);const current=stage++;return current===missingStage?null:outcomes[current];},
    clickAt:async (x,y)=>{clicks.push([x,y]);},
  };
}

test('explicit body cover uses visible menu, matching first-image thumbnail, next, confirm and verified preview', async () => {
  const page=coverPage();
  assert.deepEqual(await selectCoverFromBody(page),{source:'body-first-image',bodyImageIndex:0,coverVisualVerification:{verified:true,method:'exact-source',previewAndCardAgree:true}});
  assert.deepEqual(page.clicks,[[0,0],[1,1],[2,2],[3,3],[4,4]]);
  assert.ok(page.expressions.some(s=>s.includes('.js_selectCoverFromContent')));
  assert.ok(page.expressions.some(s=>s.includes('key(src)===key(')&&s.includes('span.appmsg_content_img.cover')));
  assert.ok(page.expressions.some(s=>s.includes('下一步')));
  assert.ok(page.expressions.some(s=>s.includes('确认')));
  assert.ok(page.expressions.some(s=>s.includes('key(src)===key(')));
  assert.ok(page.expressions.every(s=>!s.includes('js_aiImage')));
});

test('explicit body cover fails closed on absent image, missing UI stages or unverified applied cover', async () => {
  await assert.rejects(selectCoverFromBody(coverPage({noImage:true})),e=>e.code==='UPLOAD_FAILED');
  for(const stage of [0,1,2,3,4,5]) await assert.rejects(selectCoverFromBody(coverPage({missingStage:stage}),{diagnosticDir:root}),e=>['PAGE_CHANGED','UPLOAD_FAILED'].includes(e.code));
  await assert.rejects(selectCoverFromBody(coverPage({applied:false}),{diagnosticDir:root}),e=>e.code==='UPLOAD_FAILED');
});

test('cover failure diagnostics preserve public CDN resize paths but never query credentials or nonpublic URLs', async () => {
  const make=(tag,cls,text='',src='',bg='none')=>({tagName:tag,className:cls,innerText:text,src,bg,getAttribute:()=>src,getBoundingClientRect:()=>({x:10,y:20,width:100,height:80}),closest:()=>null});
  const img=make('IMG','cover-image','','https://mmbiz.qpic.cn/asset/640?token=secret&wx_fmt=png');
  const background=make('DIV','cover-thumb','token=secret','','url("https://mmbiz.qpic.cn/asset/300?auth=secret")');
  const privateImage=make('IMG','cover-image','','https://mp.weixin.qq.com/cgi-bin/private?token=secret');
  const userInfo=make('IMG','cover-image','','https://user:secret@mmbiz.qpic.cn/asset/0');
  const dialog=make('DIV','weui-desktop-dialog__wrp','从正文选择 下一步 ticket=secret');
  const children=[img,background,privateImage,userInfo]; dialog.querySelectorAll=()=>children;
  const page={screenshot:async file=>fs.writeFileSync(file,png),eval:async code=>vm.runInNewContext(code,{URL,document:{querySelectorAll:selector=>selector.startsWith('[role=')?[dialog]:children},getComputedStyle:el=>({display:'block',visibility:'visible',opacity:'1',backgroundImage:el.bg})})};
  const result=await captureCoverFailure(page,'https://mmbiz.qpic.cn/asset/0?access_token=secret',{diagnosticDir:root});
  assert.ok(fs.existsSync(result.shot)); assert.ok(fs.existsSync(result.diagnostic));
  const text=fs.readFileSync(result.diagnostic,'utf8');const report=JSON.parse(text);
  assert.equal(report.firstBodySrc,'https://mmbiz.qpic.cn/asset/0');
  assert.equal(report.dialogs[0].media[0].src,'https://mmbiz.qpic.cn/asset/640');
  assert.deepEqual(report.dialogs[0].media[1].backgroundImages,['https://mmbiz.qpic.cn/asset/300']);
  assert.doesNotMatch(text,/secret|mp\.weixin\.qq\.com|user:/);
  assert.ok(text.includes('[non-public image URL withheld]'));
});

test('thumbnail failure attaches safe artifacts but performs no retry or further UI action', async () => {
  const page=coverPage({missingStage:1});
  page.screenshot=async file=>fs.writeFileSync(file,png);
  await assert.rejects(selectCoverFromBody(page,{diagnosticDir:root}),e=>e.code==='PAGE_CHANGED'&&fs.existsSync(e.shot)&&fs.existsSync(e.diagnostic));
  assert.deepEqual(page.clicks,[[0,0],[1,1]]);
});

test('observed picker CSS-background spans match only the unique exact first-body source', async () => {
  // Structure/source from 2026-11-13 current cover failure evidence; public CDN source, no credentials.
  const source='https://mmbiz.qpic.cn/sz_mmbiz_png/umc9O9e6XiaeFS0K0uR36mzQxeXGoicSicDFcgaCfCZ4Xrmdl1tlibOHYmSFl9obDvEOFyPM8W3C4vL5x1C8FYnahyXKp4zIuxwXMsOFziafJWcY/0';
  const page=coverPage({source}); await selectCoverFromBody(page);
  const expression=page.expressions.find(s=>s.includes("querySelectorAll('img[src],span.appmsg_content_img.cover')"));
  assert.ok(expression);
  const span=(src=source,patch={})=>({tagName:'SPAN',className:'appmsg_content_img cover',bg:'url("'+src+'")',getBoundingClientRect:()=>({x:276,y:356,width:115,height:115}),...patch});
  const first=span(); const other=span(source.replace('/0','/640'));
  let nodes=[first,other,span(source+'-other'),span(source+'-another')];
  const picker={innerText:'选择图片 请从正文插入的图片和视频封面中选择封面 下一步 取消',getBoundingClientRect:()=>({x:231,y:185,width:960,height:537}),querySelectorAll:()=>nodes.filter(el=>el.tagName==='IMG'||(el.tagName==='SPAN'&&/\bappmsg_content_img\b/.test(el.className)&&/\bcover\b/.test(el.className)))};
  // Outer dialog wrapper and inner dialog return the SAME actual nodes, as the current UI does.
  const context={URL,document:{querySelectorAll:()=>[picker,picker]},getComputedStyle:el=>({display:el.hidden?'none':'block',visibility:'visible',opacity:'1',backgroundImage:el.bg||'none'})};
  const run=()=>vm.runInNewContext(expression,context);
  const selected=run(); assert.equal(selected.x,333.5);assert.equal(selected.y,413.5);
  nodes=[other];assert.equal(run(),null); // Do not normalize /640 to /0.
  nodes=[first,span()];assert.equal(run(),null); // Two real elements, unlike nested-root duplicates.
  nodes=[span(source,{bg:'url("'+source+'"), url("'+source+'-other")'})];assert.equal(run(),null);
  nodes=[span(source,{className:'unrelated-rectangle'})];assert.equal(run(),null);
  nodes=[span(source,{hidden:true})];assert.equal(run(),null);
  nodes=[{...span(),tagName:'IMG',src:source}];assert.equal(run().x,333.5); // Legacy img path remains supported.
  nodes=[first,{...span(),tagName:'IMG',src:source}];assert.equal(run(),null); // Union remains fail-closed.
});

test('later next/crop/confirm/applied-preview failures attach stage-specific diagnostics', async () => {
  for(const [stage,label] of [[2,'body-cover-next'],[3,'body-cover-crop'],[4,'body-cover-confirm'],[5,'body-cover-applied-preview']]) {
    const page=coverPage({missingStage:stage});
    await assert.rejects(selectCoverFromBody(page,{diagnosticDir:root}),e=>{
      assert.ok(fs.existsSync(e.shot));assert.ok(fs.existsSync(e.diagnostic));
      assert.equal(JSON.parse(fs.readFileSync(e.diagnostic,'utf8')).stage,label);return true;
    });
  }
});

test('derived JPEG cover requires newly applied agreeing preview/card and successful visual proof', async () => {
  const source='https://mmbiz.qpic.cn/sz_mmbiz_png/test-fixture-first/0';
  const derived='https://mmbiz.qpic.cn/sz_mmbiz_jpg/test-fixture-cropped/0';
  const calls=[];
  const compare=async (page,reference,actual,opts)=>{calls.push({reference,actual,opts});return {verified:true,meanAbsoluteError:1,errorRatio:0.05,changedFraction:0.01,referenceScreenshot:'fixture-reference.png',actualScreenshot:'fixture-actual.png'};};
  const result=await selectCoverFromBody(coverPage({source,derived}),{diagnosticDir:root,compareRenderedSources:compare});
  assert.equal(result.coverVisualVerification.method,'rendered-derived-image');
  assert.equal(result.coverVisualVerification.verified,true);
  assert.equal(result.coverVisualVerification.newlyApplied,true);
  assert.equal(result.coverVisualVerification.referenceScreenshot,'fixture-reference.png');
  assert.equal(calls.length,1);assert.equal(calls[0].reference,source);assert.equal(calls[0].actual,derived);
  assert.equal(calls[0].opts.width,235);assert.equal(calls[0].opts.height,100);assert.equal(calls[0].opts.fit,'cover');assert.ok(path.isAbsolute(calls[0].opts.prefix));
  let exactCompared=false;
  const exact=await selectCoverFromBody(coverPage({source}),{diagnosticDir:root,compareRenderedSources:async()=>{exactCompared=true;throw Error('must not compare');}});
  assert.equal(exact.coverVisualVerification.method,'exact-source');assert.equal(exactCompared,false);
  await assert.rejects(selectCoverFromBody(coverPage({source,derived,beforeKeys:[derived]}),{diagnosticDir:root,compareRenderedSources:compare}),e=>e.code==='UPLOAD_FAILED'&&JSON.parse(fs.readFileSync(e.diagnostic,'utf8')).stage==='body-cover-stale-preview');
  assert.equal(calls.length,1); // No proof can bypass a stale preexisting derived preview.
  await assert.rejects(selectCoverFromBody(coverPage({source,derived}),{diagnosticDir:root,compareRenderedSources:async()=>({verified:false,meanAbsoluteError:30})}),e=>e.code==='UPLOAD_FAILED'&&e.coverVisualVerification.verified===false);
  await assert.rejects(selectCoverFromBody(coverPage({source,derived}),{diagnosticDir:root,compareRenderedSources:async()=>{throw Error('proof unavailable');}}),e=>e.code==='UPLOAD_FAILED');
});

test('applied cover DOM requires exactly one public same-host preview and card with identical identity', async () => {
  const source='https://mmbiz.qpic.cn/sz_mmbiz_png/test-fixture-first/0';
  const derived='https://mmbiz.qpic.cn/sz_mmbiz_jpg/test-fixture-cropped/0';
  const page=coverPage({source});await selectCoverFromBody(page);
  const expression=page.expressions.find(s=>s.includes('src:state.previewKeys[0]'));
  const node=(src)=>({bg:'url("'+src+'")',querySelectorAll:()=>[],getBoundingClientRect:()=>({x:20,y:20,width:235,height:100})});
  let previews=[node(derived)],cards=[node(derived)];
  const context={URL,document:{querySelectorAll:selector=>selector==='.setting-group__cover .js_cover_preview_new'?previews:selector==='.js_appmsg_thumb_new'?cards:[]},getComputedStyle:el=>({display:'block',visibility:'visible',opacity:'1',backgroundImage:el.bg})};
  const run=()=>vm.runInNewContext(expression,context);
  assert.equal(run().src,derived);
  cards=[node(source)];assert.equal(run(),false);
  cards=[node(derived),node(derived)];assert.equal(run(),false);
  cards=[node(derived)];previews=[node(derived),node(derived)];assert.equal(run(),false);
  previews=[node('https://evil.invalid/image/0')];cards=[node('https://evil.invalid/image/0')];assert.equal(run(),false);
  previews=[node('https://user:secret@mmbiz.qpic.cn/asset/0')];cards=[node('https://user:secret@mmbiz.qpic.cn/asset/0')];assert.equal(run(),false);
  previews=[node(derived)];cards=[];assert.equal(run(),false);
});

test('publish refuses submit and missing images before browser access', async () => {
  await assert.rejects(publish({submit:true}), e => e.code === 'USAGE');
  await assert.rejects(publish({title:'标题',content:'正文',images:[],type:'ai-update'}), e => e.code === 'USAGE');
});

// Header-only PNG: enough for dimension parsing, never decoded or uploaded.
function pngHeader(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  return b;
}

test('cover plan auto-picks the 21:9 body image and refuses a strip crop', () => {
  fs.writeFileSync(path.join(root, 'images', 'hero.png'), pngHeader(2100, 900));
  fs.writeFileSync(path.join(root, 'images', 'tall.png'), pngHeader(1200, 1347));
  assert.deepEqual(imageDimensions(path.join(root, 'images', 'tall.png')), {width:1200, height:1347, format:'png'});
  const both = '<section><span leaf="">正文</span><!--WECHAT_INLINE_IMAGE:tall--><p><span leaf="">中段</span></p><!--WECHAT_INLINE_IMAGE:hero--></section>';
  const order = [{id:'tall',file:'images/tall.png'},{id:'hero',file:'images/hero.png'}];
  const job = readJob(fixture({coverFromBody:true, inlineImages:order}, both));
  const plan = coverPlan(job);
  assert.equal(plan.error, undefined);
  assert.equal(path.basename(plan.file), 'hero.png');
  assert.ok(Math.abs(plan.ratio - 2.35) < 0.05);
  assert.deepEqual(preflight('wechat', job).errors, []);
  const explicit = readJob(fixture({coverFromBody:true, coverImage:'images/hero.png', inlineImages:order}, both));
  assert.equal(path.basename(coverPlan(explicit).file), 'hero.png');
  const onlyTall = readJob(fixture({coverFromBody:true, inlineImages:[order[0]]}, '<section><span leaf="">正文</span><!--WECHAT_INLINE_IMAGE:tall--></section>'));
  assert.match(coverPlan(onlyTall).error, /21:9/);
  assert.ok(preflight('wechat', onlyTall).errors.some((s) => /21:9/.test(s)));
  const notUploaded = readJob(fixture({coverFromBody:true, coverImage:'images/one.png', inlineImages:order}, both));
  assert.match(coverPlan(notUploaded).error, /coverImage/);
});

test('post-save draft list check matches the full title and normalizes NBSP', async () => {
  const prev = process.env.PUBLISH_SKILL_DATA;
  process.env.PUBLISH_SKILL_DATA = root;
  const title = '从端侧模型到业务流程：三条 AI 更新，执行边界在哪？';
  const page = (titles) => ({exists:async()=>true, waitFor:async()=>true, type:async()=>{}, pressEnter:async()=>{}, eval:async()=>titles, screenshot:async()=>{throw new Error('mock has no artifacts');}});
  try {
    const hit = await verifyDraftInList(page([title.replace(/ /g, '\u00a0'), '另一篇']), title);
    assert.equal(hit.matches, 1);
    assert.equal(hit.verified, true);
    assert.equal(hit.screenshot, null);
    const miss = await verifyDraftInList(page(['别的标题']), title);
    assert.equal(miss.matches, 0);
    assert.equal(miss.verified, false);
  } finally {
    if (prev === undefined) delete process.env.PUBLISH_SKILL_DATA;
    else process.env.PUBLISH_SKILL_DATA = prev;
  }
});
