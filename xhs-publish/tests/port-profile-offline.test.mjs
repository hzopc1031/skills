// Injected diagnostic runner only: never starts a subprocess/browser or reads a profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listenerPids, queryProfile } from '../scripts/lib/port-profile.mjs';
const desired='C:\\offline-only\\chrome-profile';
const owner=(pid=1234)=>`Proto Local Foreign State PID\nTCP 127.0.0.1:9333 0.0.0.0:0 LISTENING ${pid}\n`;
const valid=()=>({pid:1234,name:'chrome.exe',profile:desired});
const prior=process.env.PUBLISH_SKIP_PROFILE_VERIFY;
test.before(()=>{delete process.env.PUBLISH_SKIP_PROFILE_VERIFY;});
test.after(()=>{if(prior===undefined)delete process.env.PUBLISH_SKIP_PROFILE_VERIFY;else process.env.PUBLISH_SKIP_PROFILE_VERIFY=prior;});
function runner(row=valid(),{after=1234,absent=false,fail=false,raw}={}){
  let calls=0;const seen=[];
  const run=async(exe,args)=>{
    seen.push({exe,args});if(fail)throw new Error('offline diagnostic failure');
    if(exe.toLowerCase().endsWith('netstat.exe'))return absent?'Proto Local Foreign State PID\n':owner(++calls===1?1234:after);
    assert.equal(exe,'powershell.exe');assert.equal(args[2],'-EncodedCommand');
    const script=Buffer.from(args[3],'base64').toString('utf16le');
    assert.match(script,/Get-CimInstance Win32_Process -Filter 'ProcessId=1234'/);
    assert.match(script,/pid=\[int\]\$p.ProcessId/);
    assert.doesNotMatch(script,/Get-Process|WMIC|profileUnverified/);
    return raw??JSON.stringify(row);
  };
  return {run,seen};
}
const windows={skip:process.platform!=='win32'};

test('offline netstat parser deduplicates IPv4/IPv6 listeners',()=>{
  const data=owner()+ 'TCP [::1]:9333 [::]:0 LISTENING 1234\nTCP 127.0.0.1:9334 0.0.0.0:0 LISTENING 999\n';
  assert.deepEqual(listenerPids(data,9333),[1234]);
  assert.throws(()=>listenerPids('invalid',9333));
});
test('strict same PID/name/absolute profile succeeds using encoded targeted CIM',windows,async()=>{
  const f=runner();const r=await queryProfile(9333,desired,{run:f.run});
  assert.equal(r.verified,true);assert.equal(r.profile,desired);assert.equal(r.profileUnverified,undefined);
  assert.equal(f.seen.length,3);
});
test('invalid PID JSON types, absent PID and mismatch all reject',windows,async()=>{
  for(const pid of ['1234',null,undefined,{},1234.5,4321]){
    const f=runner({...valid(),pid});await assert.rejects(queryProfile(9333,desired,{run:f.run}));
  }
});
test('actual listener transition rejects even when process row matches old PID',windows,async()=>{
  const f=runner(valid(),{after:4321});await assert.rejects(queryProfile(9333,desired,{run:f.run}),/listener changed/);
});
test('unreadable/missing/relative/wrong profile never becomes profileUnverified success',windows,async()=>{
  for(const profile of [null,undefined,'relative','C:\\offline-other\\chrome-profile']){
    const f=runner({...valid(),profile});await assert.rejects(queryProfile(9333,desired,{run:f.run}),/profile mismatch|unreadable/);
    assert.equal(f.seen.some(call=>call.args.some(arg=>String(arg).includes('Get-Process'))),false);
  }
});
test('nonbrowser process and malformed JSON/arrays reject',windows,async()=>{
  for(const row of [{...valid(),name:'node.exe'},[],null]){
    const f=runner(row);await assert.rejects(queryProfile(9333,desired,{run:f.run}));
  }
  const f=runner(valid(),{raw:'not-json'});await assert.rejects(queryProfile(9333,desired,{run:f.run}),/invalid process metadata/);
});
test('allowAbsent is supported only with successful empty netstat evidence',windows,async()=>{
  const f=runner(valid(),{absent:true});const r=await queryProfile(9333,desired,{run:f.run,allowAbsent:true});
  assert.equal(r.listening,false);assert.equal(r.verified,false);assert.equal(f.seen.length,1);
  const failed=runner(valid(),{fail:true});await assert.rejects(queryProfile(9333,desired,{run:failed.run,allowAbsent:true}));
});
test('skip-verification environment is a hard error before diagnostics',windows,async()=>{
  process.env.PUBLISH_SKIP_PROFILE_VERIFY='1';const f=runner();
  try {await assert.rejects(queryProfile(9333,desired,{run:f.run}),/not permitted/);assert.equal(f.seen.length,0);}
  finally {delete process.env.PUBLISH_SKIP_PROFILE_VERIFY;}
});
