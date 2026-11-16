#!/usr/bin/env node
// stdout 只输出 JSON；日志走 stderr。退出码见 SKILL.md。
import fs from 'node:fs';
import { keepBrowser, trackBrowser, cleanupBrowsers, installCleanupHandlers } from './lib/browser-lifecycle.mjs';
import { findBrowser, ping, verifyBrowserProfile } from './lib/cdp.mjs';
import { ensureBrowser, isLoggedIn, homeIdentity, assertAccount, publish, XHS } from './lib/xhs.mjs';
import { editNote } from './lib/note-edit.mjs';
import { readEditJob } from './lib/edit-job.mjs';
import { buildPromotionPreflight } from './lib/promotion-preflight.mjs';
import {
  parseArgs, jsonOut as emitJson, log, readJob, SkillError, codeToExit,
  profileDir, artifactsDir, stamp, sleep, dataRoot, readAccounts, resolveAccount,
} from './lib/util.mjs';

let commandResult;
function jsonOut(value) { commandResult = value; }
installCleanupHandlers();

const HELP = `小红书多账户发布工具（零依赖，本机 Chrome）v0.9.0
用法:
  node xhs.mjs doctor --account ai
  node xhs.mjs status --account ai
  node xhs.mjs login --account house [--timeout 300]  由用户扫码登录
  node xhs.mjs inspect --account ai [--out file.json]
  node xhs.mjs preflight --job job.json [--kind post|edit]  纯离线推广预检，不读账户/profile，不启动浏览器
  node xhs.mjs post --job job.json [--account ai] [--submit]
  node xhs.mjs edit --job job.edit.json [--account ai] [--submit]   精确定位原笔记，只改 edit 显式字段/图片

选项:
  --keep-browser        仅调试：保留本次浏览器；正常操作禁止使用
  --account <别名>       账户别名；非 post/edit 命令可用 accounts.json 的非空 default
  --accounts-file <路径> 覆盖 skill 目录的 accounts.json（相对当前工作目录）
  --submit              请求提交；job.submit:false 始终阻止提交
  --link-policy strip|describe|keep   外链处理，默认 strip（删除 URL 和域名路径）
  --json                默认输出 JSON

post 必须通过 --account 或 job.account 显式确定账户，两者同时给出必须一致。
未知/缺失/冲突账户在连接浏览器前报 USAGE；post 不使用 default。
端口和 profile 只取账户配置，不允许 --port 覆盖。
post 在打开发布页前校验首页昵称及已配置的小红书号；期望昵称为空一律拒绝。
房产稿用 house，AI/科技稿用 ai；不确定该用哪个号就停下来问 Liu，不要猜。
无本地已审图片的旧平台一键排版长文会在浏览器连接前停止；先独立本地制卡、逐张审阅并绑定SHA256后用图文发布。
退出码: 0 成功 / 1 USAGE / 2 LOGIN_REQUIRED / 3 PAGE_CHANGED / 4 UPLOAD_FAILED /
        5 PUBLISH_FAILED / 6 BROWSER_FAILED / 7 ACCOUNT_MISMATCH / 8 RENDER_FAILED / 9 CONTENT_REVIEW_REQUIRED`;

function accountInfo(account) {
  return { account: account.alias, label: account.label, port: account.port, profile: profileDir(account) };
}

async function cmdDoctor(account) {
  const exe = findBrowser();
  const profileCheck = await verifyBrowserProfile(account.port, profileDir(account), { allowAbsent: true });
  if (profileCheck.listening) trackBrowser(account.port, profileDir(account));
  const running = profileCheck.listening ? await ping(account.port) : null;
  if (!exe) throw new SkillError('BROWSER_FAILED', '找不到 Chrome / Edge，设置 CHROME_PATH 环境变量');
  jsonOut({
    ok: true, platform: 'xiaohongshu', ...accountInfo(account),
    browser: exe, node: process.version, browserRunning: Boolean(running),
    browserVersion: running?.Browser || null, profileCheck,
    dataRoot: dataRoot(), artifacts: artifactsDir(account),
  });
}

