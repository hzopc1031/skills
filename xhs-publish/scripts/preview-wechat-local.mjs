#!/usr/bin/env node
// Local phone-width layout proof, never a claim that a WeChat draft was saved.
import fs from 'node:fs';
import path from 'node:path';
import {withLocalRenderer} from './lib/local-renderer.mjs';
import {cleanupBrowsers} from './lib/browser-lifecycle.mjs';
const args=process.argv.slice(2),i=args.indexOf('--job');if(i<0)throw new Error('--job required');
const file=path.resolve(args[i+1]),root=path.dirname(file),job=JSON.parse(fs.readFileSync(file,'utf8'));
let body=fs.readFileSync(path.resolve(root,job.htmlFile),'utf8');
for(const im of job.inlineImages){const p=path.resolve(root,im.file),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(p).toLowerCase()];if(!mime)throw new Error('Unsupported image format');const marker=`<!--WECHAT_INLINE_IMAGE:${im.id}-->`;if(body.split(marker).length!==2)throw new Error('Unique image slot required');body=body.replace(marker,`<img src="data:${mime};base64,${fs.readFileSync(p).toString('base64')}" style="max-width:100%;height:auto;display:block;margin:0 auto;">`);}
if(/WECHAT_INLINE_IMAGE/.test(body))throw new Error('Unbound image slot');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(job.title)}</title><style>html{scrollbar-width:none}::-webkit-scrollbar{display:none}*{box-sizing:border-box}body{margin:0;background:#fff;font-family:Arial,'Microsoft YaHei',sans-serif}img{max-width:100%}</style><body><header style="padding:22px 20px 0"><p style="font-size:11px;letter-spacing:2px;color:#71717a;margin:0 0 18px">LOCAL MOBILE LAYOUT · 本地排版预览</p><h1 style="font-size:24px;line-height:1.45;font-weight:600;margin:0 0 15px">${esc(job.title)}</h1><p style="font-size:13px;color:#71717a;margin:0 0 26px">${esc(job.author||'TwoPeanuts')}　${esc(String(job.date||'').replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1年$2月$3日'))}</p></header>${body}</body></html>`;
fs.writeFileSync(path.join(root,'preview.wechat.html'),html,'utf8');
let result,error;
try{result=await withLocalRenderer(html,async({evaluate,cdp})=>{
 await evaluate('Promise.all([document.fonts.ready,...[...document.images].map(i=>i.complete?Promise.resolve():new Promise((r,j)=>{i.onload=r;i.onerror=j}))]).then(()=>true)');
 const check=await evaluate(`(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,images:[...document.images].map(i=>({loaded:i.complete&&i.naturalWidth>0,width:i.getBoundingClientRect().width})),chapterY:[...document.querySelectorAll('h3')].map(e=>({text:e.innerText,y:e.getBoundingClientRect().top}))}))()`);
 if(check.scrollWidth>390||check.images.length!==job.inlineImages.length||check.images.some(i=>!i.loaded))throw new Error('Phone layout/images invalid');
 for(const [name,y,height] of [['wechat-mobile-top',0,Math.min(1600,check.height)],['wechat-mobile-full',0,check.height]]){const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y,width:390,height,scale:1}});fs.writeFileSync(path.join(root,name+'.png'),Buffer.from(shot.data,'base64'));}
 return {ok:true,kind:'local-layout-only-not-platform-save',...check};
},{width:390,height:844});}catch(e){error=e;}
try{const clean=await cleanupBrowsers();if(result)result.browserCleanup=clean;}catch(e){error??=e;}
if(error){console.error(error.stack);process.exitCode=1;}else{fs.writeFileSync(path.join(root,'preview-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
