// Entirely offline: fake CDP/DOM, no CLI import, no network, no profile access.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { prepareEditJob, readEditJob, preflightEditImages } from '../scripts/lib/edit-job.mjs';
import { editNote as productionEditNote, editRoute, selectNoteCard, verifyEditor, imageIdentity, managerCardsDom, editorSnapshotDom, deleteImageDom, saveStateDom } from '../scripts/lib/note-edit.mjs';
import { SkillError } from '../scripts/lib/util.mjs';
import { retainedImagesHash } from '../scripts/lib/promotion-preflight.mjs';

const testRoot=path.dirname(fileURLToPath(import.meta.url));
const runDir=fs.mkdtempSync(path.join(testRoot,'.offline-edit-'));
test.after(()=>{
  // Verify the resolved generated directory before deleting only these test artifacts.
  assert.equal(path.dirname(path.resolve(runDir)).toLowerCase(),path.resolve(testRoot).toLowerCase());
  assert.ok(path.basename(runDir).startsWith('.offline-edit-'));
  assert.equal(fs.realpathSync(runDir).toLowerCase(),path.resolve(runDir).toLowerCase());
  fs.rmSync(runDir,{recursive:true,force:true});
});
const png=path.join(runDir,'new.png');
fs.writeFileSync(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=','base64'));
const pngSecond=path.join(runDir,'second.png');
fs.writeFileSync(pngSecond,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
const NOTE='0123456789abcdef01234567';
const OTHER='76543210abcdef0123456789';
const URL_EDIT=`https://creator.xiaohongshu.com/publish/update?noteId=${NOTE}`;
const URL_MANAGER='https://creator.xiaohongshu.com/new/note-manager';
const account={alias:'ai'};
const clone=o=>structuredClone(o);
const coded=code=>e=>e instanceof SkillError&&e.code===code;
const image=(name)=>({src:`https://sns-webpic-qc.xhscdn.com/objects/${name}!thumb`,loaded:true});
const oldTopic={id:'topic-original',name:'ai'};
const initial=()=>({ready:true,url:URL_EDIT,noteId:NOTE,title:'原题',body:'原正文\n#ai',content:'原正文',topics:[clone(oldTopic)],images:[image('old1'),image('old2')],imageCount:2,imageStatus:'2/18',titleSelector:'#title',bodySelector:'#body'});
const card=(title='原题',date='2026-11-13')=>({index:0,titles:[title],lines:[title,date],dates:[date],actions:[{x:10,y:20,href:URL_EDIT,label:'编辑'}]});
// Explicit synthetic-fixture declarations, not a production skip. These 1px images
// and fake CDN sources have no visible text; new preflight tests exercise missing records.
const syntheticInspection={visualChecked:true,visibleText:'',conclusion:'no-outbound-promotion',
  reviewer:'offline-test-author',rationale:'仅用于离线测试的合成一像素空白图片，没有文字、二维码或推广入口。'};
const syntheticPromotionReview={images:[png,pngSecond].map(file=>({...syntheticInspection,sha256:preflightEditImages([file])[0].sha256})),
  retainedImages:{...syntheticInspection,noteId:NOTE,sha256:retainedImagesHash(NOTE,initial().images)}};
const editNote=(job,options,deps)=>productionEditNote({...job,promotionReview:job.promotionReview??syntheticPromotionReview},options,deps);

function fixture(options={}) {
  let url=URL_MANAGER, state=initial(), persisted=null, saved=false, tick=0, opened=false, uploaded=false;
  if(options.initialCount!==undefined)state.images=Array.from({length:options.initialCount},(_,i)=>image('old'+(i+1)));
  if(options.initialBlob)state.images[0].src='blob:https://creator.xiaohongshu.com/original-unverified';
  const events=[],sourceReferences=new Map();
  const page={
    async goto(next){events.push(['goto',next]);url=next;if(next===URL_EDIT&&saved){
      state=clone(persisted);
      if(options.savedCdn)state.images=state.images.map((i,index)=>{const src=image('saved-cdn-'+index).src;sourceReferences.set(src,sourceReferences.get(i.src));return {...i,src};});
      if(options.savedReorder)state.images.reverse();
      if(options.readback) options.readback(state);
    }}, 
    async eval(expression){
      if(expression==='location.href') return url;
      if(expression.startsWith('(function managerCardsDom')) return options.cards??[card()];
      if(expression.startsWith('(function editorSnapshotDom')) return {...clone(state),url,imageCount:state.images.length,imageStatus:`${state.images.length}/18`,ready:options.snapshotNotReady?false:true};
      if(expression.startsWith('(function imageStateDom')) return {count:options.badCount?null:state.images.length,status:`${state.images.length}/18`,images:clone(state.images),ready:!options.badCount&&!(uploaded&&options.uploading)&&state.images.every(i=>i.loaded),tile:{x:20,y:30},uploading:uploaded&&options.uploading||false,uploadInput:options.noUploadInput?false:true};
      if(expression.startsWith('(function deleteImageDom')) {events.push(['discover-image-close']);return options.closeMissing?null:{x:80,y:40};}
      if(expression.startsWith('(function saveStateDom')) return {url,notices:saved?(options.genericPostSuccess?['发布成功']:options.saveNotice?['修改成功']:[]):[],updateSuccessPage:saved&&options.updateSuccessPage===true,failure:options.saveFailure&&saved};
      if(expression.startsWith('(function editDialogDom')) return null;
      throw new Error('Unexpected offline eval: '+expression.slice(0,80));
    },
    async clickAt(x,y){
      if(!opened){events.push(['open-edit']);opened=true;url=options.openUrl??URL_EDIT;return;}
      if(x===80&&y===40){
        events.push(['delete-image','trusted-click',x,y]);
        if(!options.deleteStuck)state.images.splice(options.deleteWrongEnd?state.images.length-1:0,options.deleteDouble?2:1);
        if(options.deleteReorder)state.images.reverse();
        if(options.deleteMutateNew)state.images[state.images.length-1]=image('changed-new');
        events.push(['image-count',state.images.length]);return;
      }
      events.push(['save-click']);saved=true;persisted=clone(state);
      if(options.saveFailure||options.saveTimeout||options.saveNotice) return;
      url=options.saveUrl??URL_MANAGER;
    },
    async type(selector,value){events.push(['type',selector,value]);if(selector==='#title')state.title=value;else{state.content=value;state.topics=[];}},
    async upload(selector,files){
      events.push(['upload',...files]);uploaded=true;
      const appended=files.map((file,i)=>{const item={...image('new'+i),...(options.newNotLoaded?{loaded:false}:{}),...(options.newBlob?{src:'blob:https://creator.xiaohongshu.com/temporary-'+i}:{})};sourceReferences.set(item.src,'data:image/png;base64,'+fs.readFileSync(file).toString('base64'));return item;});
      if(options.uploadReorder)appended.reverse();
      state.images.push(...appended);
      if(options.prefixMismatch)state.images[0]=image('unexpected-original');
      if(options.uploadExtra)state.images.push(image('extra'));
      events.push(['image-count',state.images.length]);
    },
    async pressEscape(){},
    async screenshot(){throw new Error('offline: no browser screenshot');},
    async axFind(label){events.push(['ax',label]);return label==='保存修改'?[{backendDOMNodeId:123,disabled:false}]:[];},
    cdp:{async send(method){events.push(['cdp',method]);if(method==='DOM.getBoxModel') return {model:{border:[20,800,100,800,100,840,20,840]}};return {};}}
  };
  const deps={
    async ensureBrowser(){events.push(['connect']);return page;},
    async assertAccount(){events.push(['identity']);if(options.identityFailure)throw new SkillError('ACCOUNT_MISMATCH','wrong account');},
    async sleep(ms){tick+=ms;},now:()=>tick,artifactsDir:()=>runDir,
    async insertOfficialTopics(_p,_sel,names){events.push(['topics',...names]);state.topics=names.map(name=>({id:options.topicMismatch?'changed-id':name.toLowerCase()==='ai'?oldTopic.id:'id-'+name,name}));},
    async verifyTopicsHighlighted(){if(options.topicFailure)throw new SkillError('PAGE_CHANGED','topic failed');return {ok:true};},
    async compareRenderedSources(_page,referenceSrc,actualSrc,settings){
      events.push(['visual-compare',referenceSrc,actualSrc,settings.prefix]);
      const forced=options.visualMismatch||(options.beforeSaveMismatch&&settings.prefix.includes('visual-before-save'))||(options.savedMismatch&&settings.prefix.includes('visual-saved-readback'));
      const verified=!forced&&sourceReferences.get(actualSrc)===referenceSrc;
      return {verified,meanAbsoluteError:verified?0:99,errorRatio:verified?0:1,changedFraction:verified?0:1,
        referenceScreenshot:settings.prefix+'-reference.png',actualScreenshot:settings.prefix+'-actual.png'};
    }
  };
  return {page,deps,events,getState:()=>state};
}
const input=(edit={},extra={})=>({account:'ai',edit:{targetTitle:'原题',date:'2026-11-13',...edit},...extra});

// Parsing/authorization and preflight are separate from browser operations.
test('legacy image-only ignores content, caption, topics and GitHub post transforms',()=>{
  const j=prepareEditJob({title:'完整原题'.repeat(10),content:'x'.repeat(5000),caption:'source',topics:['never replace'],type:'github-ranking',images:[png]});
  assert.equal(j.edit.targetTitle,'完整原题'.repeat(10));
  assert.equal(j.edit.replaceImages,true);
  for(const k of ['title','content','topics']) assert.equal(Object.hasOwn(j.edit,k),false);
});
test('nested explicit title/body/topic changes; no top-level title required',()=>{
  const j=prepareEditJob(input({title:'新题',content:'完整正文',topics:['#AI','AI'],replaceImages:false}));
  assert.deepEqual(j.edit.topics,['AI']);assert.equal(j.edit.content,'完整正文');assert.equal(j.edit.title,'新题');
});
test('normalization is idempotent and absent submit does not become a false fuse',()=>{
  const j=prepareEditJob(input({title:'新题'}));
  const second=prepareEditJob(j);assert.equal(second.submit,undefined);assert.equal(second.submitDisabled,false);
});
test('explicit submit false survives normalization; true requests saving',()=>{
  assert.equal(prepareEditJob(prepareEditJob(input({title:'新题'},{submit:false}))).submitDisabled,true);
  assert.equal(prepareEditJob(input({title:'新题'},{submit:true})).submit,true);
});
test('originalTitle alias is exact and conflicting aliases fail',()=>{
  assert.equal(prepareEditJob({originalTitle:'原题',edit:{title:'新题'}}).edit.targetTitle,'原题');
  assert.throws(()=>prepareEditJob(input({originalTitle:'另一篇',title:'新题'})),coded('USAGE'));
});
test('business dates must be valid and must not conflict',()=>{
  for(const date of ['2026-02-30','yesterday','2026-1-1']) assert.throws(()=>prepareEditJob(input({date,title:'新题'})),coded('USAGE'));
  assert.throws(()=>prepareEditJob(input({title:'新题'},{date:'2026-11-12'})),coded('USAGE'));
});
test('unsupported/ambiguous schema and over-limit updates fail',()=>{
  for(const change of [{content:'中'.repeat(1001)},{title:'中'.repeat(21)},{replaceImages:[]},{topics:['蓝V交友']},{titel:'typo'},{title:''}])
    assert.throws(()=>prepareEditJob(input(change)),coded('USAGE'));
  assert.throws(()=>prepareEditJob(input()),coded('USAGE'));
});
test('explicit content is link-cleaned only; no overflow or source fallback',()=>{
  assert.equal(prepareEditJob(input({content:'正文 https://example.com/a\n\n结尾'})).edit.content,'正文\n\n结尾');
  assert.equal(prepareEditJob(input({content:''})).edit.content,'');
});
test('readEditJob resolves relative images against job directory and leaves source job unchanged',()=>{
  const file=path.join(runDir,'legacy.json');const original=JSON.stringify({title:'原题',images:['new.png'],content:'ignored'});
  fs.writeFileSync(file,original);
  assert.equal(readEditJob(file).images[0],png);assert.equal(fs.readFileSync(file,'utf8'),original);
});
test('image preflight enforces count, extension, existence, bytes and size',()=>{
  assert.equal(preflightEditImages([png])[0].sha256.length,64);
  assert.throws(()=>preflightEditImages([]),coded('USAGE'));
  assert.throws(()=>preflightEditImages(Array(19).fill(png)),coded('USAGE'));
  const bad=path.join(runDir,'bad.png');fs.writeFileSync(bad,'not image');
  const truncated=path.join(runDir,'truncated.png');fs.writeFileSync(truncated,fs.readFileSync(png).subarray(0,24));
  const empty=path.join(runDir,'empty.png');fs.writeFileSync(empty,'');
  const gif=path.join(runDir,'image.gif');fs.copyFileSync(png,gif);
  const big=path.join(runDir,'big.png');fs.writeFileSync(big,'x');fs.truncateSync(big,32*1024*1024+1);
  for(const file of [bad,truncated,empty,gif,big,path.join(runDir,'absent.png'),runDir]) assert.throws(()=>preflightEditImages([file]),coded('USAGE'));
});

test('exact title/date selects today, never substring or first duplicate',()=>{
  const target={targetTitle:'原题',date:'2026-11-13'};
  const today=card(),yesterday=card('原题','2026-11-12');
  assert.equal(selectNoteCard([card('原题 plus'),yesterday,today],target),today);
  assert.throws(()=>selectNoteCard([card('原题 plus')],target),coded('PAGE_CHANGED'));
  assert.throws(()=>selectNoteCard([today,clone(today)],target),coded('PAGE_CHANGED'));
  assert.throws(()=>selectNoteCard([today,yesterday],{targetTitle:'原题'}),coded('PAGE_CHANGED'));
});
test('unknown dates and absent/ambiguous semantic edit actions stop safely',()=>{
  const noDate={...card(),dates:[]};assert.throws(()=>selectNoteCard([noDate],{targetTitle:'原题',date:'2026-11-13'}),coded('PAGE_CHANGED'));
  for(const actions of [[],[{},{}]]) assert.throws(()=>selectNoteCard([{...card(),actions}],{targetTitle:'原题'}),coded('PAGE_CHANGED'));
});
test('only original /publish/update URL with one ID is accepted',()=>{
  assert.equal(editRoute(URL_EDIT,NOTE).noteId,NOTE);
  assert.equal(editRoute(URL_EDIT.replace('noteId','note_id')).noteId,NOTE);
  for(const url of [URL_EDIT.replace('/update','/publish'),URL_EDIT.replace('creator.','www.'),URL_EDIT.split('?')[0],URL_EDIT+'&id='+OTHER]) assert.throws(()=>editRoute(url),coded('PAGE_CHANGED'));
  assert.throws(()=>editRoute(URL_EDIT,OTHER),coded('PAGE_CHANGED'));
});
test('same-note readback checks full body whitespace, topic IDs, ordered image identity',()=>{
  const expected=initial();assert.equal(verifyEditor(clone(expected),expected,NOTE),true);
  for(const mutate of [s=>s.title+='x',s=>s.content='原 正文',s=>s.topics[0].id='other',s=>s.images.reverse(),s=>s.url=s.url.replace(NOTE,OTHER)]) {
    const actual=clone(expected);mutate(actual);assert.throws(()=>verifyEditor(actual,expected,NOTE),coded('PAGE_CHANGED'));
  }
  assert.equal(imageIdentity(image('same')),imageIdentity({src:'https://other.xhscdn.com/objects/same?resize=1'}));
  assert.notEqual(imageIdentity({src:'https://images.example/asset?id=one'}),imageIdentity({src:'https://images.example/asset?id=two'}));
  assert.throws(()=>imageIdentity({src:'blob:test'}),coded('PAGE_CHANGED'));
});

test('DOM edit discovery uses semantic third action, not arbitrary fourth/delete',()=>{
  const action=(label,index,attrs={})=>({innerText:label,className:'note-card__action-btn',getAttribute:n=>attrs[n]??null,querySelectorAll:()=>[],getBoundingClientRect:()=>({x:index*30,y:20,width:20,height:20})});
  const actions=[action('查看',0),action('数据',1),action('编辑',2),action('删除',3)];
  const title={innerText:'原题',getAttribute:()=>null};
  const c={innerText:'原题\n2026-11-13 08:00',querySelectorAll:s=>s.startsWith('.note-card__title')?[title]:s.startsWith('time')?[]:actions};
  const ctx={document:{querySelectorAll:()=>[c]},getComputedStyle:()=>({display:'block',visibility:'visible'}),location:new URL(URL_MANAGER),URL};
  const result=vm.runInNewContext(`(${managerCardsDom.toString()})()`,ctx);
  assert.equal(result[0].actions.length,1);assert.equal(result[0].actions[0].x,70);
});
// Fixture copied from the actual 2026-11-13 manager DOM, not from adapter code.
const observedPencilPath='M16.1917 17.4916H3.80835C3.39168 17.4916 3.05835 17.1582 3.05835 16.7416C3.05835 16.3249 3.39168 15.9916 3.80835 15.9916H16.1917C16.6083 15.9916 16.9417 16.3249 16.9417 16.7416C16.9417 17.1582 16.6083 17.4916 16.1917 17.4916ZM7.89168 14.7166C8.41668 14.6582 8.90835 14.4166 9.28335 14.0416L16.7667 6.49157C17.6986 5.55969 17.6986 4.00678 16.7667 3.0749C15.825 2.13324 14.2917 2.13324 13.35 3.0749L5.85002 10.6416C5.48335 11.0082 5.25002 11.4999 5.19168 12.0166L5.02502 13.4999C4.98335 13.8832 5.11668 14.2582 5.38335 14.5332C5.62502 14.7666 5.94168 14.8999 6.26668 14.8999C6.80609 14.8999 7.35679 14.7827 7.89168 14.7166ZM15.7 4.1499C16.0532 4.50309 16.0549 5.10319 15.6917 5.4499L8.20835 12.9999C8.07502 13.1332 7.90002 13.2166 7.71668 13.2332L6.55002 13.3666L6.68335 12.1916C6.70002 12.0082 6.78335 11.8332 6.91668 11.7082L14.4083 4.1499C14.7667 3.79157 15.35 3.79157 15.7 4.1499Z';
function unlabeledSvgAction(d,index,{deleted=false,viewBox='0 0 20 20',extraPath=false}={}) {
  const paths=[{getAttribute:n=>n==='d'?d:null},...(extraPath?[{getAttribute:()=> 'M0 0L1 1'}]:[])];
  const svg={getAttribute:n=>n==='viewBox'?viewBox:null,querySelectorAll:s=>s==='path'?paths:[]};
  return {innerText:'',className:'note-card__action-btn'+(deleted?' note-card__action-btn--del':''),getAttribute:()=>null,
    querySelectorAll:s=>s==='svg'||s==='svg, use, [class*="icon"]'?[svg]:[],getBoundingClientRect:()=>({x:index*30,y:20,width:20,height:20})};
}
function discoverUnlabeledActions(actions) {
  const title={innerText:'原题',getAttribute:()=>null};
  const c={innerText:'原题\n2026-11-13 08:00',querySelectorAll:s=>s.startsWith('.note-card__title')?[title]:s.startsWith('time')?[]:actions};
  return vm.runInNewContext(`(${managerCardsDom.toString()})()`,{document:{querySelectorAll:()=>[c]},getComputedStyle:()=>({display:'block',visibility:'visible'}),location:new URL(URL_MANAGER),URL});
}
test('actual unlabeled manager pencil SVG is selected independently of order and deduplicated',()=>{
  const actions=[unlabeledSvgAction(observedPencilPath,0,{deleted:true}),unlabeledSvgAction('M0 0L2 2',1),unlabeledSvgAction(observedPencilPath,2),unlabeledSvgAction(observedPencilPath,2)];
  const cards=discoverUnlabeledActions(actions);
  assert.equal(cards[0].actions.length,1);assert.equal(cards[0].actions[0].x,70);
  assert.equal(cards[0].actions[0].label,'observed-pencil-icon');
  assert.equal(selectNoteCard(cards,{targetTitle:'原题',date:'2026-11-13'}).actions[0].x,70);
});
test('unknown/modified pencil SVG, wrong viewBox, extra paths and delete modifier are rejected',()=>{
  const actions=[unlabeledSvgAction('M0 0L2 2',0),unlabeledSvgAction(observedPencilPath.replace('16.1917','16.1918'),1),unlabeledSvgAction(observedPencilPath,2,{viewBox:'0 0 24 24'}),unlabeledSvgAction(observedPencilPath,3,{extraPath:true}),unlabeledSvgAction(observedPencilPath,4,{deleted:true})];
  const cards=discoverUnlabeledActions(actions);assert.equal(cards[0].actions.length,0);
  assert.throws(()=>selectNoteCard(cards,{targetTitle:'原题',date:'2026-11-13'}),coded('PAGE_CHANGED'));
});
test('DOM publication time wins over dates in titles and accepts ISO datetime',()=>{
  const title={innerText:'日报 2026-11-12',getAttribute:()=>null};
  const time={innerText:'11月13日',getAttribute:()=> '2026-11-13T08:00:00+08:00'};
  const c={innerText:'日报 2026-11-12\n2026-11-13 08:00',querySelectorAll:s=>s.startsWith('.note-card__title')?[title]:s.startsWith('time')?[time]:[]};
  const result=vm.runInNewContext(`(${managerCardsDom.toString()})()`,{document:{querySelectorAll:()=>[c]},getComputedStyle:()=>({display:'block',visibility:'visible'}),location:new URL(URL_MANAGER),URL});
  assert.deepEqual([...result[0].dates],['2026-11-13']);
});
test('DOM body capture preserves blank paragraphs and excludes formal topic entities',()=>{
  const rect=()=>({width:100,height:20});
  const el=(tag,children=[])=>{const n={nodeType:1,tagName:tag,childNodes:children,children:children.filter(c=>c.nodeType===1),getBoundingClientRect:rect,matches:s=>s==='a[data-topic]'&&tag==='A',closest:()=>null};for(const c of children)c.parentElement=n;return n;};
  const txt=s=>({nodeType:3,textContent:s});
  const topic=el('A',[txt('#ai[话题]#')]);topic.getAttribute=()=>JSON.stringify(oldTopic);topic.innerText='#ai';
  const editor=el('DIV',[el('P',[txt('第一段')]),el('P',[el('BR')]),el('P',[txt('最后一段')]),el('P',[topic])]);editor.innerText='第一段\n\n最后一段\n#ai';editor.querySelectorAll=()=>[topic];
  const title=el('INPUT');title.value='原题';
  const body=el('BODY',[title,editor]);body.innerText='原题\n正文';
  const doc={body,querySelectorAll:s=>s.includes('placeholder')?[title]:s==='[contenteditable="true"]'?[editor]:s==='.img-list img'?[{...image('old'),complete:true,naturalWidth:10,currentSrc:image('old').src,alt:''}]:[],querySelector:()=>({innerText:'1/18'})};
  const state=vm.runInNewContext(`(${editorSnapshotDom.toString()})()`,{document:doc,location:new URL(URL_EDIT),getComputedStyle:()=>({display:'block',visibility:'visible'})});
  assert.equal(state.ready,true);assert.equal(state.content.trim(),'第一段\n\n最后一段');assert.equal(state.topics[0].id,oldTopic.id);
});

function discoverCloseFixture(options={}) {
  const style={display:'block',visibility:'visible',opacity:'1',pointerEvents:'auto'};
  const child={};
  const control={style:{...style,...options.style},getBoundingClientRect:()=>({x:60,y:20,width:options.zeroSize?0:20,height:20}),contains:n=>n===control||n===child};
  const controls=options.missing?[]:[control,...(options.ambiguous?[{...control}]:[])];
  const image={};
  const tile={style,querySelectorAll:s=>s==='img'?[image]:s==='.close-btn'?controls:[],querySelector:()=>controls[0]??null};
  const list={style,querySelector:s=>s==='img'?image:controls[0]??null,querySelectorAll:s=>s==='img'?[image]:controls};
  image.parentElement=tile;tile.parentElement=list;control.parentElement=tile;
  return vm.runInNewContext(`(${deleteImageDom.toString()})()`,{document:{querySelector:()=>list,elementFromPoint:()=>options.blocked?{}:child},getComputedStyle:n=>n.style??style});
}
test('image close discovery is read-only and targets actual visible inner-child hit center',()=>{
  const hit=discoverCloseFixture();assert.equal(hit.x,70);assert.equal(hit.y,30);
  assert.doesNotMatch(deleteImageDom.toString(),/dispatchEvent|MouseEvent|\.click\(/);
});
test('missing, invisible, ambiguous or covered first-thumbnail close control is rejected',()=>{
  for(const options of [{missing:true},{zeroSize:true},{style:{display:'none'}},{style:{visibility:'hidden'}},{style:{opacity:'0'}},{style:{pointerEvents:'none'}},{ambiguous:true},{blocked:true}]) assert.equal(discoverCloseFixture(options),null);
});

// End-to-end state machine with isolated fake page, saving and fresh UI readback.
test('upload-first replacement uses trusted click without ever reaching zero images',async()=>{
  const f=fixture({initialCount:1});const result=await editNote(input({replaceImages:true},{images:[png]}),{account},f.deps);
  assert.equal(result.submitted,false);
  const removals=f.events.filter(e=>e[0]==='delete-image');assert.equal(removals.length,1);
  assert.deepEqual(removals[0],['delete-image','trusted-click',80,40]);
  assert.ok(f.events.findIndex(e=>e[0]==='discover-image-close')<f.events.findIndex(e=>e[0]==='delete-image'));
  assert.ok(f.events.findIndex(e=>e[0]==='upload')<f.events.findIndex(e=>e[0]==='delete-image'));
  assert.ok(f.events.filter(e=>e[0]==='image-count').every(e=>e[1]>0));
  assert.equal(f.events.some(e=>e[0]==='save-click'),false);
});
test('missing close control or non-exact minus-one count after append blocks saving',async()=>{
  for(const options of [{closeMissing:true},{deleteDouble:true}]){
    const f=fixture(options);await assert.rejects(editNote(input({replaceImages:true},{images:[png]}),{account,submit:true},f.deps),coded('PAGE_CHANGED'));
    assert.equal(f.events.filter(e=>e[0]==='upload').length,1);
    assert.equal(f.events.some(e=>e[0]==='save-click'),false);
  }
});
test('combined old-plus-new capacity overflow fails before title/body/upload/deletion',async()=>{
  const f=fixture();await assert.rejects(editNote(input({title:'新题',content:'新正文',replaceImages:true},{images:Array(17).fill(png)}),{account,submit:true},f.deps),coded('USAGE'));
  assert.equal(f.events.some(e=>['type','upload','delete-image','save-click'].includes(e[0])),false);
});
test('append must preserve the exact original ordered prefix before any deletion',async()=>{
  const f=fixture({prefixMismatch:true});await assert.rejects(editNote(input({replaceImages:true},{images:[png,png]}),{account,submit:true},f.deps),coded('PAGE_CHANGED'));
  assert.equal(f.events.filter(e=>e[0]==='upload').length,1);
  assert.equal(f.events.some(e=>e[0]==='delete-image'||e[0]==='save-click'),false);
});
test('incomplete/processing/unverified-visual/extra appended images never permit deleting originals or saving',async()=>{
  for(const options of [{uploading:true},{newNotLoaded:true},{visualMismatch:true},{uploadExtra:true}]){
    const f=fixture(options);await assert.rejects(editNote(input({replaceImages:true},{images:[png]}),{account,submit:true},f.deps),e=>['UPLOAD_FAILED','PAGE_CHANGED'].includes(e.code));
    assert.equal(f.events.some(e=>e[0]==='delete-image'||e[0]==='save-click'),false);
  }
});
test('exact count decrement still rejects deleting new image, reordering or modifying new IDs',async()=>{
  for(const options of [{deleteWrongEnd:true},{deleteReorder:true},{deleteMutateNew:true}]){
    const f=fixture(options);await assert.rejects(editNote(input({replaceImages:true},{images:[png,png]}),{account,submit:true},f.deps),coded('PAGE_CHANGED'));
    assert.equal(f.events.filter(e=>e[0]==='delete-image').length,1);
    assert.equal(f.events.some(e=>e[0]==='save-click'),false);
  }
});
test('final ordered new IDs are exact, evidenced and saved on the same original note',async()=>{
  const f=fixture();const result=await editNote(input({replaceImages:true},{images:[png,png]}),{account,submit:true},f.deps);
  const expected=Array(2).fill('sha256:'+preflightEditImages([png])[0].sha256);
  assert.equal(result.saveVerified,true);assert.equal(result.noteId,NOTE);
  assert.deepEqual(result.after.images.map(imageIdentity),expected);
  const proof=JSON.parse(fs.readFileSync(result.editEvidence,'utf8')).imageReplacement;
  assert.equal(proof.strategy,'upload-first');assert.equal(proof.combinedCount,4);
  assert.deepEqual(proof.newIds,expected);assert.deepEqual(proof.finalIds,expected);assert.equal(proof.deletions.length,2);
  assert.deepEqual(proof.deletions.map(d=>d.removedOriginalId),result.before.images.map(imageIdentity));
});
test('one original plus five new and exact combined capacity eighteen are supported',async()=>{
  for(const [oldCount,newCount] of [[1,5],[2,16]]){
    const f=fixture({initialCount:oldCount});const result=await editNote(input({replaceImages:true},{images:Array(newCount).fill(png)}),{account},f.deps);
    assert.equal(result.staged.imageCount,newCount);assert.equal(f.events.filter(e=>e[0]==='delete-image').length,oldCount);
    assert.ok(f.events.filter(e=>e[0]==='image-count').every(e=>e[1]>=newCount&&e[1]<=18));
  }
});
test('blob proof cannot be forged by job/DOM/JSON metadata or copied from a persisted snapshot',async()=>{
  const fake={src:'blob:https://creator.xiaohongshu.com/unverified',visualEvidence:{verified:true,referenceSha256:'f'.repeat(64),sourceKey:'blob:https://creator.xiaohongshu.com/unverified'}};
  assert.throws(()=>imageIdentity(fake),coded('PAGE_CHANGED'));
  const f=fixture({newBlob:true});const result=await editNote(input({replaceImages:true},{images:[png]}),{account},f.deps);
  assert.equal(imageIdentity(result.staged.images[0]),'sha256:'+preflightEditImages([png])[0].sha256);
  assert.throws(()=>imageIdentity(clone(result.staged.images[0])),coded('PAGE_CHANGED'));
});
test('all five ordered blob previews and fresh saved CDN images are visually proven against exact local inputs',async()=>{
  const files=[png,pngSecond,png,pngSecond,png];
  const f=fixture({initialCount:1,newBlob:true,savedCdn:true});
  const result=await editNote(input({title:'新题',content:'新正文',replaceImages:true},{images:files}),{account,submit:true},f.deps);
  assert.equal(result.saveVerified,true);assert.equal(result.noteId,NOTE);
  const expected=preflightEditImages(files).map(i=>'sha256:'+i.sha256);
  assert.deepEqual(result.staged.images.map(imageIdentity),expected);assert.deepEqual(result.after.images.map(imageIdentity),expected);
  assert.ok(result.staged.images.every(i=>i.src.startsWith('blob:')));assert.ok(result.after.images.every(i=>i.src.includes('saved-cdn')));
  assert.ok(result.after.images.every(i=>i.visualEvidence.verified));
  const compares=f.events.filter(e=>e[0]==='visual-compare');assert.equal(compares.length,15);
  for(const phase of ['visual-appended','visual-before-save','visual-saved-readback']){
    const rows=compares.filter(e=>e[3].includes(phase));assert.equal(rows.length,5);
    assert.deepEqual(rows.map(e=>e[1]),files.map(file=>'data:image/png;base64,'+fs.readFileSync(file).toString('base64')));
  }
});
test('wrong or reordered blob previews fail local visual proof before deleting originals or saving',async()=>{
  for(const options of [{visualMismatch:true},{uploadReorder:true}]){
    const f=fixture({newBlob:true,...options});await assert.rejects(editNote(input({replaceImages:true},{images:[png,pngSecond]}),{account,submit:true},f.deps),coded('PAGE_CHANGED'));
    assert.equal(f.events.some(e=>e[0]==='delete-image'||e[0]==='save-click'),false);
  }
});
test('before-save snapshot must pass fresh visual proof again after title/body staging',async()=>{
  const f=fixture({newBlob:true,beforeSaveMismatch:true});await assert.rejects(editNote(input({title:'新题',content:'新正文',replaceImages:true},{images:[png,pngSecond]}),{account,submit:true},f.deps),e=>e.code==='PAGE_CHANGED'&&!e.submissionAttempted);
  assert.ok(f.events.some(e=>e[0]==='visual-compare'&&e[3].includes('visual-before-save')));
  assert.equal(f.events.some(e=>e[0]==='save-click'),false);
});
test('fresh saved CDN mismatch/reorder remains unknown error despite successful submit signal',async()=>{
  for(const options of [{savedMismatch:true},{savedReorder:true}]){
    const f=fixture({newBlob:true,savedCdn:true,...options});
    await assert.rejects(editNote(input({replaceImages:true},{images:[png,pngSecond]}),{account,submit:true},f.deps),e=>e.code==='PAGE_CHANGED'&&e.submissionAttempted&&e.saveOutcome==='unknown');
    assert.equal(f.events.filter(e=>e[0]==='save-click').length,1);
  }
});
test('fresh saved readback cannot reuse local blob previews as persistence proof',async()=>{
  const f=fixture({newBlob:true});await assert.rejects(editNote(input({replaceImages:true},{images:[png]}),{account,submit:true},f.deps),e=>e.code==='PAGE_CHANGED'&&e.submissionAttempted&&e.saveOutcome==='unknown');
});
test('original images still require stable HTTP identities before any new visual proof or mutation',async()=>{
  const f=fixture({initialBlob:true});await assert.rejects(editNote(input({replaceImages:true},{images:[png]}),{account,submit:true},f.deps),coded('PAGE_CHANGED'));
  assert.equal(f.events.some(e=>['type','upload','visual-compare','delete-image','save-click'].includes(e[0])),false);
});
test('invalid new images fail before connection or destructive UI',async()=>{
  const f=fixture();await assert.rejects(editNote(input({replaceImages:true},{images:[path.join(runDir,'absent.png')]}),{account},f.deps),coded('USAGE'));
  assert.deepEqual(f.events,[]);
});
test('identity verification still precedes manager navigation and mutations',async()=>{
  const f=fixture({identityFailure:true});await assert.rejects(editNote(input({title:'新题'}),{account},f.deps),coded('ACCOUNT_MISMATCH'));
  assert.deepEqual(f.events,[['connect'],['identity']]);
});
test('legacy image-only dry run changes images but never types source title/body/topics',async()=>{
  const f=fixture();const result=await editNote({title:'原题',content:'DO NOT TYPE',topics:['DO NOT INSERT'],images:[png]}, {account},f.deps);
  assert.equal(result.dryRun,true);assert.equal(result.submitted,false);assert.equal(result.before.noteId,NOTE);
  assert.equal(f.events.some(e=>e[0]==='type'||e[0]==='topics'||e[0]==='save-click'),false);
  assert.equal(f.events.filter(e=>e[0]==='delete-image').length,2);
});
test('authorized title/body save retains topic IDs and reopens exact same note',async()=>{
  const f=fixture();const result=await editNote(input({title:'新题',content:'新正文'}),{account,submit:true},f.deps);
  assert.equal(result.submitted,true);assert.equal(result.saveVerified,true);assert.equal(result.after.noteId,NOTE);
  assert.equal(result.after.content,'新正文');assert.deepEqual(result.after.topics,[oldTopic]);
  assert.equal(f.events.filter(e=>e[0]==='save-click').length,1);
  assert.deepEqual(f.events.filter(e=>e[0]==='goto').map(e=>e[1]),[URL_MANAGER,URL_EDIT]);
  assert.ok(fs.existsSync(result.editEvidence));
});
test('explicit topic [] clears, explicit replacement resolves formal IDs',async()=>{
  for(const topics of [[],['GitHub']]) {
    const f=fixture();const result=await editNote(input({topics}),{account,submit:true},f.deps);
    assert.deepEqual(result.after.topics.map(t=>t.name),topics);
  }
});
test('job.submit:false blocks save even when library requested=true',async()=>{
  const f=fixture();const result=await editNote(input({title:'新题'},{submit:false}),{account,submit:true},f.deps);
  assert.equal(result.submitted,false);assert.equal(f.events.some(e=>e[0]==='save-click'),false);
});
test('body plus retained topic limit checked before title/image/body mutation',async()=>{
  const f=fixture();await assert.rejects(editNote(input({title:'新题',content:'中'.repeat(999),replaceImages:true},{images:[png]}),{account,submit:true},f.deps),coded('USAGE'));
  assert.equal(f.events.some(e=>['type','delete-image','upload','save-click'].includes(e[0])),false);
});
test('no upload input stops before any destructive or text mutation',async()=>{
  const f=fixture({noUploadInput:true});await assert.rejects(editNote(input({title:'新题',replaceImages:true},{images:[png]}),{account,submit:true},f.deps),coded('PAGE_CHANGED'));
  assert.equal(f.events.some(e=>['type','delete-image','save-click'].includes(e[0])),false);
});
test('changed retained topic ID or failed formal-topic verification blocks saving',async()=>{
  for(const settings of [{topicMismatch:true},{topicFailure:true}]){
    const f=fixture(settings);await assert.rejects(editNote(input({content:'新正文'}),{account,submit:true},f.deps),coded('PAGE_CHANGED'));
    assert.equal(f.events.some(e=>e[0]==='save-click'),false);
  }
});
test('stuck delete and uploading timeout are errors, never success',async()=>{
  for(const settings of [{deleteStuck:true},{uploading:true}]){
    const f=fixture(settings);await assert.rejects(editNote(input({replaceImages:true},{images:[png]}),{account,submit:true},f.deps),e=>['PAGE_CHANGED','UPLOAD_FAILED'].includes(e.code));
    assert.equal(f.events.some(e=>e[0]==='save-click'),false);
  }
});
test('new-note route is rejected; it cannot become a posting fallback',async()=>{
  const f=fixture({openUrl:'https://creator.xiaohongshu.com/publish/publish'});
  await assert.rejects(editNote(input({title:'新题'}),{account,submit:true},f.deps),coded('PAGE_CHANGED'));
  assert.equal(f.events.some(e=>e[0]==='type'||e[0]==='save-click'),false);
});
test('save timeout/failure/unknown navigation remains error with attempted-save evidence',async()=>{
  for(const settings of [{saveTimeout:true},{saveFailure:true},{saveUrl:'https://creator.xiaohongshu.com/publish/publish'}]) {
    const f=fixture(settings);await assert.rejects(editNote(input({title:'新题'}),{account,submit:true},f.deps),e=>e.code==='PUBLISH_FAILED'&&e.submissionAttempted&&e.saveOutcome==='unknown'&&fs.existsSync(e.editEvidence));
    assert.equal(f.events.filter(e=>e[0]==='save-click').length,1);
  }
});
test('save signal without matching fresh title/body/images/topic/ID readback is not success',async()=>{
  for(const readback of [s=>s.title='not saved',s=>s.content='lost',s=>s.images.reverse(),s=>s.topics[0].id='wrong']) {
    const f=fixture({readback});await assert.rejects(editNote(input({title:'新题'}),{account,submit:true},f.deps),e=>e.code==='PAGE_CHANGED'&&e.submissionAttempted);
  }
  const f=fixture({saveUrl:URL_EDIT.replace(NOTE,OTHER)});
  await assert.rejects(editNote(input({title:'新题'}),{account,submit:true},f.deps),coded('PAGE_CHANGED'));
});
test('success notice while remaining on original update route still requires fresh readback',async()=>{
  const f=fixture({saveNotice:true});const result=await editNote(input({title:'新题'}),{account,submit:true},f.deps);
  assert.equal(result.saveVerified,true);assert.equal(result.after.title,'新题');
});
function updateSuccessDomFixture({header='更新笔记',message='更新成功',buttonCount=1,hidden=false,disabled=false,hiddenHeader=false}={}){
  const style={display:'block',visibility:'visible',opacity:'1'};
  const node=(innerText,custom={})=>({innerText,style:{...style,...custom},getBoundingClientRect:()=>({width:100,height:20}),getAttribute:()=>null});
  const nodes=[node(header,hiddenHeader?{opacity:'0'}:{}),node(message)];
  const buttons=Array.from({length:buttonCount},()=>({...node('立即返回',hidden?{display:'none'}:{}),disabled}));
  const body={innerText:[header,message,'5秒后自动返回笔记管理',...buttons.map(n=>n.innerText)].join('\n')};
  const document={body,querySelectorAll:s=>s.startsWith('[role="status"]')?[]:s.startsWith('button')?buttons:nodes};
  return vm.runInNewContext(`(${saveStateDom.toString()})()`,{document,location:{href:'https://creator.xiaohongshu.com/observed-update-transition'},getComputedStyle:n=>n.style??style});
}
test('observed update-only success UI requires exact visible header/message and one visible return button',()=>{
  assert.equal(updateSuccessDomFixture().updateSuccessPage,true);
});
test('new-post/unrelated success, missing/ambiguous/hidden/disabled controls never mint update-success UI',()=>{
  for(const options of [{header:'发布笔记',message:'发布成功'},{header:'更新笔记',message:'发布成功'},{header:'其它页面'},{buttonCount:0},{buttonCount:2},{hidden:true},{disabled:true},{hiddenHeader:true}]) assert.equal(updateSuccessDomFixture(options).updateSuccessPage,false);
});
test('verified update-success UI permits only original-route fresh readback, not immediate success or repeat submit',async()=>{
  const transition='https://creator.xiaohongshu.com/observed-update-transition';
  const f=fixture({saveUrl:transition,updateSuccessPage:true});
  const result=await editNote(input({title:'新题'}),{account,submit:true},f.deps);
  assert.equal(result.saveVerified,true);assert.equal(result.noteId,NOTE);
  assert.deepEqual(f.events.filter(e=>e[0]==='goto').map(e=>e[1]),[URL_MANAGER,URL_EDIT]);
  assert.equal(f.events.filter(e=>e[0]==='save-click').length,1);
  const bad=fixture({saveUrl:transition,updateSuccessPage:true,readback:s=>{s.title='not saved';}});
  await assert.rejects(editNote(input({title:'新题'}),{account,submit:true},bad.deps),e=>e.code==='PAGE_CHANGED'&&e.submissionAttempted&&e.saveOutcome==='unknown');
  assert.equal(bad.events.filter(e=>e[0]==='save-click').length,1);
});
test('generic new-post success or new-note route cannot satisfy original-update save transition',async()=>{
  for(const options of [
    {saveUrl:'https://creator.xiaohongshu.com/publish/success',genericPostSuccess:true},
    {saveUrl:'https://creator.xiaohongshu.com/publish/publish',updateSuccessPage:true},
    {saveUrl:'https://creator.xiaohongshu.com/unknown',updateSuccessPage:false},
    {saveUrl:'https://other.example/update',updateSuccessPage:true}
  ]){
    const f=fixture(options);await assert.rejects(editNote(input({title:'新题'}),{account,submit:true},f.deps),e=>e.code==='PUBLISH_FAILED'&&e.submissionAttempted&&e.saveOutcome==='unknown');
    assert.equal(f.events.filter(e=>e[0]==='save-click').length,1);
  }
});
test('CLI keeps edit-specific parser, account/profile checks and finally cleanup integration',()=>{
  const cli=fs.readFileSync(new URL('../scripts/xhs.mjs',import.meta.url),'utf8');
  assert.match(cli,/const job = readEditJob\(opts.job\)/);
  assert.match(cli,/finally\s*\{\s*try\s*\{\s*const browserCleanup = await cleanupBrowsers\(\)/);
  assert.match(cli,/resolveAccount\(config, opts.account, job.account, \{ post: true \}\)/);
  const source=fs.readFileSync(new URL('../scripts/lib/note-edit.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/btns\[3\]|await submit\(|gotoPublish\(|publishImage\(|publishText\(/);
});
