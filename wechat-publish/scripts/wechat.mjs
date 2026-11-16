#!/usr/bin/env node
// 微信公众号草稿保存 CLI —— 只存草稿，不发表；供任意 AI Agent 调用。
// stdout 只输出 JSON；日志走 stderr；退出码见 SKILL.md。
import { prepareGithubIntro } from './lib/github-intro.mjs';
import { keepBrowser, trackBrowser, cleanupBrowsers, installCleanupHandlers } from './lib/browser-lifecycle.mjs';
import { findBrowser, ping, verifyBrowserProfile } from './lib/cdp.mjs';
import {
  parseArgs, jsonOut as emitJson, log, readJob, SkillError, codeToExit,
  profileDir, artifactsDir, stamp, sleep, dataRoot, preflight, coverPlan,
} from './lib/util.mjs';
import { WECHAT, isLoggedIn, publish, ensureBrowser as selectWorkPage, requireLoggedIn } from './lib/wechat.mjs';

let commandResult;
function jsonOut(value) { commandResult = value; }
installCleanupHandlers();

const HELP = `微信公众号草稿保存工具（只存草稿，不发表；零依赖，驱动本机 Chrome）

用法:
  node wechat.mjs doctor                  环境自检
  node wechat.mjs status                  只查登录态
  node wechat.mjs login [--timeout 300]   打开 mp.weixin.qq.com 扫码登录
  node wechat.mjs inspect [--out f.json]  dump 编辑器结构（选择器排查）
  node wechat.mjs post --job job.json     填写内容，显式保存为草稿并确认结果
  node wechat.mjs check --job job.json    纯离线校验路径、HTML、章节配图（不访问浏览器）

选项:
  --keep-browser        仅调试：保留本次浏览器；正常操作禁止使用
  --port <n>       固定为 9335；拒绝 ai 9333 / house 9334 及其它端口
  --submit         已禁用，传入即报错；job.submit 为真也报错，绝不会发表
  --link-policy describe|strip|keep   外链处理，默认 describe
  --json           机器可读输出（默认就是）

任务可选 htmlFile（UTF-8 section HTML）和 inlineImages:[{id,file}]；图片位为 <!--WECHAT_INLINE_IMAGE:id-->。
post 的 JSON 输出包含 savedAsDraft: true/false；未确认保存成功时返回错误。
check 不生成 GitHub 简介图、不启动/连接浏览器、不读 profile，也不保存草稿。

退出码: 0 成功 / 1 用法或内容不合规 / 2 需要登录 / 3 页面结构变了 / 4 上传失败 / 5 草稿保存失败 / 6 浏览器异常`;

async function cmdDoctor(opts) {
  const port = Number(opts.port || 9335);
  if (port !== 9335) throw new SkillError('BROWSER_FAILED', '公众号固定使用 9335，拒绝占用 ai/house 端口');
  const exe = findBrowser();
  const owner = await verifyBrowserProfile(port, profileDir('wechat'), { allowAbsent: true });
  if (owner.listening) trackBrowser(port, profileDir('wechat'));
  const running = owner.listening ? await ping(port) : null;
  if (!exe) throw new SkillError('BROWSER_FAILED', '找不到 Chrome / Edge，设置 CHROME_PATH');
  jsonOut({
    ok: true,
    platform: 'wechat',
    browser: exe,
    node: process.version,
    port,
    browserRunning: Boolean(running),
    profileVerified: owner.verified,
    listenerPids: owner.pids,
    browserVersion: running?.Browser || null,
    dataRoot: dataRoot(),
    profile: profileDir('wechat'),
    artifacts: artifactsDir('wechat'),
  });
}

async function ensureBrowser(port) {
  return selectWorkPage(port);
}

async function cmdLogin(opts) {
  const port = Number(opts.port || 9335);
  const timeout = Number(opts.timeout || 300) * 1000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new SkillError('USAGE', '--timeout 必须为正数');
  const page = await selectWorkPage(port, {allowQr:true});
  log('打开公众号后台，请用微信扫码登录…');

  const t0 = Date.now();
  let logged = false;
  let lastNotice = 0;
  while (Date.now() - t0 < timeout) {
    logged = await isLoggedIn(page);
    if (logged) break;
    if (Date.now() - lastNotice > 15000) {
      log(`等待扫码… 已等 ${Math.round((Date.now() - t0) / 1000)}s`);
      lastNotice = Date.now();
    }
    await sleep(2500);
  }
  if (!logged) throw new SkillError('LOGIN_REQUIRED', '登录超时', '重跑 login，扫码完成后脚本自动关闭窗口');
  jsonOut({ ok: true, platform: 'wechat', loggedIn: true, url: await page.url() });
}

