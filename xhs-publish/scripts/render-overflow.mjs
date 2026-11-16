#!/usr/bin/env node
import {readJob,parseArgs,jsonOut,codeToExit,SkillError} from './lib/util.mjs';
import {renderOverflow} from './lib/overflow.mjs';
try {
 const args=parseArgs(process.argv.slice(2));
 if(typeof args.data!=='string') throw new SkillError('USAGE','用法：node render-overflow.mjs --data <job> --out-dir <dir>');
 jsonOut(await renderOverflow(readJob(args.data),{outDir:args['out-dir']}));
 process.exit(0);
} catch(e) {const code=e.code==='USAGE'?'USAGE':'RENDER_FAILED';jsonOut({ok:false,code,message:e.message});process.exit(codeToExit(code));}
