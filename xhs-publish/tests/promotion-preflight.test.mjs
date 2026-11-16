// Offline integration only: synthetic files, injected fake editor/renderers, no real CDP/profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readJob, codeToExit } from '../scripts/lib/util.mjs';
import { prepareEditJob } from '../scripts/lib/edit-job.mjs';
import { buildPromotionPreflight, assertPromotionReady, retainedImagesHash } from '../scripts/lib/promotion-preflight.mjs';
import { publish, publishImage, publishText } from '../scripts/lib/xhs.mjs';
import { editNote } from '../scripts/lib/note-edit.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const temp = fs.mkdtempSync(path.join(root, '.offline-promotion-'));
test.after(() => {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(root));
  assert.ok(path.basename(temp).startsWith('.offline-promotion-'));
  assert.equal(fs.realpathSync(temp), path.resolve(temp));
  fs.rmSync(temp, { recursive:true, force:true });
});
const png = path.join(temp, 'blank.png');
const png2 = path.join(temp, 'blank2.png');
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=', 'base64'));
fs.writeFileSync(png2, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inspection = { visualChecked:true, visibleText:'', conclusion:'no-outbound-promotion', reviewer:'synthetic-test-author',
  rationale:'离线合成一像素空白图，未含文字、联系方式、二维码或站外推广元素。' };
const imageReview = file => ({ ...inspection, sha256:hash(file) });
const neutral = () => ({ title:'产品观察', content:'Google、Gemini、支付宝和GitHub的中性技术资料汇总。', topics:[],
  images:[png], promotionReview:{images:[imageReview(png)]}, submit:false });
const cta = 'Gemini 4 更便宜，可以直接换过去试。';
const errorCode = error => error.code === 'CONTENT_REVIEW_REQUIRED' && error.promotionPreflight?.status !== 'clear';
let sequence = 0;
function parsed(raw) {
  const file = path.join(temp, `job-${++sequence}.json`);
  fs.writeFileSync(file, JSON.stringify(raw));
  return { job:readJob(file), file, original:fs.readFileSync(file, 'utf8') };
}
function reviewText(job, options = {}) {
  const report = buildPromotionPreflight(job, options);
  job.promotionReview = { ...job.promotionReview, text:[...new Set(report.findings.filter(f => f.severity === 'review').map(f => f.findingHash))]
    .map(findingHash => ({ findingHash, decision:'neutral-reporting', reviewer:'synthetic-test-author',
      rationale:'此处为合成测试中的中性来源和事实说明，不包含下载、注册或转移联系方式的招徕。' })) };
}
const NOTE = 'offline1234567890';
const EDIT_URL = `https://creator.xiaohongshu.com/publish/update?noteId=${NOTE}`;
const oldImages = [{ src:'https://fake.xhscdn.com/offline-old', loaded:true }];
function editor({ content = '保留的中性正文。' } = {}) {
  const events = [];
  let url = 'https://creator.xiaohongshu.com/new/note-manager';
  const state = { ready:true, url:EDIT_URL, noteId:NOTE, title:'原题', content, topics:[], images:structuredClone(oldImages),
    imageCount:1, imageStatus:'1/18', titleSelector:'#title', bodySelector:'#body' };
  const page = {
    async goto(next) { events.push('goto'); url=next; },
    async clickAt() { events.push('open-editor'); url=EDIT_URL; },
    async eval(expression) {
      if(expression === 'location.href') return url;
      if(expression.startsWith('(function managerCardsDom')) return [{ titles:['原题'], lines:['原题'], dates:[], actions:[{ x:1,y:1,href:EDIT_URL }] }];
      if(expression.startsWith('(function editorSnapshotDom')) return { ...structuredClone(state), url };
      throw new Error('unexpected fake expression: '+expression.slice(0,50));
    },
    async screenshot() { return null; },
    async type(selector,value) { events.push('type'); state[selector==='#title'?'title':'content']=value; },
    async upload() { events.push('upload'); throw new Error('unexpected upload'); },
    async pressEscape() {},
  };
  const deps = { ensureBrowser:async()=>{events.push('connect');return page;}, assertAccount:async()=>events.push('identity'),
    artifactsDir:()=>temp, sleep:async()=>{}, now:()=>0 };
  return { events, deps, state };
}
function editInput(edit = { title:'新题' }, extra = {}) { return { edit:{ targetTitle:'原题', ...edit }, ...extra }; }
const retainedReview = () => ({ ...inspection, noteId:NOTE, sha256:retainedImagesHash(NOTE, oldImages) });

// Text inventory, raw provenance and concrete, stale-safe human decisions.
test('neutral brands and repositories are not violations by themselves', () => {
  const report = buildPromotionPreflight(neutral());
  assert.equal(report.status, 'clear');
  assert.equal(report.guarantee, false); assert.equal(report.heuristic, true);
});
test('URL removal does not hide raw call-to-action and source file is unchanged', () => {
  const { job, file, original } = parsed({ ...neutral(), content:'资料：请前往 https://example.com 领取。' });
  assert.ok(!job.content.includes('example.com'));
  const report = buildPromotionPreflight(job);
  assert.equal(report.status, 'blocked');
  assert.ok(report.findings.some(f => f.surface === 'raw.content' && f.severity === 'block'));
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});
test('JSON claimed original snapshot cannot replace the WeakMap original', () => {
  const { job } = parsed({ ...neutral(), content:cta, promotionOriginal:{ content:'中性' } });
  job.content='中性'; job.original={ content:'中性' };
  assert.equal(buildPromotionPreflight(job).status, 'blocked');
});
for (const [name, change] of [
  ['caption', { caption:cta }], ['appendix', { appendix:['普通段落',cta] }],
  ['projects', { projects:[{ repo:'owner/repo', intro:cta }] }],
  ['intro heading/footer', { githubIntro:{ enabled:true,title:cta,footer:cta,projects:[] } }],
  ['overflow heading', { overflow:{ heading:cta } }], ['overflow body', { overflowText:[cta] }],
  ['main line', { githubLayout:{ mainLine:cta } }],
]) test(`covers ${name} before conversion to images`, () => {
  assert.equal(buildPromotionPreflight({ ...neutral(), ...change }).status, 'blocked');
});
test('review requires per-finding specific record; booleans cannot bypass', () => {
  const job={ ...neutral(), content:'Google与Gemini提供免费额度，范围仍需核对。', promotionReview:true };
  assert.equal(buildPromotionPreflight(job).status, 'needs_review');
  job.promotionReview={images:[imageReview(png)]};
  reviewText(job);
  assert.equal(buildPromotionPreflight(job).status, 'clear');
  job.promotionReview.text.forEach(row=>row.rationale='已检查');
  assert.equal(buildPromotionPreflight(job).status, 'needs_review');
});
test('block cannot be overridden even with a matching neutral-reporting declaration', () => {
  const job={ ...neutral(), content:cta };
  const report=buildPromotionPreflight(job);
  job.promotionReview={ text:report.findings.map(f=>({ findingHash:f.findingHash,decision:'neutral-reporting',reviewer:'tester',rationale:inspection.rationale })) };
  assert.equal(buildPromotionPreflight(job).status, 'blocked');
});
test('changing content outside an excerpt invalidates the previous text decision', () => {
  const job={ ...neutral(),content:'Google与Gemini提供免费额度。\n\n'+ '中性补充。'.repeat(50) };
  reviewText(job);assert.equal(buildPromotionPreflight(job).status,'clear');
  job.content+='追加事实说明。';
  assert.equal(buildPromotionPreflight(job).status,'needs_review');
});
test('double prepareEditJob retains the original explicit body before URL sanitizing', () => {
  const job=prepareEditJob(prepareEditJob(editInput({ content:'请前往 https://example.com 领取。' })));
  assert.ok(!job.edit.content.includes('example.com'));
  assert.equal(buildPromotionPreflight(job,{kind:'edit',phase:'known'}).status,'blocked');
});
test('edit locators and ignored legacy text never become reviewed replacement content', () => {
  const job=prepareEditJob({ title:cta, content:cta, caption:cta, topics:[cta], edit:{ title:'中性新题' } });
  const report=buildPromotionPreflight(job,{kind:'edit',phase:'known'});
  assert.equal(report.status,'clear'); assert.equal(report.pendingExisting,true);
  assert.ok(report.surfaces.every(s=>!s.name.includes('targetTitle')));
});

// Image declarations are honest claims bound to bytes, not OCR or pixel proof.
test('missing image inspection requires review and reports actual hash', () => {
  const report=buildPromotionPreflight({ ...neutral(),images:[png],promotionReview:undefined });
  assert.equal(report.status,'needs_review');assert.equal(report.imageInspection.images[0].sha256,hash(png));
  assert.equal(report.imageInspection.automaticOcr,false);assert.equal(report.imageInspection.scriptViewedImages,false);
});
test('one exact byte-bound declaration permits only its matching image', () => {
  const job={ ...neutral(),images:[png],promotionReview:{images:[imageReview(png)]} };
  assert.equal(buildPromotionPreflight(job).status,'clear');
  job.images=[png2];assert.equal(buildPromotionPreflight(job).status,'needs_review');
});
test('dangerous visible image text blocks despite a human no-promotion conclusion', () => {
  const job={ ...neutral(),images:[png],promotionReview:{images:[{...imageReview(png),visibleText:cta}]} };
  assert.equal(buildPromotionPreflight(job).status,'blocked');
});
test('image review booleans, duplicate declarations and missing transcripts do not pass', () => {
  for(const images of [true,[imageReview(png),imageReview(png)],[{...imageReview(png),visibleText:undefined}]]) {
    assert.equal(buildPromotionPreflight({...neutral(),images:[png],promotionReview:{images}}).status,'needs_review');
  }
});
test('offline generated images are explicitly pending, never silently called inspected', () => {
  const report=buildPromotionPreflight({...neutral(),overflowText:['普通图内文字']});
  assert.equal(report.pendingGenerated,true);assert.equal(report.status,'needs_review');
  assert.equal(buildPromotionPreflight({...neutral(),overflowText:['普通图内文字']},{phase:'known'}).status,'clear');
});
test('plain text without local cards is pending offline and blocked before platform layout', async () => {
  const job={...neutral(),title:'中性记录',content:'这是一段普通的技术记录。',images:[],promotionReview:undefined};
  const report=buildPromotionPreflight(job);
  assert.equal(report.status,'needs_review');assert.equal(report.pendingGenerated,true);
  assert.equal(report.summary.block,0);assert.equal(report.summary.review,0);
  const events=[];
  await assert.rejects(publish(job,{},{prepareOverflow:async()=>events.push('local-check'),prepareGithubIntro:async()=>{},publishText:async()=>events.push('browser')}),errorCode);
  assert.deepEqual(events,['local-check']);
});
test('direct legacy longform stays blocked even if caller supplies unused reviewed local images', async () => {
  await assert.rejects(publishText(neutral(),{account:null}),error=>errorCode(error)&&error.promotionPreflight.pendingPlatformLayout);
});
test('a title target plus body switch instruction is reviewed in the combined visible context', () => {
  const report=buildPromotionPreflight({...neutral(),title:'Gemini',content:'更便宜，可以直接换过去试。'});
  assert.equal(report.status,'blocked');
});
test('retained-image source binding covers same ID and exact ordered source list', () => {
  assert.notEqual(retainedImagesHash(NOTE,oldImages),retainedImagesHash('another-note',oldImages));
  const two=[...oldImages,{src:'https://fake.xhscdn.com/second'}];
  assert.notEqual(retainedImagesHash(NOTE,two),retainedImagesHash(NOTE,[...two].reverse()));
  const job=prepareEditJob(editInput());
  const options={kind:'edit',phase:'final',visible:{title:'新题',content:'中性正文',topics:[]},retained:{noteId:NOTE,images:oldImages}};
  assert.equal(buildPromotionPreflight(job,options).status,'needs_review');
  job.promotionReview={retainedImages:retainedReview()};
  assert.equal(buildPromotionPreflight(job,options).status,'clear');
  options.retained.noteId='other';assert.equal(buildPromotionPreflight(job,options).status,'needs_review');
});

// Real entrypoints, with only isolated fake renderers/pages to avoid Chrome on regressions.
test('risky post stops before either renderer or publish/browser dispatch', async () => {
  const events=[];
  const deps=Object.fromEntries(['prepareOverflow','prepareGithubIntro','publishImage','publishText'].map(key=>[key,async()=>{events.push(key);return{};} ]));
  await assert.rejects(publish({...neutral(),content:cta,overflowText:[cta]},{},deps),errorCode);
  assert.deepEqual(events,[]);
});
test('post final gate checks newly rendered image before browser dispatch', async () => {
  const events=[];
  await assert.rejects(publish({...neutral(),overflowText:['中性详情']},{},{
    prepareOverflow:async job=>{events.push('local-render');job.images=[png2];},
    prepareGithubIntro:async()=>{}, publishImage:async()=>events.push('browser'),
  }),errorCode);
  assert.deepEqual(events,['local-render']);
});
test('direct image/text exports are guarded too, without a real account or browser', async () => {
  for(const entry of [publishImage,publishText]) await assert.rejects(entry({...neutral(),content:cta},{account:null}),errorCode);
});
test('explicit risky edit fails before fake connect (also submit:false)', async () => {
  const f=editor();await assert.rejects(editNote(editInput({content:cta},{submit:false}),{},f.deps),errorCode);
  assert.deepEqual(f.events,[]);
});
test('retained existing body is reviewed before any type/upload/save without rewriting it', async () => {
  const f=editor({content:cta});
  await assert.rejects(editNote(editInput(),{},f.deps),errorCode);
  assert.equal(f.state.content,cta);
  assert.equal(f.events.some(e=>['type','upload','save'].includes(e)),false);
  assert.ok(f.events.includes('open-editor'));
});
test('retained images lacking review stop before type even for clean retained body', async () => {
  const f=editor();await assert.rejects(editNote(editInput(),{},f.deps),errorCode);
  assert.ok(!f.events.includes('type'));
});
test('reviewed retained images permit dry-run while explicit submit:false still blocks saving', async () => {
  const f=editor();
  const result=await editNote(editInput({title:'新题'},{submit:false,promotionReview:{retainedImages:retainedReview()}}),{submit:true},f.deps);
  assert.equal(result.submitted,false);assert.equal(result.dryRun,true);assert.equal(result.noteId,NOTE);
  assert.equal(result.promotionPreflight.status,'clear');assert.deepEqual(f.state.images,oldImages);
});
test('exit code 9 is stable and failure includes the actionable report', () => {
  assert.equal(codeToExit('CONTENT_REVIEW_REQUIRED'),9);
  assert.throws(()=>assertPromotionReady({...neutral(),content:cta}),errorCode);
});
test('offline CLI clear/required exits never open accounts/dataRoot and preserve submit:false', () => {
  for (const [raw,expected] of [[neutral(),0],[{...neutral(),images:[]},9]]) {
    const {file,original}=parsed(raw);
    const out=path.join(temp,'cli-out.json'),err=path.join(temp,'cli-err.txt');
    const output=fs.openSync(out,'w'),error=fs.openSync(err,'w');
    let result;
    try {
      // File descriptors, not child_process pipes (supported under the Windows sandbox).
      result=spawnSync(process.execPath,[path.join(root,'../scripts/xhs.mjs'),'preflight','--job',file,'--accounts-file',path.join(temp,'does-not-exist.json')],
        {stdio:['ignore',output,error],env:{...process.env,PUBLISH_SKILL_DATA:path.join(temp,'must-not-create-dataRoot')}});
    } finally {fs.closeSync(output);fs.closeSync(error);}
    if(result.error)throw result.error;
    assert.equal(result.status,expected,fs.readFileSync(err,'utf8'));
    const body=JSON.parse(fs.readFileSync(out,'utf8'));
    assert.equal(body.offlineOnly,true);assert.equal(body.promotionPreflight.status,expected?'needs_review':'clear');
    if(expected){assert.equal(body.code,'CONTENT_REVIEW_REQUIRED');assert.equal(body.promotionPreflight.pendingGenerated,true);}
    assert.equal(fs.existsSync(path.join(temp,'must-not-create-dataRoot')),false);
    assert.equal(fs.readFileSync(file,'utf8'),original);
  }
});
