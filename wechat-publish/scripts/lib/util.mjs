// 共享工具：日志、错误、文件、参数解析。零依赖。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 结构化错误：带 code，CLI 用它决定退出码 */
export class SkillError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'SkillError';
    this.code = code;
    this.hint = hint;
  }
}

export const EXIT = {
  OK: 0,
  USAGE: 1,
  LOGIN_REQUIRED: 2,
  PAGE_CHANGED: 3,
  UPLOAD_FAILED: 4,
  PUBLISH_FAILED: 5,
  BROWSER_FAILED: 6,
  RENDER_FAILED: 8,
};

export function codeToExit(code) {
  return EXIT[code] ?? EXIT.USAGE;
}

/** 日志走 stderr，stdout 只留 JSON，方便 Agent 解析 */
export function log(msg) {
  process.stderr.write(`[wechat] ${redact(String(msg))}\n`);
}

export function redact(value) {
  if (typeof value === 'string') return value.replace(/([?&](?:token|key|tempkey|ticket|auth|access_token)=)[^&#\s"<>]+/gi, '$1REDACTED');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v)]));
  return value;
}

export function jsonOut(obj) {
  process.stdout.write(JSON.stringify(redact(obj), null, 2) + '\n');
}

/** 数据根：浏览器 profile、截图、日志都放这里，不污染 Skill 目录 */
export function dataRoot() {
  const base =
    process.env.PUBLISH_SKILL_DATA ||
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'agent-publish');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function profileDir(platform = 'xhs') {
  const dir = path.join(dataRoot(), platform, 'chrome-profile');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function artifactsDir(platform = 'xhs') {
  const dir = path.join(dataRoot(), platform, 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function readJob(file, { linkPolicy: policyOverride } = {}) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new SkillError('USAGE', `任务文件不存在: ${abs}`);
  let job;
  try {
    job = JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new SkillError('USAGE', `任务文件不是合法 JSON: ${abs} — ${e.message}`);
  }
  const base = path.dirname(abs);
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw new SkillError('USAGE', '任务必须是 JSON 对象');
  if (job.images != null && !Array.isArray(job.images)) throw new SkillError('USAGE', 'images 必须是本地图片路径数组');
  const images = (job.images || []).map((p) => localFile(p, base, /\.(png|jpe?g|webp|gif|bmp)$/i, '图片'));
  const rich = readWechatHtml(job, base);

  // 小红书不允许直接放外链：默认把 URL 转述成「github，仓库是 owner/repo」这种形式
  const linkPolicy = String(policyOverride || job.linkPolicy || job.link_policy || 'keep');
  const changes = [];
  const clean = (s) => {
    const r = sanitizeLinks(s, { policy: linkPolicy });
    changes.push(...r.changes);
    return r.text;
  };

  const title = String(job.title ?? '').trim();
  const allTopics = Array.isArray(job.topics) ? job.topics.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean) : [];
  const removedTopics = allTopics.filter((t) => t !== 'AI');
  if (removedTopics.length) log(`公众号只保留 #AI，已去掉话题: ${removedTopics.join('、')}`);
  if (job.coverImage != null && typeof job.coverImage !== 'string') throw new SkillError('USAGE', 'coverImage 必须是本地图片路径字符串');
  return {
    title,
    coverImage: job.coverImage,
    content: String(job.content ?? '') || (rich.html ? htmlText(rich.html) : ''),
    caption: String(job.caption ?? '').trim(),
    images,
    ...rich,
    jobFile: abs,
    type: job.type, projects: job.projects, githubIntro: job.githubIntro,
    introTitle: job.introTitle, date: job.date,
    topics: ['AI'],
    removedTopics,
    submit: Boolean(job.submit),
    linkPolicy,
    linkChanges: changes,
  };
}

// Local rich-HTML inputs never resolve URLs or inspect browser/profile data.
export function localFile(file, base, extension, label) {
  if (typeof file !== 'string' || !file.trim() || /^(?:[a-z][a-z\d+.-]*:\/\/|data:|file:|\\\\|\/\/)/i.test(file)) {
    throw new SkillError('USAGE', `${label}必须是本地文件路径`);
  }
  const abs = path.resolve(base, file);
  if (!extension.test(abs)) throw new SkillError('USAGE', `${label}文件扩展名不支持: ${abs}`);
  try { if (!fs.statSync(abs).isFile()) throw new Error('not a regular file'); }
  catch { throw new SkillError('USAGE', `${label}不存在或不是普通文件: ${abs}`); }
  return abs;
}

/** Header-only dimensions for local images. No decoding, no pixel buffers, no new dependencies. */
export function imageDimensions(file) {
  let b;
  try { b = fs.readFileSync(file); } catch { return null; }
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), format: 'png' };
  }
  if (b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), format: 'gif' };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let p = 2; p + 9 < b.length;) {
      if (b[p] !== 0xff) { p++; continue; }
      const marker = b[p + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
      if (marker === 0xda) break;
      const length = b.readUInt16BE(p + 2);
      if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: b.readUInt16BE(p + 5), width: b.readUInt16BE(p + 7), format: 'jpeg' };
      }
      p += 2 + length;
    }
    return null;
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const type = b.toString('ascii', 12, 16);
    if (type === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), format: 'webp' };
    if (type === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, format: 'webp' };
    if (type === 'VP8L') { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' }; }
  }
  if (b.length > 26 && b.toString('ascii', 0, 2) === 'BM') {
    return { width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)), format: 'bmp' };
  }
  return null;
}

