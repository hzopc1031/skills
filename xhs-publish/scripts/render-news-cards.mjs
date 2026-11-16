#!/usr/bin/env node
// 科技24小时 / 新闻清单卡：纸白＋克莱因蓝，和 render-ai-editorial 同一套 token。
// 用法: node render-news-cards.mjs --spec <spec.json> --out <images-dir>
// spec: {kicker,date,title,lead,source,pageSize?,items:[{tag,title,detail,source}]}
import fs from 'node:fs';
import path from 'node:path';
import {withLocalRenderer} from './lib/local-renderer.mjs';
import {cleanupBrowsers} from './lib/browser-lifecycle.mjs';
import {cleanImageText,SkillError} from './lib/util.mjs';

const args=process.argv.slice(2);
const arg=(k,d)=>{const i=args.indexOf('--'+k);return i<0?d:args[i+1]};
const specPath=path.resolve(arg('spec','news.json'));
const outDir=path.resolve(arg('out',path.join(path.dirname(specPath),'images')));
const spec=JSON.parse(fs.readFileSync(specPath,'utf8').replace(/^\uFEFF/,''));
const items=Array.isArray(spec.items)?spec.items:[];
if(!items.length) throw new SkillError('USAGE','spec.items 不能为空');
const pageSize=Math.max(3,Math.min(5,Number(spec.pageSize)||4));
const esc=s=>cleanImageText(String(s??'')).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages=[];
for(let i=0;i<items.length;i+=pageSize) pages.push(items.slice(i,i+pageSize));
const total=pages.length+1;
// 封面预览必须覆盖全部条目，不能标题写 5 个、下面只列 4 个；超过 6 条才收尾。
const previewCount=Math.min(items.length,6);
const coverRows=previewCount+(items.length>previewCount?1:0);
const coverFont=coverRows<=5?38:(coverRows===6?34:30);

// 标题里写了「N 个/N 条」就必须和实际条目数一致，避免图文对不上。
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const claim = String(spec.title || '').match(/([0-9]+|[一二三四五六七八九十])\s*(?:个|条|件|项)/);
if (claim) {
  const raw = claim[1];
  const n = /^[0-9]+$/.test(raw) ? Number(raw) : CN[raw];
  if (n && n !== items.length) {
    console.error(`拒绝出图：标题写「${claim[0]}」，实际有 ${items.length} 条；先对齐标题和数据。`);
    process.exit(1);
  }
}

const cover=`<section class="page">
 <div class="hd"><span class="kk">${esc(spec.kicker||'TECH 24H / 科技24小时')}</span><span class="dt">${esc(spec.date||'')}</span></div>
 <div class="cv">
  <h1>${esc(spec.title||'今天最值得知道的几件事')}</h1>
  ${spec.lead?`<p class="lead">${esc(spec.lead)}</p>`:''}
  <div class="meta"><span>${items.length} 条</span><span>${total} 页</span></div>
  <ul class="prev" style="font-size:${coverFont}px">${items.slice(0,previewCount).map((it,i)=>`<li><span class="pn">${String(i+1).padStart(2,'0')}</span><span class="pt">${esc(it.title)}</span></li>`).join('')}${items.length>previewCount?`<li class="more"><span class="pn">…</span><span class="pt">还有 ${items.length-previewCount} 条</span></li>`:''}</ul>
 </div>
 <div class="ft"><span>${esc(spec.source||'来源：公开报道整理')}</span><span>1/${total}</span></div>
</section>`;

const listPages=pages.map((group,pi)=>`<section class="page">
 <div class="hd"><span class="kk">${esc(spec.kicker||'TECH 24H / 科技24小时')}</span><span class="dt">${esc(spec.date||'')}</span></div>
 <ul class="list">${group.map((it,idx)=>{
   const no=String(pi*pageSize+idx+1).padStart(2,'0');
   return `<li><div class="no">${no}</div><div class="cc">
     <div class="tt">${it.tag?`<span class="tag">${esc(it.tag)}</span>`:''}${esc(it.title)}</div>
     ${it.detail?`<div class="dd">${esc(it.detail)}</div>`:''}
   </div><div class="ss">${esc(it.source||'')}</div></li>`;
 }).join('')}</ul>
 <div class="ft"><span>${esc(spec.footerShort||'来源：公开报道整理')}</span><span>${pi+2}/${total}</span></div>
</section>`).join('');