async function cmdStatus(opts) {
  const port = Number(opts.port || 9335);
  const page = await ensureBrowser(port);
  try {
    await requireLoggedIn(page);
    jsonOut({ ok: true, platform: 'wechat', loggedIn:true, url:await page.url(), profile:profileDir('wechat'), targetId:page.targetId });
  } finally { await page.dispose({closeOwned:true}); }
}

async function cmdInspect(opts) {
  const port = Number(opts.port || 9335);
  const page = await ensureBrowser(port);
  await requireLoggedIn(page);
  const data = await page.inspect();
  data.loggedIn = await isLoggedIn(page);
  data.frames = await page
    .eval(`[...document.querySelectorAll('iframe')].map(f => ({ src: f.src || '', w: Math.round(f.getBoundingClientRect().width), h: Math.round(f.getBoundingClientRect().height) }))`)
    .catch(() => []);
  const fs = await import('node:fs');
  const out = opts.out ? String(opts.out) : `${artifactsDir('wechat')}/inspect-${stamp()}.json`;
  const { redact } = await import('./lib/util.mjs');
  fs.writeFileSync(out, JSON.stringify(redact(data), null, 2), 'utf8');
  jsonOut({ ok: true, platform: 'wechat', loggedIn: data.loggedIn, out, url: data.url, frames: data.frames.length });
  await page.dispose({closeOwned:true});
}

async function cmdCheck(opts) {
  if (Object.hasOwn(opts, 'submit')) throw new SkillError('USAGE', '--submit 已禁用：只保存草稿');
  if (!opts.job) throw new SkillError('USAGE', '缺少 --job 参数');
  const job = readJob(String(opts.job), {linkPolicy:opts['link-policy']});
  if (job.submit) throw new SkillError('USAGE', 'job.submit 已禁用：只保存草稿');
  const pre = preflight('wechat', job);
  if (pre.errors.length) throw new SkillError('USAGE', pre.errors.join('；'));
  const cover = job.coverFromBody ? coverPlan(job) : null;
  jsonOut({ok:true, platform:'wechat', command:'check', offline:true, htmlFile:job.htmlFile || null,
    inlineImageIds:job.inlineImages.map(im=>im.id), bodyImageCount:job.images.length + job.inlineImages.length,
    cover: cover ? {mode:'body', file:cover.file || null, ratio:cover.ratio ?? null, warning:cover.warning || null} : {mode:'ai'},
    warnings:pre.warnings, note:'仅本地校验；未生成图片、未运行浏览器、未保存草稿'});
}

async function cmdPost(opts) {
  if (Object.hasOwn(opts, 'submit')) throw new SkillError('USAGE', '--submit 已禁用：只保存草稿，绝不会发表');
  if (!opts.job) throw new SkillError('USAGE', '缺少 --job 参数');
  const job = readJob(String(opts.job), { linkPolicy: opts['link-policy'] });
  if (job.submit) throw new SkillError('USAGE', 'job.submit 已禁用：请删除该字段或设为 false；只保存草稿，绝不会发表');
  await prepareGithubIntro(job);
  const pre = preflight('wechat', job);
  for (const w of pre.warnings) log(`⚠ ${w}`);
  if (pre.errors.length) throw new SkillError('USAGE', '内容不符合规范:\n  ' + pre.errors.join('\n  '));
  const port = Number(opts.port || 9335);
  const result = await publish(job, { port });
  jsonOut(result);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0] || 'help';
  let exitCode = 0;
  keepBrowser(opts['keep-browser'] === true);
  try {
    if (Object.hasOwn(opts, 'keep-browser') && opts['keep-browser'] !== true) throw new SkillError('USAGE', '--keep-browser 不接受参数值');
    if (cmd === 'help' || opts.help) {
      process.stdout.write(HELP + '\n');
      return;
    }
    if (cmd === 'check') await cmdCheck(opts);
    else if (cmd === 'doctor') await cmdDoctor(opts);
    else if (cmd === 'status') await cmdStatus(opts);
    else if (cmd === 'login') await cmdLogin(opts);
    else if (cmd === 'inspect') await cmdInspect(opts);
    else if (cmd === 'post') await cmdPost(opts);
    else throw new SkillError('USAGE', `未知命令: ${cmd}`);

  } catch (e) {
    const code = e instanceof SkillError ? e.code : 'USAGE';
    jsonOut({ ok: false, platform: 'wechat', command: cmd, ...(cmd === 'post' ? { savedAsDraft: false } : {}), code, message: e.message, hint: e.hint || '', screenshot: e.shot || null, ...(e.diagnostic ? {diagnostic:e.diagnostic} : {}), ...(e.diagnosticCaptureFailed ? {diagnosticCaptureFailed:true} : {}), ...(e.coverVisualVerification ? {coverVisualVerification:e.coverVisualVerification} : {}) });
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
