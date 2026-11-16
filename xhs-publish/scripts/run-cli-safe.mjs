#!/usr/bin/env node
// Byte-preserving ordinary-Node CLI launcher; avoids PowerShell UTF-16/mojibake redirection.
// --platform xhs|wechat --out-prefix ABSOLUTE_PREFIX -- <CLI command and arguments>
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2),cut=args.indexOf('--');if(cut<0)throw new Error('CLI argument separator required');
const opts=args.slice(0,cut),get=k=>opts[opts.indexOf(k)+1];
const platform=get('--platform'),prefix=get('--out-prefix');
if(!['xhs','wechat'].includes(platform)||!prefix||!path.isAbsolute(prefix))throw new Error('Explicit platform and absolute output prefix required');
const cliArgs=args.slice(cut+1);
if(platform==='wechat'&&cliArgs.includes('--submit'))throw new Error('WeChat is drafts only');
if(cliArgs.includes('--keep-browser'))throw new Error('Browser cleanup must remain enabled');
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const entry=path.join(base,platform==='xhs'?'xhs-publish':'wechat-publish','scripts',platform==='xhs'?'xhs.mjs':'wechat.mjs');
const outputs=[prefix+'.json',prefix+'.err.txt',prefix+'.run.json'];
for(const f of outputs)if(fs.existsSync(f))throw new Error('Never overwrite a receipt: '+f);
fs.mkdirSync(path.dirname(prefix),{recursive:true});
const stdout=fs.openSync(outputs[0],'wx'),stderr=fs.openSync(outputs[1],'wx');
let run;
try{run=spawnSync(process.execPath,[entry,...cliArgs],{windowsHide:true,stdio:['ignore',stdout,stderr],env:{...process.env,PUBLISH_SKILL_DATA:'D:\\AIInfra\\agent-publish',PUBLISH_SKIP_PROFILE_VERIFY:'0'}});}finally{fs.closeSync(stdout);fs.closeSync(stderr);}
const meta={platform,entry,command:cliArgs[0],exitCode:run.status,signal:run.signal,error:run.error?.message,finishedAt:new Date().toISOString(),result:outputs[0],errors:outputs[1]};
fs.writeFileSync(outputs[2],JSON.stringify(meta,null,2));console.log(JSON.stringify(meta,null,2));process.exitCode=run.status??1;
