// 只启动独立临时 Chrome；随机端口，绝不复用登录浏览器。
import { trackBrowser, closeProfileBrowser, installCleanupHandlers } from './browser-lifecycle.mjs';
installCleanupHandlers();
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {CDP,findBrowser} from './cdp.mjs';
import {sleep,SkillError} from './util.mjs';

export async function withLocalRenderer(html,run,{width=1242,height=1660}={}) {
  if(![width,height].every(n=>Number.isInteger(n)&&n>=320&&n<=8192)) throw new SkillError('RENDER_FAILED','无效渲染尺寸');
  if(html.includes('\uFFFD')) throw new SkillError('RENDER_FAILED','文本含乱码替换字符');
  const chrome=findBrowser();
  if(!chrome) throw new SkillError('RENDER_FAILED','未找到本机 Chrome');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xhs-overflow-'));
  const profile=path.join(tmp,'profile');
  const child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','--no-proxy-server','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
  trackBrowser(0, profile, { temporary: true });
  let cdp,spawnError,port;
  child.on('error',e=>{spawnError=e;});
  try {

    for(let i=0;i<100&&!port;i++) {
      if(spawnError) throw spawnError;
      await sleep(200);
      try {port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);} catch {}
    }
    if(!port||[9333,9334,9335].includes(port)) throw new Error('临时渲染端口无效或命中保护端口');
    const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target=targets.find(t=>t.type==='page');
    if(!target) throw new Error('渲染页面未就绪');
    cdp=await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const {frameTree}=await cdp.send('Page.getFrameTree');
    await cdp.send('Page.setDocumentContent',{frameId:frameTree.frame.id,html});
    const evaluate=async expression=>{
      const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
      return r.result.value;
    };
    await evaluate('document.fonts.ready.then(()=>true)');
    return await run({evaluate,cdp,port});
  } catch(e) {if(e instanceof SkillError) throw e;throw new SkillError('RENDER_FAILED','详情图渲染停止：'+e.message);}
  finally {
    cdp?.close();
    await closeProfileBrowser(port || 0, profile);
    // 保留 profile；清理只结束进程。
  }
}
