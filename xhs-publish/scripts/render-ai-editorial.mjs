#!/usr/bin/env node
// Reusable AI editorial cards. Uses the installed Guizang Swiss seed, not the old navy cover.
// Offline: --spec spec.json --out images [--check]. No logged-in profile is ever used.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withLocalRenderer} from './lib/local-renderer.mjs';
import {cleanupBrowsers,trackBrowser} from './lib/browser-lifecycle.mjs';
import {queryProfile} from './lib/port-profile.mjs';
import {CDP} from './lib/cdp.mjs';
async function withVerifiedLocalRenderer(html,run,{width,height}){
 const port=Number(opt('--port',0)),profile=path.resolve(opt('--profile',''));
 if(!Number.isInteger(port)||port<1024||[9333,9334,9335].includes(port)||!profile.toLowerCase().includes('render-temp'))throw new Error('Isolated rendering port/profile required');
 trackBrowser(port,profile,{temporary:true});
 await queryProfile(port,profile);
 const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
 const t=targets.find(t=>t.type==='page');if(!t)throw new Error('No local rendering page');
 const cdp=await CDP.connect(t.webSocketDebuggerUrl);
 try{
  await cdp.send('Page.enable');await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  const {frameTree}=await cdp.send('Page.getFrameTree');await cdp.send('Page.setDocumentContent',{frameId:frameTree.frame.id,html});
  const evaluate=async expression=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await evaluate('document.fonts.ready.then(()=>true)');return await run({evaluate,cdp,port});
 }finally{cdp.close();}
}
const arg=process.argv.slice(2), opt=(k,d)=>arg.includes(k)?arg[arg.indexOf(k)+1]:d;
const specPath=path.resolve(opt('--spec','editorial.json'));
const out=path.resolve(opt('--out',path.join(path.dirname(specPath),'images')));
const spec=JSON.parse(fs.readFileSync(specPath,'utf8').replace(/^\uFEFF/,''));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lines=s=>esc(s).replaceAll('\n','<br>');
const required=['brand','issue','title','subtitle','gemini','claude','assistants','decisions'];
for(const k of required)if(!spec[k])throw new Error(`Missing ${k}`);
if(!Array.isArray(spec.claude.items)||spec.claude.items.length!==3)throw new Error('Exactly three collaboration items required');
if(!Array.isArray(spec.decisions)||spec.decisions.length!==3)throw new Error('Exactly three decision items required');
if(!Array.isArray(spec.assistants.items)||spec.assistants.items.length!==2)throw new Error('Two assistant comparison columns required');
if(JSON.stringify(spec).includes('\uFFFD'))throw new Error('Replacement character in copy');
if(arg.includes('--check')){console.log(JSON.stringify({ok:true,kind:'offline-spec-check',spec:specPath}));process.exit(0);}
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const seed=path.resolve(skill,'../xhs-guizang-social-card-skill/assets/template-swiss-card.html');
let html=fs.readFileSync(seed,'utf8');
html=html.replace(/<link[^>]+>/g,'').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'');
const fontPath='C:/Windows/Fonts/NotoSansSC-VF.ttf';
if(!fs.existsSync(fontPath))throw new Error('Noto Sans SC variable font required; do not silently substitute');
const font=fs.readFileSync(fontPath).toString('base64');
const extra=`
@font-face{font-family:EditorialSans;src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:100 900;font-display:block}
:root{--sans:EditorialSans,'Microsoft YaHei',sans-serif;--sans-zh:EditorialSans,'Microsoft YaHei',sans-serif;--mono:Consolas,EditorialSans,monospace;--font-display:var(--sans);--font-sans:var(--sans)}
html{scrollbar-width:none}::-webkit-scrollbar{display:none}*{box-sizing:border-box}body{margin:0;background:#e8e8e6;padding:32px}.sheet{gap:32px}.poster.xhs .content{padding:60px 72px 54px;display:flex;flex-direction:column}.chrome-min{font-size:25px;letter-spacing:.07em;margin-bottom:30px;padding-bottom:22px;color:var(--text-secondary)}
.kicker{margin:0 0 22px;color:var(--accent-ink);font-size:30px;font-weight:500;letter-spacing:.06em}.poster.xhs .h-xl{font-size:94px;font-weight:300;line-height:1.2;letter-spacing:0;margin-bottom:28px}.poster.xhs .h-statement{font-size:114px;font-weight:300;line-height:1.17;letter-spacing:0;margin-bottom:32px}.intro{font-size:37px;line-height:1.6;color:var(--text-secondary);margin:0 0 28px}.foot{margin-top:auto;padding-top:20px;border-top:1px solid var(--line-strong);display:flex;justify-content:space-between;font-size:25px;color:var(--text-secondary)}
.cover-index{display:grid;grid-template-columns:300px 1fr;gap:38px;align-items:center;padding:26px 0 30px;border-bottom:2px solid var(--ink);margin-bottom:10px}.poster.xhs .cover-num{font-size:280px;font-weight:200;line-height:1;color:var(--accent-display);letter-spacing:-.04em}.index-copy{font-size:57px;font-weight:300;line-height:1.5;margin:0}.cover-row{display:grid;grid-template-columns:62px 1fr;gap:22px;padding:19px 0;border-bottom:1px solid var(--line)}.row-n{font-size:31px;color:var(--accent-ink);font-family:var(--mono);padding-top:8px}.row-title{font-size:40px;line-height:1.4;margin:0 0 5px;font-weight:500}.row-note{font-size:32px;line-height:1.5;color:var(--text-secondary);margin:0}.cover-bottom{font-size:33px;line-height:1.6;color:var(--accent-ink);margin:24px 0 20px}
.stat-hero{display:grid;grid-template-columns:330px 1fr;gap:30px;align-items:end;border-bottom:2px solid var(--ink);padding-bottom:30px;margin:6px 0 18px}.stat-hero .value{font-size:232px;line-height:.98;font-weight:200;color:var(--accent-display);letter-spacing:-.04em}.stat-hero .explain{font-size:41px;line-height:1.5;margin:0 0 8px}.stat-hero small{font-size:31px;color:var(--text-secondary)}.metric-row{display:grid;grid-template-columns:350px 1fr;align-items:center;gap:26px;padding:26px 0;border-bottom:1px solid var(--line)}.metric-value{font-size:73px;font-weight:300;color:var(--ink);line-height:1.2}.metric-label{font-size:37px;line-height:1.5}.metric-label small{display:block;font-size:28px;color:var(--text-secondary)}.takeaway{border-left:5px solid var(--accent);padding:6px 0 6px 26px;margin:30px 0 22px;font-size:35px;line-height:1.65}.source{font-size:24px;line-height:1.5;color:var(--text-secondary);margin:0 0 18px}
.workflow{margin-top:6px}.work-row{display:grid;grid-template-columns:76px 1fr;gap:24px;padding:16px 0;border-top:1px solid var(--line-strong)}.work-label{font-size:29px;color:var(--accent-ink);font-family:var(--mono);padding-top:9px}.work-title{font-size:45px;font-weight:400;margin:0 0 8px;line-height:1.4}.work-text{font-size:35px;line-height:1.55;margin:0;color:var(--text-body)}.restriction{background:var(--paper-2);padding:14px 22px;margin:24px 0 20px;font-size:30px;line-height:1.6}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:34px;border-top:2px solid var(--ink);margin:8px 0 0}.compare-col{padding:20px 0}.compare-col+ .compare-col{border-left:1px solid var(--line-strong);padding-left:32px}.product{font-size:45px;color:var(--accent-ink);margin:0 0 18px;font-weight:400}.focus{font-size:52px;line-height:1.35;font-weight:300;margin:0 0 18px}.compare-detail{font-size:35px;line-height:1.7;margin:0 0 14px}.compare-tag{font-size:26px;color:var(--text-secondary);margin:0 0 6px}.boundary{border-top:2px solid var(--ink);padding-top:20px;margin-top:6px}.boundary .h-md{font-family:var(--sans);font-size:47px;font-weight:400;line-height:1.45;margin-bottom:20px}.boundary p{font-size:33px;line-height:1.6;margin:0 0 20px;color:var(--text-secondary)}
.decision-row{display:grid;grid-template-columns:62px 1fr;gap:22px;border-top:1px solid var(--line-strong);padding:23px 0}.decision-row h3{font-size:43px;font-weight:400;line-height:1.4;margin:0 0 6px}.decision-row .tool{font-size:32px;color:var(--accent-ink);margin:0 0 8px}.decision-row .why{font-size:33px;line-height:1.5;margin:0;color:var(--text-secondary)}.closing{font-size:72px;font-weight:300;line-height:1.4;margin:30px 0 24px;color:var(--accent-display)}
.poster.wide .content{padding:64px 96px;display:flex;flex-direction:column}.wide-heading{display:grid;grid-template-columns:1fr 460px;gap:80px;align-items:center}.poster.wide .h-xl{font-family:var(--sans);font-size:118px;font-weight:300;line-height:1.2;letter-spacing:0;margin:0}.wide-number{font-size:350px;font-weight:200;color:var(--accent-display);line-height:1}.wide-bottom{display:grid;grid-template-columns:repeat(3,1fr);gap:44px;border-top:2px solid var(--ink);padding-top:26px;margin-top:auto}.wide-bottom p{font-size:38px;line-height:1.5;margin:0}.wide-bottom small{display:block;font-size:28px;color:var(--text-secondary)}.poster.square .content{padding:68px;display:flex;flex-direction:column}.poster.square .h-xl{font-family:var(--sans);font-size:96px;font-weight:300;line-height:1.2;letter-spacing:0;margin:0 0 40px}.square-number{font-size:250px;line-height:1;font-weight:200;color:var(--accent-display);margin:24px 0}.square-note{font-size:39px;line-height:1.6;margin:0}.poster.article-figure{width:1080px;height:720px}.poster.article-figure .content{padding:44px 52px;display:flex;flex-direction:column}.figure-kicker{font-size:25px;letter-spacing:.06em;color:var(--accent-ink);margin:0 0 22px}.figure-title{font-size:65px;font-weight:300;line-height:1.35;margin:0 0 30px}.figure-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:25px;border-top:2px solid var(--ink);padding-top:34px}.figure-grid h3{font-size:54px;font-weight:300;margin:0 0 14px;color:var(--accent-display);line-height:1.25}.figure-grid p{font-size:32px;line-height:1.6;margin:0}.figure-note{font-size:27px;line-height:1.55;border-top:1px solid var(--line-strong);padding-top:20px;margin-top:auto;color:var(--text-secondary)}.figure-compare{display:grid;grid-template-columns:1fr 1fr;gap:36px;border-top:2px solid var(--ink);padding-top:26px}.figure-compare h3{font-size:47px;font-weight:300;margin:0 0 14px;color:var(--accent-ink)}.figure-compare p{font-size:35px;line-height:1.65;margin:0}.pair-preview{display:flex;gap:24px;padding:24px;width:3260px}.pair-preview img{display:block;width:2100px;height:900px}.pair-preview img+img{width:1080px;height:1080px}
`;
const chrome=(page)=>`<div class="chrome-min"><span>${esc(spec.brand)} / AI BRIEF</span><span>${esc(spec.issue)} · ${page}</span></div>`;
const foot=(n)=>`<div class="foot"><span>看懂变化，再决定怎么用</span><span>${n} / 05</span></div>`;
const wrap=(id,body)=>`<section class="poster xhs" id="${id}"><div class="content">${body}</div></section>`;
const rows=spec.overview.map((r,i)=>`<div class="cover-row"><span class="row-n">0${i+1}</span><div><p class="row-title">${esc(r.title)}</p><p class="row-note">${esc(r.note)}</p></div></div>`).join('');
const pages=[
wrap('xhs-01',`${chrome('01')}<p class="kicker">${esc(spec.kicker)}</p><h1 class="h-statement">${lines(spec.title)}</h1><div class="cover-index"><span class="cover-num">03</span><p class="index-copy">${lines(spec.subtitle)}</p></div>${rows}${foot('01')}`),
wrap('xhs-02',`${chrome('02')}<p class="kicker">${esc(spec.gemini.product)}</p><h2 class="h-xl">${lines(spec.gemini.title)}</h2><div class="stat-hero"><div class="value">${esc(spec.gemini.hero.value)}</div><p class="explain">${lines(spec.gemini.hero.label)}<br><small>${esc(spec.gemini.hero.note)}</small></p></div>${spec.gemini.metrics.map(m=>`<div class="metric-row"><div class="metric-value">${esc(m.value)}</div><div class="metric-label">${esc(m.label)}<small>${esc(m.note)}</small></div></div>`).join('')}<p class="takeaway">${esc(spec.gemini.takeaway)}</p><p class="source">${esc(spec.gemini.source)}</p>${foot('02')}`),
wrap('xhs-03',`${chrome('03')}<p class="kicker">${esc(spec.claude.product)}</p><h2 class="h-xl">${lines(spec.claude.title)}</h2><div class="workflow">${spec.claude.items.map((m,i)=>`<div class="work-row"><span class="work-label">0${i+1}</span><div><h3 class="work-title">${esc(m.title)}</h3><p class="work-text">${esc(m.text)}</p></div></div>`).join('')}</div><p class="restriction">${esc(spec.claude.restriction)}</p><p class="source">${esc(spec.claude.source)}</p>${foot('03')}`),
wrap('xhs-04',`${chrome('04')}<p class="kicker">${esc(spec.comparisonKicker??'PERSONAL AGENTS / 个人智能体')}</p><h2 class="h-xl">${lines(spec.assistants.title)}</h2><div class="compare">${spec.assistants.items.map(m=>`<div class="compare-col"><h3 class="product">${esc(m.name)}</h3><p class="focus">${lines(m.focus)}</p><p class="compare-tag">能帮什么</p><p class="compare-detail">${esc(m.can)}</p><p class="compare-tag">先看什么</p><p class="compare-detail">${esc(m.watch)}</p></div>`).join('')}</div><div class="boundary"><h3 class="h-md">${esc(spec.assistants.boundary)}</h3><p>${esc(spec.assistants.note)}</p></div><p class="source">${esc(spec.assistants.source)}</p>${foot('04')}`),
wrap('xhs-05',`${chrome('05')}<p class="kicker">${esc(spec.decisionKicker??'HOW TO CHOOSE / 怎么选')}</p><h2 class="h-xl">${lines(spec.decisionTitle)}</h2>${spec.decisions.map((m,i)=>`<div class="decision-row"><span class="row-n">0${i+1}</span><div><h3>${esc(m.task)}</h3><p class="tool">${esc(m.tool)}</p><p class="why">${esc(m.action)}</p></div></div>`).join('')}<p class="closing">${lines(spec.closing)}</p><p class="source">${esc(spec.disclosure)}</p>${foot('05')}`)
];
const wide=`<section class="poster wide" id="wechat-21x9"><div class="content">${chrome('WECHAT')}<div class="wide-heading"><div><p class="kicker">${esc(spec.kicker)}</p><h1 class="h-xl">${lines(spec.wechatCoverTitle)}</h1></div><div class="wide-number">03</div></div><div class="wide-bottom">${spec.overview.map(r=>`<p>${esc(r.title)}<small>${esc(r.note)}</small></p>`).join('')}</div></div></section>`;
const square=`<section class="poster square" id="wechat-1x1"><div class="content">${chrome('WECHAT')}<h1 class="h-xl">${lines(spec.wechatSquareTitle)}</h1><div class="square-number">03</div><p class="square-note">${lines(spec.wechatSquareNote)}</p></div></section>`;
const figure=(id,title,body,note)=>`<section class="poster article-figure" id="${id}"><div class="content"><p class="figure-kicker">${esc(spec.brand)} / ${esc(spec.issue)}</p><h2 class="figure-title">${lines(title)}</h2>${body}<p class="figure-note">${esc(note)}</p></div></section>`;
const figures=[
figure('figure-gemini',spec.gemini.figureTitle,`<div class="figure-grid">${spec.gemini.figureItems.map(m=>`<div><h3>${esc(m.value)}</h3><p>${lines(m.label)}</p></div>`).join('')}</div>`,spec.gemini.figureNote),
figure('figure-claude',spec.claude.figureTitle,`<div class="figure-grid">${spec.claude.items.map(m=>`<div><h3>${esc(m.short)}</h3><p>${esc(m.figureText)}</p></div>`).join('')}</div>`,spec.claude.restriction),
figure('figure-assistants',spec.assistants.figureTitle,`<div class="figure-compare">${spec.assistants.items.map(m=>`<div><h3>${esc(m.name)}</h3><p>${lines(m.figureText)}</p></div>`).join('')}</div>`,spec.assistants.figureNote)
];
html=html.replace('</style>',`\n.poster.xhs .content{padding-top:60px}.poster.xhs .chrome-min{margin-bottom:30px}.poster.xhs .stat-hero .value{font-size:210px}.poster.xhs .metric-row{padding:20px 0}\n</style>`);
html=html.replace('<title>[必填] 替换为社交卡组标题 · Social Card Set</title>',`<title>${esc(spec.brand)} AI editorial</title>`).replace('</style>',extra+'</style>').replace(/<main class="sheet">[\s\S]*?<\/main>/,`<main class="sheet">${[...pages,wide,square,...figures].join('\n')}</main>`);
fs.mkdirSync(out,{recursive:true});
const sourceFile=path.join(path.dirname(out),'cards.html');
fs.writeFileSync(sourceFile,html,'utf8');
let result, primaryError;
try{
 result=await (arg.includes('--port')?withVerifiedLocalRenderer:withLocalRenderer)(html,async({evaluate,cdp})=>{
  await evaluate('document.fonts.ready.then(()=>true)');
  const boards=await evaluate(`(()=>[...document.querySelectorAll('.poster')].map(p=>{const r=p.getBoundingClientRect();const overflow=[];for(const e of p.querySelectorAll('*')){if(e.children.length||!e.textContent.trim())continue;const q=e.getBoundingClientRect();if(q.left<r.left+20||q.right>r.right-20||q.bottom>r.bottom-20||q.top<r.top)overflow.push({tag:e.tagName,text:e.textContent.slice(0,70),bottom:q.bottom-r.bottom,right:q.right-r.right});}return{id:p.id,x:r.x,y:r.y,width:r.width,height:r.height,overflow,scrollOverflow:p.scrollHeight>p.clientHeight};}))()`);
  const errors=boards.filter(p=>p.overflow.length||p.scrollOverflow);
  fs.writeFileSync(path.join(path.dirname(out),'layout-check.json'),JSON.stringify({ok:!errors.length,font:fontPath,boards},null,2));
  const shotDir=errors.length?path.join(path.dirname(out),'layout-debug'):out;fs.mkdirSync(shotDir,{recursive:true});
  for(const b of boards){const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:b.x,y:b.y,width:b.width,height:b.height,scale:1}});fs.writeFileSync(path.join(shotDir,b.id+'.png'),Buffer.from(shot.data,'base64'));}
  if(errors.length)throw new Error('Layout overflow: '+JSON.stringify(errors));
  return {ok:true,html:sourceFile,font:fontPath,boards:boards.map(b=>({id:b.id,width:b.width,height:b.height,file:path.join(out,b.id+'.png')}))};
 },{width:2400,height:1600});
}catch(e){primaryError=e;}
try{const clean=await cleanupBrowsers();if(result)result.browserCleanup=clean;}catch(e){if(result)result.browserCleanupError=e.message;primaryError??=e;}
if(primaryError){console.error(primaryError.stack||primaryError.message);process.exitCode=1;}else{fs.writeFileSync(path.join(path.dirname(out),'render-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