/** 公众号封面实际按 2.35:1 裁切。 */
export const COVER_RATIO = 2.35;

/** Images in the order they appear in the final article body. */
export function bodyImageOrder(job) {
  const out = [];
  const html = job.html || '';
  for (const m of html.matchAll(/<!--WECHAT_INLINE_IMAGE:([a-zA-Z0-9_-]+)-->/g)) {
    const item = (job.inlineImages || []).find((im) => im.id === m[1]);
    if (item) out.push({ pos: m.index, file: item.file, id: item.id, kind: 'inline' });
  }
  if (job.images?.length) {
    const marker = html.indexOf('<!--WECHAT_BODY_IMAGE-->');
    out.push({ pos: marker < 0 ? Number.MAX_SAFE_INTEGER : marker, file: job.images[0], id: null, kind: 'legacy' });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

/**
 * 自动挑选封面候选：显式 coverImage 优先，否则取最接近 21:9 的正文图。
 * 返回 error 时必须在打开浏览器前停止，不能保存一张裁歪的封面。
 */
export function coverPlan(job) {
  const items = bodyImageOrder(job);
  if (!items.length) return { error: 'coverFromBody 需要至少一张实际正文配图' };
  const sized = items
    .map((it) => ({ ...it, size: imageDimensions(path.resolve(it.file)) }))
    .filter((it) => it.size && it.size.width > 0 && it.size.height > 0)
    .map((it) => ({ ...it, ratio: it.size.width / it.size.height }));
  if (!sized.length) return { warning: '读不到正文图尺寸；封面裁切只能在保存前人工核对' };
  const detail = sized.map((it) => `${path.basename(it.file)} ${it.size.width}×${it.size.height}（${it.ratio.toFixed(2)}:1）`).join('、');
  let pick;
  if (job.coverImage) {
    const base = job.jobFile ? path.dirname(job.jobFile) : process.cwd();
    const abs = localFile(job.coverImage, base, /\.(png|jpe?g|webp|gif|bmp)$/i, 'coverImage');
    pick = sized.find((it) => it.file === abs);
    if (!pick) return { error: `coverImage 必须是正文中已上传的图片之一：${abs}` };
  } else {
    pick = [...sized].sort((a, b) => Math.abs(a.ratio - COVER_RATIO) - Math.abs(b.ratio - COVER_RATIO) || a.pos - b.pos)[0];
  }
  if (pick.ratio < 1.6 || pick.ratio > 3.4) {
    return {
      error: `正文图都不接近 21:9（${detail}）；微信会把封面裁成很窄的一条，无法确认封面来源。请把 2100×900 左右的封面图放进正文图片清单（推荐第一张），或去掉 coverFromBody 改用自动封面`,
    };
  }
  const drift = Math.abs(pick.ratio - COVER_RATIO);
  return {
    file: pick.file,
    ratio: pick.ratio,
    warning: drift > 0.45 ? `封面候选 ${path.basename(pick.file)} 不是标准 21:9（${detail}），微信裁切可能切掉主体` : null,
  };
}

export const inlineImageMarker = (id) => `<!--WECHAT_INLINE_IMAGE:${id}-->`;
const BODY_IMAGE_MARKER = '<!--WECHAT_BODY_IMAGE-->';
const occurrences = (text, needle) => text.split(needle).length - 1;

export function htmlText(html) {
  return String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[\da-f]+|\d+);/gi, (m, n) => { const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return cp <= 0x10ffff ? String.fromCodePoint(cp) : m; })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n]).replace(/\s+/g, ' ').trim();
}

