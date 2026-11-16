import fs from 'node:fs';
import path from 'node:path';
import {withLocalRenderer} from './local-renderer.mjs';
import {SkillError,cleanImageText} from './util.mjs';

export function detailBlocks(texts) {
  const blocks=[];
  for(const raw of Array.isArray(texts)?texts:[texts]) {
    // 删除链接专行；正文中的域名/URL 同样删除，owner/repo 保留。
    const cleaned=cleanImageText(raw)
      .replace(/^详细介绍[（(]\d+\/\d+[）)]\s*\n*/,'');
    for(const part of cleaned.split(/\n(?=\d+[.、]\s)/)) {
      const s=part.trim(); if(!s) continue;
      const lines=s.split('\n');
      // 只有项目首行才作标题；普通长段落必须作为正文分页，不能误当巨型标题。
      if(/^\d+[.、]\s/.test(lines[0])) blocks.push({title:lines.shift(),text:lines.join('\n').trim()});
      else blocks.push({title:'详细内容',text:s});
    }
  }
  return blocks;
}

const HTML=`<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:1242px;height:1656px;background:#101820;color:#e7eef6;font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif}
body{padding:44px 54px}header{height:154px;border-bottom:2px solid #34424f;margin-bottom:30px}h1{font-size:44px;line-height:1.3;margin:0 0 14px;color:#57d391}.date{font-size:28px;color:#a8b8c9}
main{height:1308px;overflow:visible;display:flex;flex-direction:column;gap:24px}article{flex:none;border:1px solid #34424f;border-radius:18px;padding:24px 28px;background:#17232f}h2{font-size:34px;line-height:1.45;margin:0 0 18px;color:#8ccaff;overflow-wrap:anywhere}p{font-size:34px;line-height:1.65;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}footer{height:76px;display:flex;align-items:center;justify-content:space-between;font-size:26px;color:#a8b8c9}
</style><header><h1 id="heading"></h1><div class="date" id="date"></div></header><main></main><footer><span>项目详情 · 接上图阅读</span><span id="page"></span></footer>`;

