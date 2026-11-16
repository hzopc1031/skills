// Generate locally before connecting to any publishing browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SkillError } from './util.mjs';
const run = promisify(execFile);

export async function prepareGithubIntro(job) {
  if (job.githubIntro?.enabled === false || job.githubIntroResult) return job;
  if (job.githubIntro === undefined && job.type !== 'github-ranking') return job;
  const cfg = job.githubIntro ?? {};
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new SkillError('RENDER_FAILED', 'githubIntro 必须是对象');
  const projects = cfg.projects ?? job.projects;
  if (!Array.isArray(projects) || !projects.length) throw new SkillError('RENDER_FAILED', 'GitHub 简介图缺少 projects');
  const base = job.jobFile ? path.dirname(job.jobFile) : process.cwd();
  const d = new Date();
  const today = [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  const date = String(cfg.date ?? job.date ?? today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new SkillError('RENDER_FAILED', '简介图日期须为 YYYY-MM-DD');
  const out = path.resolve(base, cfg.out ?? ('gh-intro-' + date + '.png'));
  if (!/\.png$/i.test(out) || out === job.jobFile) throw new SkillError('RENDER_FAILED', '简介图输出须为独立 PNG 文件');
  fs.mkdirSync(path.dirname(out), {recursive:true});
  const input = path.join(base, '.gh-intro-' + process.pid + '-' + Date.now() + '.json');
  let result;
  try {
    fs.writeFileSync(input, JSON.stringify({...cfg, title:cfg.title ?? job.introTitle ?? 'GitHub热榜｜今日' + projects.length + '个项目', projects, height:cfg.height??1660}), {encoding:'utf8', flag:'wx'});
    const renderer = fileURLToPath(new URL('../render-github-intro.mjs', import.meta.url));
    const {stdout} = await run(process.execPath, [renderer, '--data', input, '--out', out], {windowsHide:true, timeout:90000, maxBuffer:1024*1024});
    result = JSON.parse(stdout.trim());
    if (!result.ok || result.overflow !== false) throw new Error('生成失败或内容溢出：' + JSON.stringify(result));
    const png = fs.readFileSync(out);
    if (!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.length < 24 || png.readUInt32BE(16) !== result.width || png.readUInt32BE(20) !== result.height) throw new Error('生成的 PNG 无效');
  } catch (e) {
    let detail = e.message;
    try { const r = JSON.parse(e.stdout); detail = r.message || JSON.stringify(r); } catch {}
    throw new SkillError('RENDER_FAILED', 'GitHub 简介图生成停止：' + detail);
  } finally { if (fs.existsSync(input)) fs.unlinkSync(input); }
  job.images = [out, ...(job.images || []).filter(p => path.resolve(p) !== out)];
  job.githubIntroResult = result;
  if(job.images.length>18) throw new SkillError('USAGE',`图片共 ${job.images.length} 张，超过18张上限`);
  return job;
}