/** Preserve authored HTML exactly; comments are stable image slots, not remote image URLs. */
export function readWechatHtml(job, base = job.jobFile ? path.dirname(job.jobFile) : process.cwd()) {
  if (job.coverFromBody != null && typeof job.coverFromBody !== 'boolean') throw new SkillError('USAGE', 'coverFromBody 必须是布尔值');
  const coverFromBody = job.coverFromBody === true;
  const requireInlineImages = job.requireInlineImages === true || job.type === 'ai-update';
  if (job.requireInlineImages != null && typeof job.requireInlineImages !== 'boolean') throw new SkillError('USAGE', 'requireInlineImages 必须是布尔值');
  if (job.inlineImages != null && !Array.isArray(job.inlineImages)) throw new SkillError('USAGE', 'inlineImages 必须是 {id,file} 数组');
  if (job.htmlFile == null) {
    if (job.inlineImages?.length || requireInlineImages) throw new SkillError('USAGE', '章节配图需要 htmlFile 和非空 inlineImages；不能退回纯文字');
    return { inlineImages: [], requireInlineImages, coverFromBody };
  }
  const htmlFile = localFile(job.htmlFile, base, /\.html?$/i, 'htmlFile');
  let html;
  try { html = new TextDecoder('utf-8', {fatal:true}).decode(fs.readFileSync(htmlFile)); }
  catch { throw new SkillError('USAGE', `htmlFile 必须是 UTF-8: ${htmlFile}`); }
  if (!/^\s*<section\b[\s\S]*<\/section>\s*$/i.test(html) || /<\s*(?:!doctype|html|head|body|script|style|div|iframe|object|embed|link|meta|input|button|form)\b/i.test(html) || /\s(?:class|id|on[a-z]+)\s*=/i.test(html) || /(?:javascript\s*:|url\s*\(|@import)/i.test(html)) {
    throw new SkillError('USAGE', 'htmlFile 必须是无脚本、无文档外壳、内联样式的安全 section 正文；先运行 gzh-design 校验');
  }
  if (/<\s*img\b/i.test(html)) throw new SkillError('USAGE', 'htmlFile 图片必须改为 WECHAT_INLINE_IMAGE 注释并绑定本地文件；不接受远程/本地伪图片 URL');
  const ids = new Set();
  const inlineImages = (job.inlineImages || []).map((item) => {
    if (!item || typeof item !== 'object' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item.id || '') || ids.has(item.id)) throw new SkillError('USAGE', 'inlineImages.id 必须唯一，且为 1–64 位英文/数字/下划线/连字符');
    ids.add(item.id);
    if (occurrences(html, inlineImageMarker(item.id)) !== 1) throw new SkillError('USAGE', `章节图片 ${item.id} 必须且只能有一个精确占位注释`);
    return {id:item.id, file:localFile(item.file, base, /\.(png|jpe?g|webp|gif|bmp)$/i, `章节图片 ${item.id}`)};
  });
  const withoutSlots = inlineImages.reduce((s, item) => s.replace(inlineImageMarker(item.id), ''), html);
  if (/WECHAT_INLINE_IMAGE/i.test(withoutSlots)) throw new SkillError('USAGE', 'htmlFile 有未绑定、拼写错误或重复的章节图片占位');
  if (requireInlineImages && !inlineImages.length) throw new SkillError('USAGE', 'AI 更新文章必须提供章节内配图；不能保存纯文字草稿');
  if ((job.images?.length || (job.githubIntro?.enabled !== false && (job.githubIntro != null || job.type === 'github-ranking'))) && occurrences(html, BODY_IMAGE_MARKER) !== 1) throw new SkillError('USAGE', 'htmlFile 同时使用 images/GitHub简介图时必须包含一个 <!--WECHAT_BODY_IMAGE-->');
  return {htmlFile, html, inlineImages, requireInlineImages, coverFromBody};
}