export async function renderOverflow(job,{outDir,outPrefix}={}) {
  if(!job.githubDetailFallback&&(job.type==='github-ranking'||(job.githubIntro&&job.githubIntro.enabled!==false))) return renderGithubDetails(job,{outDir,outPrefix});
  const blocks=detailBlocks(job.overflowText??job.appendix??[]);
  if(!blocks.length) return {ok:true,images:[],pages:[],overflow:false,blocks:0};
  const base=job.jobFile?path.dirname(job.jobFile):process.cwd();
  const cfg=job.overflow??{};
  const dir=path.resolve(base,outDir??cfg.outDir??'out');
  fs.mkdirSync(dir,{recursive:true});
  const date=String(job.date??new Date().toLocaleDateString('en-CA'));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new SkillError('USAGE','详情图 date 必须为 YYYY-MM-DD');
  const prefix=outPrefix??cfg.prefix??('xhs_overflow_'+date.slice(5).replace('-',''));
  if(!/^[\w-]+$/.test(prefix)) throw new SkillError('USAGE','overflow.prefix 只能包含字母、数字、下划线和连字符');
  const intro=job.githubIntro?.enabled!==false&&(job.githubIntro!==undefined||job.type==='github-ranking');
  const offset=intro?1:0;
  const heading=cfg.heading??job.titleOriginal?.split(/[｜|]/)[0]??job.title?.split(/[｜|]/)[0]??'详细介绍';
  return withLocalRenderer(HTML,async ({evaluate,cdp})=>{
    await evaluate(`document.getElementById('heading').textContent=${JSON.stringify(heading)};document.getElementById('date').textContent=${JSON.stringify(date+' · 详细介绍')}`);
    const display=async list=>evaluate(`(()=>{const m=document.querySelector('main');m.replaceChildren();for(const b of ${JSON.stringify(list)}){const a=document.createElement('article'),h=document.createElement('h2'),p=document.createElement('p');h.textContent=b.title;p.textContent=b.text;a.append(h,p);m.append(a)}return [...m.children].reduce((n,e)=>n+e.getBoundingClientRect().height,0)+Math.max(0,m.children.length-1)*24<=m.clientHeight})()`);
    const pages=[];let current=[];
    const add=async b=>{
      if(await display([...current,b])) {current.push(b);return;}
      if(current.length) {pages.push(current);current=[];}
      if(await display([b])) {current=[b];return;}
      // 只有单项本身超整页才拆成续页；二分最大可放前缀，不删任何文字。
      let text=b.text,part=0;
      while(text.length) {
        const chars=[...text];let lo=1,hi=chars.length,fit=0;
        const title=b.title+(part?'（续）':'');
        while(lo<=hi) {const mid=Math.floor((lo+hi)/2);if(await display([{title,text:chars.slice(0,mid).join('')}])) {fit=mid;lo=mid+1;}else hi=mid-1;}
        if(!fit) throw new SkillError('RENDER_FAILED','单项标题或最小正文也无法放入详情页');
        if(fit<chars.length) {
          const prefix=chars.slice(0,fit).join('');
          const boundary=Math.max(prefix.lastIndexOf('\n'),prefix.lastIndexOf('。')+1,prefix.lastIndexOf('；')+1);
          if(boundary>prefix.length/2) fit=[...prefix.slice(0,boundary)].length;
        }
        const piece=chars.slice(0,fit).join('');
        pages.push([{title,text:piece,continued:part>0}]);text=chars.slice(fit).join('');part++;
      }
      if(!b.text) throw new SkillError('RENDER_FAILED','单项标题超出整页');
    };
    for(const block of blocks) await add(block);
    if(current.length) pages.push(current);
    const total=pages.length+offset+(job.images?.length??0);
    if(total>18) throw new SkillError('USAGE',`图片共 ${total} 张，超过18张上限`);
    const output=[];
    for(let i=0;i<pages.length;i++) {
      await display(pages[i]);
      const page=i+offset+1;
      await evaluate(`document.getElementById('page').textContent=${JSON.stringify(page+'/'+total)}`);
      const check=await evaluate(`(()=>{const m=document.querySelector('main'),r=m.getBoundingClientRect();const over=[];for(const e of document.querySelectorAll('header,h1,.date,main,article,h2,p,footer')){const b=e.getBoundingClientRect();if(e.scrollWidth>e.clientWidth+1||b.right>1242||b.bottom>1656||b.left<0||b.top<0)over.push(e.tagName);if(e.tagName==='ARTICLE'&&b.bottom>r.bottom+1)over.push('article below main')}return {overflow:over.length>0,over,font:getComputedStyle(document.querySelector('p')).fontFamily,body:document.querySelector('main').innerText}})()`);
      if(check.overflow) throw new SkillError('RENDER_FAILED','分页后仍溢出：'+JSON.stringify(check.over));
      const file=path.join(dir,`${prefix}_${String(page).padStart(2,'0')}.png`);
      const shot=await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1242,height:1656,scale:1}});
      fs.writeFileSync(file,Buffer.from(shot.data,'base64'));
      output.push({path:file,page,total,overflow:false,titles:pages[i].map(b=>b.title),text:check.body,font:check.font});
    }
    const result={ok:true,images:output.map(p=>p.path),pages:output,overflow:false,blocks:blocks.length,width:1242,height:1656,totalPages:total};
    fs.writeFileSync(path.join(dir,prefix+'-manifest.json'),JSON.stringify(result,null,2),'utf8');
    return result;
  });
}