async function cmdLogin(opts, account) {
  const timeout = Number(opts.timeout || 300) * 1000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new SkillError('USAGE', '--timeout 必须为正数');
  const page = await ensureBrowser(account);
  log('打开创作者首页，请用户用小红书 App 扫码登录…');
  await page.goto(XHS.home, { timeout: 60000 });
  const t0 = Date.now();
  let loggedIn = false;
  let lastNotice = 0;
  while (Date.now() - t0 < timeout) {
    loggedIn = await isLoggedIn(page);
    if (loggedIn) break;
    if (Date.now() - lastNotice > 15000) {
      log('等待用户扫码… 已等 ' + Math.round((Date.now() - t0) / 1000) + 's');
      lastNotice = Date.now();
    }
    await sleep(2500);
  }
  if (!loggedIn) throw new SkillError('LOGIN_REQUIRED', '登录超时或未完成', '请用户重跑 login --account ' + account.alias);
  const identity = await homeIdentity(page);
  const shot = await page.screenshot(artifactsDir(account) + '/login-' + stamp() + '.png').catch(() => null);
  jsonOut({ ok: true, platform: 'xiaohongshu', ...accountInfo(account), loggedIn: identity.loggedIn,
    nickname: identity.nickname, redId: identity.redId, url: identity.url, screenshot: shot });
}

async function cmdInspect(opts, account) {
  const page = await ensureBrowser(account);
  await page.goto(XHS.publish, { timeout: 60000 });
  await sleep(2500);
  const data = await page.inspect();
  data.loggedIn = await isLoggedIn(page);
  data.account = account.alias;
  const out = opts.out ? String(opts.out) : artifactsDir(account) + '/inspect-' + stamp() + '.json';
  fs.writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
  jsonOut({ ok: true, platform: 'xiaohongshu', ...accountInfo(account), loggedIn: data.loggedIn,
    out, url: data.url, buttons: data.buttons?.length, editables: data.editables?.length, inputs: data.inputs?.length });
}

async function cmdStatus(account) {
  const page = await ensureBrowser(account);
  const identity = await assertAccount(page, account);
  const expectedNickname = account.expectedNickname?.trim() || null;
  const expectedRedId = account.expectedRedId?.trim() || null;
  jsonOut({
    ok: true, platform: 'xiaohongshu', ...accountInfo(account),
    loggedIn: identity.loggedIn, nickname: identity.nickname, redId: identity.redId,
    expectedNickname,
    nicknameMatches: Boolean(identity.loggedIn && expectedNickname && identity.nickname === expectedNickname),
    expectedRedId,
    redIdMatches: expectedRedId ? Boolean(identity.loggedIn && identity.redId === expectedRedId) : null,
    url: identity.url,
  });
}

function cmdPreflight(opts) {
  if (typeof opts.job !== 'string' || !opts.job) throw new SkillError('USAGE', '缺少 --job 文件路径');
  const kind = opts.kind ?? 'post';
  if (!['post', 'edit'].includes(kind)) throw new SkillError('USAGE', '--kind 必须为 post 或 edit');
  if (Object.hasOwn(opts, 'submit')) throw new SkillError('USAGE', 'preflight 纯离线，不接受 --submit');
  const job = kind === 'edit' ? readEditJob(opts.job) : readJob(opts.job, { linkPolicy:opts['link-policy'] });
  const promotionPreflight = buildPromotionPreflight(job, { kind, phase:'offline' });
  if (!promotionPreflight.ready) {
    const error = new SkillError('CONTENT_REVIEW_REQUIRED', '离线预检尚未通过；参见 promotionPreflight，不会启动浏览器或修改任务');
    error.promotionPreflight = promotionPreflight;
    throw error;
  }
  jsonOut({ ok:true, platform:'xiaohongshu', command:'preflight', offlineOnly:true, heuristic:true, guarantee:false, promotionPreflight });
}

