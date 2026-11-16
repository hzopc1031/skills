import { spawn } from 'node:child_process';
import path from 'node:path';

// Bound helper lifetime; retain byte boundaries before decoding UTF-8/UTF-16 output.
export function boundedRun(exe, args, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks=[]; let bytes=0, done=false;
    const finish = err => {
      if(done)return;done=true;clearTimeout(timer);
      if(err){reject(err);return;}
      const data=Buffer.concat(chunks);
      resolve(data.includes(0)?data.toString('utf16le'):data.toString('utf8'));
    };
    const timer=setTimeout(()=>{finish(new Error('helper timeout'));child.kill();child.stdout.destroy();child.stderr.destroy();child.unref();},timeout);
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>1048576){finish(new Error('helper output limit'));child.kill();}else chunks.push(b);});
    child.stderr.resume();child.on('error',()=>finish(new Error('helper unavailable')));
    child.on('close',code=>finish(code===0?null:new Error('helper failed')));
  });
}

export function listenerPids(text, port) {
  if (!/(?:^|\n)\s*(?:Proto\s+|TCP\s+)/.test(text)) throw new Error('unrecognized netstat output');
  const pids=new Set();
  for(const line of text.split(/\r?\n/)){
    const cols=line.trim().split(/\s+/);if(cols[0]!=='TCP')continue;
    if(cols.length!==5)throw new Error('invalid netstat row');if(cols[3]!=='LISTENING')continue;
    if(!/^\d+$/.test(cols[4])||Number(cols[4])<=0)throw new Error('invalid listener PID');
    const endpoint=cols[1].match(/^(?:\[[^\]]+\]|[^:]+):(\d+)$/);
    if(endpoint&&Number(endpoint[1])===port)pids.add(Number(cols[4]));
  }
  return [...pids].sort((a,b)=>a-b);
}

export async function queryProfile(port,profile,{allowAbsent=false,run=boundedRun}={}){
  const started=Date.now();
  if(process.platform!=='win32'||!Number.isInteger(port)||port<1024||port>65535||!profile||!path.isAbsolute(profile))throw new Error('invalid port/profile/platform');
  if(process.env.PUBLISH_SKIP_PROFILE_VERIFY==='1')throw new Error('Skipping browser profile verification is not permitted');
  const netstat=path.join(process.env.SystemRoot||'C:/Windows','System32/netstat.exe');
  const pids=listenerPids(await run(netstat,['-ano','-p','tcp'],5000),port);
  if(!pids.length){if(!allowAbsent)throw new Error('no listener');return{verified:false,listening:false,method:'netstat-targeted-cim-encoded',pids:[],elapsedMs:Date.now()-started};}
  if(pids.length!==1)throw new Error('ambiguous listener owners');
  // EncodedCommand prevents Windows argv quoting from rewriting regex/script literals.
  // Only the listener PID is queried. Full command lines are never returned or logged.
  const script=`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pids[0]}' -OperationTimeoutSec 6 -ErrorAction Stop
if(!$p -or !$p.CommandLine -or !$p.Name){throw 'process metadata unavailable'}
$m=[regex]::Matches($p.CommandLine,'(?:^|\\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\\s"]+)|--user-data-dir\\s+"([^"]+)"|--user-data-dir\\s+([^\\s"]+))(?=\\s|$)')
if($m.Count -ne 1){throw 'profile argument missing or ambiguous'}
$v=$null
foreach($i in 1..5){if($m[0].Groups[$i].Success){$v=$m[0].Groups[$i].Value;break}}
if(!$v){throw 'profile unavailable'}
[pscustomobject]@{pid=[int]$p.ProcessId;name=[string]$p.Name;profile=[string]$v}|ConvertTo-Json -Compress
`;
  const encoded=Buffer.from(script,'utf16le').toString('base64');
  const raw=await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],12000);
  let row;try{row=JSON.parse(raw.replace(/^\uFEFF/,'').trim());}catch{throw new Error('invalid process metadata');}
  const after=listenerPids(await run(netstat,['-ano','-p','tcp'],5000),port);
  if(!row||Array.isArray(row)||JSON.stringify(after)!==JSON.stringify(pids)||!Number.isInteger(row.pid)||row.pid!==pids[0])throw new Error('listener changed during verification');
  if(!/^(chrome|msedge)\.exe$/i.test(row.name||''))throw new Error('process/profile mismatch or unreadable');
  const normalize=value=>path.resolve(value).replace(/[\\/]+$/,'').toLowerCase();
  if(typeof row.profile!=='string'||!path.isAbsolute(row.profile)||normalize(row.profile)!==normalize(profile))throw new Error('process/profile mismatch or unreadable');
  return{verified:true,listening:true,method:'netstat-targeted-cim-encoded',pids,name:row.name,profile:row.profile,elapsedMs:Date.now()-started};
}