// Two projects per page. Text is kept in full; font never drops below 40px.
async function renderGithubDetails(job,{outDir,outPrefix}={}) {
  const all=detailBlocks(job.overflowText??job.appendix??[]);
  const projects=all.filter(b=>/^\d+[.、\s]/.test(b.title));
  const extras=all.filter(b=>!projects.includes(b));
  // No structured appendix: keep the original body on the existing lossless paginator.
  if(!projects.length) return renderOverflow({...job,githubDetailFallback:true},{outDir,outPrefix});
  const base=job.jobFile?path.dirname(job.jobFile):process.cwd(),cfg=job.overflow??{};
  const dir=path.resolve(base,outDir??cfg.outDir??'out');fs.mkdirSync(dir,{recursive:true});
  const date=String(job.date??new Date().toLocaleDateString('en-CA'));
  const prefix=outPrefix??cfg.prefix??('xhs_overflow_'+date.slice(5).replace('-',''));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^[\w-]+$/.test(prefix)) throw new SkillError('USAGE','无效 date / overflow.prefix');
  const offset=job.githubIntro?.enabled===false?0:1;
  const groups=[];for(let i=0;i<projects.length;i+=2) groups.push(projects.slice(i,i+2));
  const total=groups.length+offset+(job.images?.length??0);
  if(total>18) throw new SkillError('USAGE',`图片共 ${total} 张，超过18张上限`);
  const html=`<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}html,body{width:1242px;height:2080px}body{padding:30px 42px;background:#f6f7f3;color:#14241e;font-family:"Microsoft YaHei",sans-serif}header{height:100px;border-bottom:4px solid #14241e;display:flex;align-items:center;justify-content:space-between}h1{font-size:45px}header span{font-size:28px;color:#455b4e}main{height:1870px;padding-top:16px;display:flex;flex-direction:column;gap:22px}article{border-bottom:2px solid #a9bbae;padding-bottom:18px;flex:none}h2{font-size:38px;line-height:1.2;overflow-wrap:anywhere;color:#155d3c;margin-bottom:6px}.meta{font-size:27px;color:#455b4e;margin-bottom:10px}p{font-size:var(--font,36px);line-height:1.40;overflow-wrap:anywhere;white-space:pre-wrap;margin-top:8px}b{color:#155d3c}.extra{font-size:var(--font,36px);line-height:1.4;border-left:6px solid #26734a;padding-left:18px;white-space:pre-wrap}footer{height:50px;display:flex;align-items:center;justify-content:space-between;color:#455b4e;font-size:25px}</style><header><h1>GitHub 热榜 · 项目详读</h1><span></span></header><main></main><footer><span>来源：GitHub Trending / 项目 README</span><span id="page"></span></footer>`;
  return withLocalRenderer(html,async({evaluate,cdp})=>{
    const pages=[];
    for(let i=0;i<groups.length;i++) {
      const tail=i===groups.length-1?extras:[];
      const page=i+offset+1;
      await evaluate(`(()=>{document.querySelector('header span').textContent=${JSON.stringify(date)};document.getElementById('page').textContent=${JSON.stringify(page+'/'+total)};const m=document.querySelector('main');m.replaceChildren();for(const b of ${JSON.stringify(groups[i])}){const a=document.createElement('article'),h=document.createElement('h2'),meta=document.createElement('div');const match=b.title.match(/^(.*?)[（(]([^]*)[）)]$/);h.textContent=match?match[1]:b.title;meta.className='meta';meta.textContent=match?match[2]:'';a.append(h,meta);for(const line of b.text.split('\\n').filter(Boolean)){const p=document.createElement('p'),s=line.match(/^(是什么|适合谁|我的看法)[：:](.*)$/);if(s){const label=document.createElement('b');label.textContent=s[1]+'：';p.append(label,document.createTextNode(s[2]))}else p.textContent=line;a.append(p)}m.append(a)}for(const b of ${JSON.stringify(tail)}){const e=document.createElement('div');e.className='extra';e.textContent=b.text;m.append(e)}})()`);
      let check,font;
      for(font=44;font>=40;font--) {
        check=await evaluate(`(()=>{document.body.style.setProperty('--font','${font}px');const m=document.querySelector('main'),r=m.getBoundingClientRect(),over=[];for(const e of document.querySelectorAll('header,h1,main,article,h2,.meta,p,.extra,footer')){const b=e.getBoundingClientRect();if(e.scrollWidth>e.clientWidth+1||b.right>1242||b.bottom>2080||b.left<0)over.push(e.tagName);if(e.closest('main')&&b.bottom>r.bottom+1)over.push('below main')}return {overflow:!!over.length,over,text:m.innerText,font:document.fonts.check('${font}px "Microsoft YaHei"'),bad:m.innerText.includes('\\uFFFD'),used:Math.max(...[...m.children].map(e=>e.getBoundingClientRect().bottom))-r.top}})()`);
        if(!check.overflow) break;
      }
      if(check.overflow||!check.font||check.bad) throw new SkillError('RENDER_FAILED',`第${page}页两个项目全文在40px仍无法放下或字体异常；停止，不缩字不删内容：${JSON.stringify(check.over)}`);
      const file=path.join(dir,`${prefix}_${String(page).padStart(2,'0')}.png`);
      const shot=await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1242,height:2080,scale:1}});
      fs.writeFileSync(file,Buffer.from(shot.data,'base64'));
      pages.push({path:file,page,total,overflow:false,fontSize:font,lineHeight:1.4,usedHeight:check.used,titles:groups[i].map(b=>b.title),blocks:groups[i],extras:tail,text:check.text});
    }
    const result={ok:true,images:pages.map(p=>p.path),pages,overflow:false,blocks:projects.length,width:1242,height:2080,totalPages:total,layout:'two-projects-full-text'};
    fs.writeFileSync(path.join(dir,prefix+'-manifest.json'),JSON.stringify(result,null,2),'utf8');return result;
  },{width:1242,height:2080});
}

export async function prepareOverflow(job,options={}) {
  if(job.overflowResult) return job;
  const result=await renderOverflow(job,options);
  job.overflowResult=result;
  job.images=[...result.images,...(job.images??[])];
  if(result.images.length&&job.githubIntro?.enabled!==false&&(job.githubIntro!==undefined||job.type==='github-ranking')) {
    job.githubIntro={...(job.githubIntro??{}),pageNumber:1,totalPages:result.totalPages};
  }
  return job;
}