async function cmdPost(opts, config) {
  if (typeof opts.job !== 'string' || !opts.job) throw new SkillError('USAGE', '缺少 --job 文件路径');
  const job = readJob(opts.job, { linkPolicy: opts['link-policy'] });
  // 必须先解决账户，再允许任何浏览器连接。post 永不使用 default。
  const account = resolveAccount(config, opts.account, job.account, { post: true });
  const doSubmit = !job.submitDisabled && (Boolean(opts.submit) || job.submit);
  const result = await publish(job, { account, submit: doSubmit });
  jsonOut({ ...result, ...accountInfo(account) });
}

async function cmdEdit(opts, config) {
  if (Object.hasOwn(opts, 'submit') && opts.submit !== true) throw new SkillError('USAGE', '--submit 是无参数开关；禁用保存请用 job.submit:false');
  if (typeof opts.job !== 'string' || !opts.job) throw new SkillError('USAGE', '缺少 --job 文件路径');
  if (Object.hasOwn(opts, 'link-policy') && !['strip','describe','keep'].includes(opts['link-policy'])) throw new SkillError('USAGE', '--link-policy 必须为 strip/describe/keep；edit 仅兼容该参数，显式新正文固定净化链接，原正文保持');
  const job = readEditJob(opts.job);
  const account = resolveAccount(config, opts.account, job.account, { post: true });
  const doSubmit = !job.submitDisabled && (Boolean(opts.submit) || job.submit);
  const result = await editNote(job, { account, submit: doSubmit });
  jsonOut({ ...result, ...accountInfo(account) });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0] || 'help';
  let exitCode = 0;
  keepBrowser(opts['keep-browser'] === true);
  try {
    if (Object.hasOwn(opts, 'keep-browser') && opts['keep-browser'] !== true) throw new SkillError('USAGE', '--keep-browser 不接受参数值');
    if (cmd === 'help' || opts.help) { process.stdout.write(HELP + '\n'); return; }
    if (!['doctor', 'status', 'login', 'inspect', 'post', 'edit', 'preflight'].includes(cmd)) throw new SkillError('USAGE', '未知命令: ' + cmd);
    if (Object.hasOwn(opts, 'port')) throw new SkillError('USAGE', '不支持 --port，请在 accounts.json 为账户配置独立端口');
    if (cmd === 'preflight') cmdPreflight(opts);
    else {
      const config = readAccounts(opts['accounts-file']);
      if (cmd === 'post' || cmd === 'edit') await (cmd === 'post' ? cmdPost(opts, config) : cmdEdit(opts, config));
      else {
        const account = resolveAccount(config, opts.account);
        if (cmd === 'doctor') await cmdDoctor(account);
        else if (cmd === 'status') await cmdStatus(account);
        else if (cmd === 'login') await cmdLogin(opts, account);
        else if (cmd === 'inspect') await cmdInspect(opts, account);
      }
    }

  } catch (e) {
    const code = e instanceof SkillError ? e.code : 'USAGE';
    jsonOut({ ok: false, platform: 'xiaohongshu', command: cmd, code,
      message: e.message, hint: e.hint || '', screenshot: e.shot || null, inspect:e.inspect||null,
      ...(cmd === 'preflight' ? { offlineOnly:true, heuristic:true, guarantee:false } : {}),
      ...(e.promotionPreflight ? { promotionPreflight:e.promotionPreflight } : {}),
      ...(e.editEvidence ? { editEvidence:e.editEvidence, submissionAttempted:e.submissionAttempted, saveOutcome:e.saveOutcome } : {}) });
    exitCode = codeToExit(code);
  } finally {
    try {
      const browserCleanup = await cleanupBrowsers();
      if (commandResult) commandResult.browserCleanup = browserCleanup;
    } catch (e) {
      commandResult = { ...commandResult, ok: false, code: 'BROWSER_FAILED',
        message: '浏览器关闭失败：' + e.message, operationCode: commandResult?.code,
        hint: '运行 close-browser.mjs 按精确 profile 清理，并确认 remaining:0；不要重做已成功的发布/草稿操作' };
      exitCode = 6;
    }
    if (commandResult) emitJson(commandResult);
  }
  process.exit(exitCode);
}

main();