/** Map only image DOM obtained from the uploader; never manufacture image sources. */
export function assembleWechatHtml(html, inlineImages, uploaded, legacyHtml = '') {
  let out = html;
  for (const item of inlineImages) {
    const image = uploaded.get(item.id);
    if (typeof image !== 'string' || !/<img\b/i.test(image) || occurrences(out, inlineImageMarker(item.id)) !== 1) throw new SkillError('UPLOAD_FAILED', `章节图片 ${item.id} 上传结果缺失或占位不唯一，停止保存`);
    out = out.replace(inlineImageMarker(item.id), () => image);
  }
  if (legacyHtml && occurrences(out, BODY_IMAGE_MARKER) !== 1) throw new SkillError('UPLOAD_FAILED', '普通配图插入位置缺失，停止保存');
  out = out.replace(BODY_IMAGE_MARKER, () => legacyHtml);
  if (/WECHAT_INLINE_IMAGE/i.test(out)) throw new SkillError('UPLOAD_FAILED', '正文仍有未填章节图片，停止保存');
  return out;
}

/**
 * 外链转述。小红书规则：正文/评论不允许出现可点击链接，写了也容易被限流。
 * policy:
 *   describe（默认）https://github.com/otetcham/Dsh-bot → github，仓库是 otetcham/Dsh-bot
 *   strip          直接删掉链接
 *   keep           原样保留（用户明确要自己担风险时用）
 */
export function sanitizeLinks(text, { policy = 'describe' } = {}) {
  const changes = [];
  if (!text || policy === 'keep') return { text: text || '', changes };

  const describe = (raw) => {
    if (policy === 'strip') return '';
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let u;
    try {
      u = new URL(withScheme);
    } catch {
      return raw.replace(/^https?:\/\//i, '');
    }
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const seg = u.pathname.split('/').filter(Boolean);
    const codeHost = /^(github|gitee|gitlab|bitbucket)\.(com|org|io)$/.exec(host);
    if (codeHost) {
      const name = codeHost[1];
      const repo = seg.slice(0, 2).join('/');
      const rest = seg.slice(2).join('/');
      if (!repo) return name;
      return rest ? `${name}，仓库是 ${repo}（路径 ${rest}）` : `${name}，仓库是 ${repo}`;
    }
    // 其它域名：去掉协议和 www，只留 host/path 纯文本
    const tail = seg.join('/');
    return tail ? `${host}/${tail}` : host;
  };

  const PATTERNS = [
    /\bhttps?:\/\/[^\s，。、；：""''（）()【】<>|！？]+/gi,
    /\bwww\.[^\s，。、；：""''（）()【】<>|！？]+/gi,
    /\b(?:github|gitee|gitlab)\.(?:com|org|io)\/[\w.-]+\/[\w.-]+[^\s，。、；：""''（）()【】<>|！？]*/gi,
  ];

  let out = String(text);
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => {
      const t = describe(m.replace(/[.,;:!?）)]+$/, ''));
      changes.push({ from: m, to: t });
      return t;
    });
  }
  return { text: out, changes };
}

export function describeLink(url) {
  return sanitizeLinks(url, { policy: 'describe' }).text;
}

