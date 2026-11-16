#!/usr/bin/env node
// Offline renderer: isolated temporary Chrome only. No publishing browser connection.
import fs from 'node:fs';
import path from 'node:path';
import {withLocalRenderer} from './lib/local-renderer.mjs';
import {cleanImageText,SkillError} from './lib/util.mjs';
const arg=(k,d)=>{const i=process.argv.indexOf('--'+k);return i<0?d:process.argv[i+1]};
const esc=s=>cleanImageText(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
try {
 const file=arg('data'),out=arg('out');
 if(!file||!out) throw new SkillError('USAGE','need --data and --out');
 const raw=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),src=raw.githubIntro??raw,projects=src.projects??raw.projects;
 if(!Array.isArray(projects)||!projects.length||projects.length>12) throw new Error('need 1..12 projects');
 const width=Number(arg('width',src.width??1242)),height=Number(arg('height',src.height??1660));
 const title=src.title??raw.introTitle??'GitHub热榜｜今日项目';
 const subtitle=src.subtitle??`${projects.length} 个项目一眼看完 · 向后滑看完整介绍与看法`;
 for(const p of projects) for(const k of ['repo','today','intro']) if(!p[k]) throw new Error('missing '+k);
 const rows=projects.map((p,i)=>`<article><div class="rank">${esc(p.rank??i+1)}</div><div class="copy"><div class="repo">${esc(p.repo)}</div><div class="intro">${esc(p.intro)}</div></div><div class="star">今日<br><strong>${esc(String(p.today).replace(/^(?!\+)/,'+'))}</strong></div></article>`).join('');
 const html=`<!doctype html><meta charset="utf-8"><style>
 *{box-sizing:border-box;margin:0}html,body{width:${width}px;height:${height}px}body{background:#fafaf8;color:#0a0a0a;font-family:"Microsoft YaHei",sans-serif;padding:32px 40px;display:flex;flex-direction:column}header{height:166px;flex:none;border-bottom:4px solid #14241e}small{font-size:25px;letter-spacing:3px;color:#52525b}h1{font-size:51px;line-height:1.5;letter-spacing:-1px}.sub{font-size:27px;color:#52525b}main{flex:1;display:grid;grid-template-rows:repeat(${projects.length},1fr);min-height:0}article{display:flex;align-items:center;gap:16px;border-bottom:1px solid #e4e4e7;padding:8px 0}.rank{font-size:37px;font-weight:800;width:54px;flex:none;color:#002fa7}.copy{flex:1;min-width:0}.repo{font-size:39px;font-weight:700;line-height:1.2;overflow-wrap:anywhere}.intro{font-size:37px;line-height:1.32;margin-top:7px;overflow-wrap:anywhere}.star{width:142px;flex:none;text-align:right;color:#71717a;font-size:25px;line-height:1.25}.star strong{color:#002fa7;font-size:37px;white-space:nowrap}footer{height:52px;flex:none;display:flex;align-items:end;justify-content:space-between;font-size:24px;color:#71717a}</style>
 <header><small>GITHUB TRENDING / DAILY</small><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div></header><main>${rows}</main><footer><span>${esc(src.footer??'来源：GitHub Trending · 今日 + 为当天新增 star')}</span><span>${esc(src.pageNumber??1)}/${esc(src.totalPages??1)}</span></footer>`;
 const result=await withLocalRenderer(html,async({evaluate,cdp})=>{
  const check=await evaluate(`(()=>{const over=[];for(const e of document.querySelectorAll('header,h1,main,article,.repo,.intro,.star,footer')){const r=e.getBoundingClientRect();if(e.scrollWidth>e.clientWidth+1||r.bottom>${height}+1||r.right>${width}+1||r.left<0)over.push(e.className||e.tagName);if(e.matches('.repo,.intro')){const a=e.closest('article').getBoundingClientRect();if(r.bottom>a.bottom+1||r.top<a.top-1)over.push('text outside row')}}return {over,font:document.fonts.check('37px "Microsoft YaHei"'),text:document.body.innerText}})()`);
  if(check.over.length||!check.font) throw new Error('overflow or font unavailable: '+JSON.stringify(check));
  const shot=await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width,height,scale:1}});
  const abs=path.resolve(out);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,Buffer.from(shot.data,'base64'));
  if(arg('keep-html')) fs.writeFileSync(abs.replace(/\.png$/i,'.html'),html,'utf8');
  return {ok:true,out:abs,width,height,projects:projects.length,overflow:false,warnings:[],repoFont:39,introFont:37,text:check.text};
 },{width,height});
 console.log(JSON.stringify(result));
} catch(e) {console.log(JSON.stringify({ok:false,code:e.code==='USAGE'?'USAGE':'RENDER_FAILED',message:e.message}));process.exitCode=e.code==='USAGE'?1:8;}
