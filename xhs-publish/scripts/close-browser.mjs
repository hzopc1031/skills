#!/usr/bin/env node
// Recovery command: closes only the explicitly supplied absolute profile.
import path from 'node:path';
import { closeProfileBrowser } from './lib/browser-lifecycle.mjs';
const args = process.argv.slice(2);
const get = key => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
try {
  const profile = get('--profile'), port = Number(get('--port') || 0);
  if (!profile || !path.isAbsolute(profile) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('need --profile <absolute user-data-dir> [--port <n>]');
  const result = await closeProfileBrowser(port, profile);
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: 'BROWSER_FAILED', message: e.message }));
  process.exitCode = 6;
}