/** 小红书/公众号的硬限制 */
export const LIMITS = {
  // 小红书支持纯文字（images 可为空），走「写长文」入口
  xhs: { images: [0, 18], title: 20, content: 1000 },
  wechat: { images: [0, 20], title: 64, content: 20000 },
};

export function charLen(s) {
  // 中文按 1 个字符算（小红书标题 20 字是字符数，不是字节）
  return [...String(s)].length;
}

export function preflight(platform, job) {
  const lim = LIMITS[platform];
  // 纯文字走「写长文」，正文上限宽松得多
  const contentLimit = platform === 'xhs' && job.images.length === 0 ? 10000 : lim.content;
  const warnings = [];
  const errors = [];
  const imageCount = job.images.length + (job.inlineImages?.length || 0);
  if (!imageCount && lim.images[0] > 0) errors.push('至少需要 1 张图片');
  if (job.coverFromBody && !imageCount) errors.push('coverFromBody 需要至少一张实际正文配图');
  if (platform === 'wechat' && job.coverFromBody && imageCount) {
    try {
      const plan = coverPlan(job);
      if (plan.error) errors.push(plan.error);
      if (plan.warning) warnings.push(plan.warning);
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (imageCount > lim.images[1]) errors.push(`图片最多 ${lim.images[1]} 张，当前 ${imageCount} 张`);
  if ((job.requireInlineImages || job.type === 'ai-update') && !job.inlineImages?.length) errors.push('AI 更新文章缺少章节内配图');
  if (!job.title) errors.push('标题不能为空');
  const tl = charLen(job.title);
  if (tl > lim.title) errors.push(`标题 ${tl} 字，超过平台上限 ${lim.title} 字`);
  else if (tl > lim.title - 2) warnings.push(`标题 ${tl} 字，接近上限 ${lim.title} 字`);
  const cl = charLen(job.html != null ? htmlText(job.html) : job.content);
  if (!cl) errors.push('正文不能为空');
  if (cl > contentLimit) errors.push(`正文 ${cl} 字，超过平台上限 ${contentLimit} 字`);
  else if (cl > contentLimit - 50) warnings.push(`正文 ${cl} 字，接近上限 ${contentLimit} 字`);

  // 纯文字模式：没给 caption 时会把 content 全文塞进发布页正文框（上限 1000 字）
  if (platform === 'xhs' && job.images.length === 0) {
    const effective = job.caption && job.caption.trim() ? job.caption.trim() : job.content.trim();
    const capLen = charLen(effective);
    if (capLen > 1000) warnings.push(`发布页正文 ${capLen} 字 > 1000，会被截断（图片卡片里仍是全文）`);
  }
  return { warnings, errors };
}

/** 简易参数解析：--key value / --flag */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}


export function stripRepeatedTitle(content, title) {
  const lines = String(content ?? '').split(/\n/);
  if (!lines.length) return String(content ?? '');
  const norm = (s) => String(s || '').trim().replace(/[｜|]/g, '｜').replace(/\s+/g, '').replace(/[（(]11\.10[）)]$/, '');
  const first = (lines[0] || '').trim();
  if (first && title && (norm(first) === norm(title) || norm(first).startsWith(norm(title)) || norm(title).startsWith(norm(first)))) {
    log(`正文首行与标题重复，已去掉：「${first}」`);
    return lines.slice(1).join('\n').replace(/^\n+/, '');
  }
  return String(content ?? '');
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sourceName(url) {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./i, '');
    const map = {
      'cnbc.com': 'CNBC',
      'anthropic.com': 'Anthropic 官方',
      'techcrunch.com': 'TechCrunch',
      'blog.google': 'Google 官方',
      'theverge.com': 'The Verge',
      'openai.com': 'OpenAI 官方',
      'irishtimes.com': 'The Irish Times',
      'ernie.baidu.com': '百度文心 官方',
      'guancha.cn': '观察者网',
      'nvidianews.nvidia.com': 'NVIDIA 官方',
      'github.com': 'GitHub',
    };
    if (map[host]) return map[host];
    const parts = host.split('.');
    const core = parts.length > 2 ? parts[parts.length - 2] : parts[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return '来源';
  }
}

const P = 'margin:0 0 14px 0;font-size:15px;line-height:1.75;';
const H = 'margin:18px 0 8px 0;font-size:16px;font-weight:bold;line-height:1.6;';
const Q = 'margin:0 0 16px 0;padding:12px 16px;border-left:3px solid #07C160;background:#f7f7f7;';

/** 把原稿排成公众号可用的 HTML：不去重复标题、导语引用加粗、正常段距、来源做成可点名称、文末只留 #AI */
export function formatWechatHtml(job) {
  if (job.htmlFile) return readWechatHtml(job).html;
  let raw = stripRepeatedTitle(String(job.content ?? ''), job.title);
  const sources = [];
  raw = raw.replace(/^[ \t]*链接[：:]\s*(https?:\/\/\S+)\s*$/gm, (_, url) => {
    sources.push({ url, name: sourceName(url) });
    return '';
  });
  raw = raw.replace(/^[ \t]*(\d{1,2})[.、.\s]+(?:([^\n]*?)\s+)?(https?:\/\/\S+)\s*$/gm, (m, n, name, url) => {
    sources.push({ n, url, name: String(name || '').trim() || sourceName(url) });
    return '';
  });
  raw = raw.replace(/^[ \t]*(\d{1,2})\s+(https?:\/\/\S+)\s*$/gm, (m, n, url) => {
    sources.push({ n, url, name: sourceName(url) });
    return '';
  });
  raw = raw.replace(/^[ \t]*图中\d+条新闻来源[：:]?\s*$/gm, '');
  raw = raw.replace(/^[ \t]*(#[^\s#]+[ \t]*)+$/gm, '');
  raw = raw.replace(/#[^\s#]*蓝\s*V[^\s#]*/gi, '');
  raw = raw.replace(/\n{3,}/g, '\n\n').trim();

  const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const html = [];
  let introDone = false;
  for (const block of blocks) {
    const repoHead = block.match(/^(\d+)[.、.]?\s+([\w.-]+\/[\w.-]+)(?:（[^）]*）)?[：:]?[\s\S]*$/);
    if (repoHead) {
      const n = repoHead[1];
      const repo = repoHead[2];
      const rest = block.replace(/^\d+[.、.]?\s+[\w.-]+\/[\w.-]+(?:（[^）]*）)?[：:]?\s*/, '');
      const metadata = (block.split("\n")[0].match(/（[^）]*）/) || [""])[0];
      html.push(`<h3 style="${H}">${n}. ${esc(repo)}${esc(metadata)}</h3>`);
      const parts = rest.split(/(?=是什么：|适合谁：|我的看法：)/);
      for (const part of parts) {
        if (part.trim()) html.push(`<p style="${P}">${esc(part.trim()).replace(/\n/g, '<br>')}</p>`);
      }
      continue;
    }
    if (!introDone) {
      html.push(`<blockquote style="${Q}"><p style="margin:0;font-weight:bold;font-size:15px;line-height:1.75;">${esc(block).replace(/\n/g, '<br>')}</p></blockquote>`);
      html.push('<!--WECHAT_BODY_IMAGE-->');
      introDone = true;
      continue;
    }
    for (const para of block.split(/\n+/)) {
      if (para.trim()) html.push(`<p style="${P}">${esc(para.trim())}</p>`);
    }
  }
  // A project-only article still needs a place for its generated first image.
  if (!html.includes('<!--WECHAT_BODY_IMAGE-->')) html.unshift('<!--WECHAT_BODY_IMAGE-->');
  if (sources.length) {
    html.push(`<h3 style="${H}">参考来源</h3>`);
    sources.forEach((s, i) => {
      const n = s.n || i + 1;
      const href = /^https?:\/\//i.test(s.url) ? s.url : `https://${s.url}`;
      html.push(`<p style="margin:0 0 8px 0;font-size:15px;line-height:1.75;">${n}. <a href="${esc(href)}">${esc(s.name)}</a></p>`);
    });
  }
  html.push('<p style="margin:16px 0 0 0;color:#576B95;">#AI</p>');
  return html.join('\n');
}
