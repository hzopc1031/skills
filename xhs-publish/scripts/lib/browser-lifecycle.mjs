// Windows-only cleanup for an explicitly registered, exact user-data-dir.
// Never reads profile files or emits process command lines.
import path from 'node:path';
import { boundedRun, queryProfile } from './port-profile.mjs';

const sessions = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let keeping = false, cleanupPromise, handlersInstalled = false;

export function keepBrowser(value) { keeping = value === true; }
export function trackBrowser(port, profile, { temporary = false } = {}) {
  if (!path.isAbsolute(profile)) throw new Error('absolute browser profile required');
  const key = path.resolve(profile).toLowerCase();
  if (!sessions.has(key)) sessions.set(key, { port, profile: path.resolve(profile), known: [], temporary });
}

// Retain PID + creation time so children orphaned by Browser.close remain identifiable.
// Inspect only browser processes; exact argument parsing avoids prefix/path collisions.
async function profileProcesses(session, terminate = false) {
  const literal = value => "'" + value.replaceAll("'", "''") + "'";
  const script = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$wanted=${literal(session.profile)}
$known=ConvertFrom-Json ${literal(JSON.stringify(session.known))}
function ProfileOf($p) {
  $m=[regex]::Matches($p.CommandLine, '(?:^|\\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\\s"]+)|--user-data-dir\\s+"([^"]+)"|--user-data-dir\\s+([^\\s"]+))(?=\\s|$)')
  if($m.Count -ne 1){return ''}
  foreach($i in 1..5){if($m[0].Groups[$i].Success){return [IO.Path]::GetFullPath($m[0].Groups[$i].Value).TrimEnd('\\','/')}}
}
$all=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -OperationTimeoutSec 6)
if(@($all | Where-Object { !$_.CommandLine -or !$_.CreationDate }).Count){throw 'browser process metadata unavailable'}
$selected=@{}
foreach($p in $all){
  $same=(ProfileOf $p) -ieq $wanted.TrimEnd('\\','/')
  $retained=@($known | Where-Object { $_.pid -eq $p.ProcessId -and $_.created -eq $p.CreationDate.ToString('o') }).Count -gt 0
  if($same -or $retained){$selected[[int]$p.ProcessId]=$p}
}
do {
  $added=$false
  foreach($p in $all){
    $parent=$selected[[int]$p.ParentProcessId]
    if(!$selected.ContainsKey([int]$p.ProcessId) -and $parent -and $p.CreationDate -ge $parent.CreationDate){$selected[[int]$p.ProcessId]=$p;$added=$true}
  }
} while($added)
if(${terminate ? '$true' : '$false'}) {
  foreach($p in @($selected.Values | Sort-Object CreationDate -Descending)){
    $now=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ProcessId)" -OperationTimeoutSec 6
    if($now -and $now.CreationDate -eq $p.CreationDate -and $now.Name -eq $p.Name){
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop }
      catch { if(Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue){throw} }
    }
  }
}
$rows=@($selected.Values | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;created=$_.CreationDate.ToString('o')} })
ConvertTo-Json -InputObject $rows -Compress
`;
  const raw = await boundedRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 15000);
  const rows = JSON.parse(raw.replace(/^\uFEFF/, '').trim());
  if (!Array.isArray(rows)) throw new Error('invalid browser process query');
  session.known = rows;
  return rows;
}

async function gracefulClose(session) {
  // Reverify port ownership immediately before sending a browser-wide CDP command.
  await queryProfile(Number(session.port), session.profile);
  const response = await fetch(`http://127.0.0.1:${session.port}/json/version`, { signal: AbortSignal.timeout(3000) });
  const version = await response.json();
  const url = new URL(version.webSocketDebuggerUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port) !== Number(session.port)) throw new Error('invalid local CDP endpoint');
  await new Promise(resolve => {
    const ws = new WebSocket(url);
    const done = () => { clearTimeout(timer); try { ws.close(); } catch {} resolve(); };
    const timer = setTimeout(done, 3000);
    ws.addEventListener('open', () => { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); });
    ws.addEventListener('close', done);
    ws.addEventListener('error', done);
  });
}

export async function closeProfileBrowser(port, profile) {
  if (!path.isAbsolute(profile)) throw new Error('absolute browser profile required');
  const key = path.resolve(profile).toLowerCase();
  const session = sessions.get(key) || { profile: path.resolve(profile), known: [] };
  session.port = port;
  sessions.set(key, session);
  if (!(await profileProcesses(session)).length) return { profile, remaining: 0 };
  try { await gracefulClose(session); } catch { /* CDP unavailable: exact profile fallback below. */ }
  for (let i = 0; i < 4; i++) {
    await delay(500);
    if (!(await profileProcesses(session)).length) return { profile, remaining: 0 };
  }
  await profileProcesses(session, true);
  for (let i = 0; i < 6; i++) {
    await delay(500);
    if (!(await profileProcesses(session)).length) return { profile, remaining: 0, forced: true };
  }
  throw new Error(`Chrome cleanup failed: ${profile}; remaining=${session.known.length}`);
}

export function cleanupBrowsers() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const results = [], failures = [];
    for (const session of sessions.values()) {
      if (keeping && !session.temporary) { results.push({ profile: session.profile, kept: true }); continue; }
      try { results.push(await closeProfileBrowser(session.port, session.profile)); }
      catch (e) { failures.push(e.message); }
    }
    if (failures.length) throw new Error(failures.join('; '));
    return results;
  })();
  return cleanupPromise;
}

// Synchronous exit hooks cannot await cleanup. Handle interrupt/fatal paths explicitly.
export function installCleanupHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  let stopping = false;
  const stop = async (code, reason) => {
    if (stopping) return;
    stopping = true;
    if (reason) process.stderr.write(`Browser command aborted: ${reason}\n`);
    try { await cleanupBrowsers(); }
    catch (e) { process.stderr.write(`${e.message}\n`); code = 6; }
    process.exit(code);
  };
  process.on('SIGINT', () => { void stop(130); });
  process.on('SIGTERM', () => { void stop(143); });
  process.on('uncaughtException', () => { void stop(6, 'uncaught exception'); });
  process.on('unhandledRejection', () => { void stop(6, 'unhandled rejection'); });
}