const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;background:#fafaf8;font-family:"Noto Sans SC","Microsoft YaHei","PingFang SC",sans-serif;color:#0a0a0a;-webkit-font-smoothing:antialiased}
.page{position:relative;width:1080px;height:1440px;padding:64px 66px 56px;overflow:hidden;background:#fafaf8;display:flex;flex-direction:column}
.hd{display:flex;justify-content:space-between;align-items:baseline;font-size:26px;letter-spacing:3px;color:#52525b;border-bottom:2px solid #0a0a0a;padding-bottom:16px;flex:none}
.kk{color:#002fa7;font-weight:700}
.cv{padding-top:92px;flex:1;display:flex;flex-direction:column;min-height:0}
.cv h1{font-size:112px;font-weight:300;line-height:1.14;letter-spacing:1px}
.cv .lead{margin-top:30px;font-size:34px;line-height:1.55;color:#3f3f46;max-width:940px}
.cv .meta{margin-top:44px;display:flex;gap:24px;font-size:28px;color:#52525b;letter-spacing:2px}
.cv .meta span{border:1px solid #e4e4e7;padding:10px 20px;background:#fff}
.prev{list-style:none;margin-top:40px;border-top:2px solid #0a0a0a;padding-top:6px;flex:1;display:flex;flex-direction:column;justify-content:space-evenly}
.prev li{display:flex;align-items:center;gap:22px}
.prev .pn{flex:none;width:58px;font-family:"Consolas",monospace;font-size:32px;font-weight:700;color:#002fa7}
.prev .pt{font-size:inherit;font-weight:600;line-height:1.32}.list{list-style:none;margin-top:26px;flex:1;display:flex;flex-direction:column;justify-content:space-evenly;min-height:0}
.list li{display:flex;align-items:flex-start;gap:22px;padding:0}
.no{flex:none;width:64px;font-family:"Consolas",monospace;font-size:34px;font-weight:700;color:#002fa7;line-height:1.2}
.cc{flex:1;min-width:0}
.tt{font-size:36px;font-weight:700;line-height:1.36}
.tag{display:inline-block;font-size:23px;font-weight:500;color:#002fa7;border:1px solid #002fa7;padding:2px 8px;margin-right:10px;vertical-align:3px;letter-spacing:1px}
.dd{margin-top:10px;font-size:29px;line-height:1.5;color:#52525b}
.ss{flex:none;width:150px;text-align:right;font-size:23px;color:#71717a;line-height:1.4}
.ft{position:absolute;left:66px;right:66px;bottom:44px;display:flex;justify-content:space-between;font-size:23px;color:#71717a;border-top:1px solid #e4e4e7;padding-top:14px;letter-spacing:1px}
</style><body>${cover}${listPages}</body></html>`;

let result,error;
try{
  result=await withLocalRenderer(html,async({evaluate,cdp})=>{
    const check=await evaluate(`(()=>{const bad=[];for(const p of document.querySelectorAll('.page')){const pr=p.getBoundingClientRect();const ft=p.querySelector('.ft').getBoundingClientRect();for(const el of p.querySelectorAll('h1,.lead,.tt,.dd,li')){const r=el.getBoundingClientRect();if(r.bottom>ft.top-12||r.right>pr.right+1||el.scrollWidth>el.clientWidth+2)bad.push((el.className||el.tagName)+':'+(el.textContent||'').slice(0,18));}if(ft.bottom>pr.bottom-10)bad.push('footer');}return bad;})()`);
    if(check.length)throw new Error('内容溢出或截断：'+JSON.stringify(check.slice(0,6)));
    await evaluate('document.fonts.ready.then(()=>true)');
    fs.mkdirSync(outDir,{recursive:true});
    const files=[];
    const count=total;
    for(let i=0;i<count;i++){
      const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:i*1440,width:1080,height:1440,scale:1}});
      const f=path.join(outDir,`news-${String(i+1).padStart(2,'0')}.png`);
      if(fs.existsSync(f))throw new Error('拒绝覆盖已有图片：'+f);
      fs.writeFileSync(f,Buffer.from(shot.data,'base64'));
      files.push(f);
    }
    return {ok:true,kind:'news-cards',pages:count,pageSize,files};
  },{width:1080,height:1440*Math.max(1,total)});
}catch(e){error=e;}
try{const clean=await cleanupBrowsers();if(result)result.browserCleanup=clean;}catch(e){error??=e;}
if(error){console.error(error.stack||error.message);process.exitCode=1;}else{console.log(JSON.stringify(result,null,2));}
