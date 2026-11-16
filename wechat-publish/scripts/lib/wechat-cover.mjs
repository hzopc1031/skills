// 公众号内容一律要有封面：没有现成 21:9 首图时，本地先出一张，再走「从正文选择」。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SkillError } from './util.mjs';
import { trackBrowser } from './browser-lifecycle.mjs';
const run = promisify(execFile);

export async function prepareWechatCover(job) {
  // 已有明确封面来源：显式指定图、正文首图、或富文本 hero 首图，都不再另出。
  if (job.coverFromBody === true || job.coverImage || job.htmlFile || job.wechatCoverResult) return job;
  const base = job.jobFile ? path.dirname(job.jobFile) : process.cwd();
  const d = new Date();
  const today = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  const date = String(job.date || today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new SkillError('RENDER_FAILED', '封面日期须为 YYYY-MM-DD');
  const out = path.resolve(base, job.coverOut ? String(job.coverOut) : 'wechat-cover-' + date + '.png');
  if (!/\.png$/i.test(out) || out === job.jobFile) throw new SkillError('RENDER_FAILED', '封面输出须为独立 PNG 文件');
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const input = path.join(base, '.wx-cover-' + process.pid + '-' + Date.now() + '.json');
  const renderProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-render-profile-'));
  trackBrowser(0, renderProfile, { temporary: true });
  let result;
  try {
    const title = String(job.coverTitle || job.title || '').trim();
    if (!title) throw new Error('缺少标题');
    fs.writeFileSync(input, JSON.stringify({
      title,
      subtitle: job.coverSubtitle ?? job.caption ?? '',
      date,
      brand: job.author || 'TwoPeanuts',
      kicker: job.coverKicker || 'AI BRIEF',
      items: job.coverItems,
    }), { encoding: 'utf8', flag: 'wx' });
    const renderer = fileURLToPath(new URL('../render-wechat-cover.mjs', import.meta.url));
    const { stdout } = await run(process.execPath, [renderer, '--data', input, '--out', out, '--browser-profile', renderProfile], { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
    result = JSON.parse(stdout.trim());
    if (!result.ok) throw new Error(result.message || '生成失败');
    const png = fs.readFileSync(out);
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.length < 24 || png.readUInt32BE(16) !== 2100 || png.readUInt32BE(20) !== 900) throw new Error('生成的封面 PNG 无效');
  } catch (e) {
    let detail = e.message;
    try { const r = JSON.parse(e.stdout); detail = r.message || JSON.stringify(r); } catch {}
    throw new SkillError('RENDER_FAILED', '公众号封面生成停止：' + detail);
  } finally { if (fs.existsSync(input)) fs.unlinkSync(input); }

  // 封面放正文第一张，coverFromBody 自动打开；没有封面就不继续保存。
  job.images = [out, ...(job.images || []).filter((p) => path.resolve(p) !== out)];
  job.coverFromBody = true;
  job.wechatCoverResult = result;
  return job;
}
