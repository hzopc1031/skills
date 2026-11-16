// 共享工具：日志、错误、文件、参数解析。零依赖。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { rememberPromotionInput } from './promotion-context.mjs';

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
  ACCOUNT_MISMATCH: 7,
  CONTENT_REVIEW_REQUIRED: 9,
};

export function codeToExit(code) {
  return EXIT[code] ?? EXIT.USAGE;
}

/** 日志走 stderr，stdout 只留 JSON，方便 Agent 解析 */
export function log(msg) {
  process.stderr.write(`[xhs] ${msg}\n`);
}

export function jsonOut(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

/** 数据根：浏览器 profile、截图、日志都放这里，不污染 Skill 目录 */
export function dataRoot() {
  const base =
    process.env.PUBLISH_SKILL_DATA ||
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'agent-publish');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function profileDir(account) {
  return path.join(dataRoot(), account.dataDir, 'chrome-profile');
}

export function artifactsDir(account) {
  const dir = path.join(dataRoot(), account.dataDir, 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 配置只包含账户路由和公开身份，不保存登录凭据。 */
export function readAccounts(file = fileURLToPath(new URL('../../accounts.json', import.meta.url))) {
  if (typeof file !== 'string' || !file.trim()) throw new SkillError('USAGE', '--accounts-file 必须指定路径');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new SkillError('USAGE', `账户配置读取失败: ${e.message}`);
  }
  if (!config || !config.accounts || typeof config.accounts !== 'object' || Array.isArray(config.accounts)) {
    throw new SkillError('USAGE', 'accounts.json 必须包含 accounts 对象');
  }
  const ports = new Set();
  const dirs = new Set();
  for (const [alias, a] of Object.entries(config.accounts)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(alias) || !a || typeof a !== 'object' || Array.isArray(a) ||
        typeof a.label !== 'string' || !a.label.trim() ||
        typeof a.dataDir !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(a.dataDir) ||
        !Number.isInteger(a.port) || a.port < 1024 || a.port > 65535 ||
        !(a.expectedNickname == null || typeof a.expectedNickname === 'string') ||
        !(a.expectedRedId == null || typeof a.expectedRedId === 'string') ||
        !(a.proxy == null || a.proxy === 'direct' || a.proxy === 'system')) {
      throw new SkillError('USAGE', `账户配置无效: ${alias}（检查 label/dataDir/port/expectedNickname/expectedRedId）`);
    }
    const dir = a.dataDir.toLowerCase();
    const fixed = { ai: { port:9333, dataDir:'xhs' }, house:{ port:9334, dataDir:'xhs-house' } }[alias];
    if (fixed && (a.port !== fixed.port || dir !== fixed.dataDir)) throw new SkillError('USAGE', `账户 ${alias} 路由错误：必须为 ${fixed.port} + ${fixed.dataDir}/chrome-profile；拒绝连接浏览器`);
    if (ports.has(a.port) || dirs.has(dir)) throw new SkillError('USAGE', `账户端口或 dataDir 重复: ${alias}`);
    ports.add(a.port);
    dirs.add(dir);
  }
  if (config.default != null && !Object.hasOwn(config.accounts, config.default)) {
    throw new SkillError('USAGE', `默认账户不存在: ${config.default}`);
  }
  return config;
}

export function resolveAccount(config, cliAccount, jobAccount, { post = false } = {}) {
  const available = `可用账户: ${Object.keys(config.accounts).join(', ') || '无'}`;
  for (const value of [cliAccount, jobAccount]) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
      throw new SkillError('USAGE', `account 必须是非空别名；${available}`);
    }
  }
  if (cliAccount !== undefined && jobAccount !== undefined && cliAccount !== jobAccount) {
    throw new SkillError('USAGE', `--account (${cliAccount}) 与 job.account (${jobAccount}) 不一致；${available}`);
  }
  const alias = cliAccount ?? jobAccount ?? (post ? null : config.default);
  if (!alias) throw new SkillError('USAGE', `缺少账户：请指定 --account${post ? ' 或 job.account（post 不使用 default）' : ' 或配置 default'}；${available}`);
  if (!Object.hasOwn(config.accounts, alias)) throw new SkillError('USAGE', `未知账户: ${alias}；${available}`);
  return { ...config.accounts[alias], alias };
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
  const images = (job.images || []).map((p) => (path.isAbsolute(p) ? p : path.resolve(base, p)));
  const missing = images.filter((p) => !fs.existsSync(p));
  if (missing.length) throw new SkillError('USAGE', `图片不存在:\n  ${missing.join('\n  ')}`);
  const bad = images.filter((p) => !/\.(png|jpe?g|webp|gif|bmp)$/i.test(p));
  if (bad.length) throw new SkillError('USAGE', `不是图片文件:\n  ${bad.join('\n  ')}`);

  // 小红书默认强制去掉 URL 和域名路径，不能只剥 https 留下 cnbc.com/...
  const linkPolicy = String(policyOverride || job.linkPolicy || job.link_policy || 'strip');
  const changes = [];
  const removedLanV = [];
  const clean = (s) => {
    const r = sanitizeLinks(s, { policy: linkPolicy });
    changes.push(...r.changes);
    const tag = stripLanVTags(r.text);
    removedLanV.push(...tag.removed);
    return collapseLinkShells(stripHashtagLines(tag.text));
  };

  const titleOriginal = clean(String(job.title ?? '').trim());
  const titleInfo = compressTitle(titleOriginal, job.xhsTitle === undefined ? undefined : clean(job.xhsTitle), job.date);
  const title = titleInfo.titleFinal;
  const bodyLimit = Number(job.bodyLimit ?? job.limits?.body ?? LIMITS.xhs.content);
  if (!Number.isInteger(bodyLimit) || bodyLimit < 1 || bodyLimit > LIMITS.xhs.content) throw new SkillError('USAGE', 'bodyLimit 必须为 1..1000 的整数');
  if (job.appendix !== undefined && typeof job.appendix !== 'string' && (!Array.isArray(job.appendix) || job.appendix.some(s => typeof s !== 'string'))) throw new SkillError('USAGE', 'appendix 必须是字符串或字符串数组');
  const appendix = (Array.isArray(job.appendix) ? job.appendix : [job.appendix ?? '']).map(cleanImageText).filter(Boolean);
  const topicsInfo = filterTopics(job.topics);
  const inputContent = stripRepeatedTitle(clean(String(job.content ?? job.unifiedPost ?? '')), title, titleOriginal, String(job.title ?? ''));
  const github = job.type === 'github-ranking' || (job.githubIntro && job.githubIntro.enabled !== false);
  const body = github ? githubReadingBody(inputContent, appendix, job, {bodyLimit,topics:topicsInfo.topics}) : splitBody(inputContent, appendix, {bodyLimit, topics:topicsInfo.topics});
  const caption=github ? '' : clean(String(job.caption??''));
  if(charLen(caption)+body.topicReserve>bodyLimit) throw new SkillError('USAGE','caption 加正式话题超过 bodyLimit；请缩短caption或改用content自动转图，不截断');

  return rememberPromotionInput({
    account: job.account,
    promotionReview: job.promotionReview,
    title,
    ...titleInfo,
    titleOriginalLength: titleLen(titleOriginal),
    titleTruncated: false,
    ...body,
    bodyLimit,
    appendix,
    overflow: job.overflow,
    caption,
    images,
    jobFile: abs,
    type: job.type, projects: job.projects, githubIntro: job.githubIntro,
    introTitle: job.introTitle, date: job.date,
    topics: topicsInfo.topics, removedTopics: topicsInfo.removed,
    duplicateTitles: Array.isArray(job.duplicateTitles) ? job.duplicateTitles.map(String) : [],
    submit: Boolean(job.submit),
    submitDisabled: job.submit === false,
    linkPolicy,
    linkChanges: changes,
    removedLanV,
  }, job, 'post');
}

/** GitHub 默认短正文，完整总评迁入详情；不截断仓库、数字或原文观点。 */
export function githubReadingBody(original, appendix, job, {bodyLimit=1000,topics=[]}={}) {
  const projects=job.githubIntro?.projects??job.projects;
  if(!Array.isArray(projects)||!projects.length) throw new SkillError('USAGE','GitHub 阅读布局需要结构化 projects');
  const view=original.match(/我的看法[：:]([\s\S]*)$/)?.[1]?.replace(/每个项目的详细介绍见图[。！]?/g,'').trim();
  const lead=cleanImageText(job.githubLayout?.mainLine??view?.match(/^[^。！？]+[。！？]?/)?.[0]??'');
  if(!lead) throw new SkillError('USAGE','请提供 githubLayout.mainLine 或正文中的我的看法，不能编造主线');
  const top=projects.slice(0,3).map((p,i)=>{
    if(!p.repo||!p.today||!p.intro) throw new SkillError('USAGE','GitHub projects 缺少 repo/today/intro');
    return cleanImageText(`${p.rank??i+1} ${p.repo} · 今日${String(p.today).startsWith('+')?'':'+'}${p.today} · ${p.bodyIntro??p.intro}`);
  });
  const content=[lead,...top,`完整${projects.length}个项目见图`].join('\n\n');
  const topicReserve=topics.reduce((n,t)=>n+charLen(t)+4,0);
  if(charLen(content)+topicReserve>bodyLimit) throw new SkillError('USAGE','GitHub 短正文仍超限；请提供更短的 mainLine/bodyIntro，禁止截断');
  // 没有附录时，原正文也进入图，避免为了短正文丢失第4..10项。
  const details=appendix.length?[...appendix]:[original];
  if(appendix.length&&view) details.push('总评\n'+view);
  if(job.caption&&cleanImageText(job.caption)!==content) details.push('原caption\n'+cleanImageText(job.caption));
  return {content,contentOriginal:original,bodyCount:charLen(content),topicReserve,overflowText:details,bodyMovedToImages:true,githubLayoutApplied:true};
}

/** 发布页实测：ASCII 半字，其它 UTF-16 单元一字，总和向上取整。 */
export function titleLen(text) {
  return Math.ceil(String(text).split('').reduce((n,c) => n + (c.charCodeAt(0) <= 127 ? 0.5 : 1), 0));
}

export function compressTitle(original, override, date) {
  let title = String(override ?? original).trim();
  const rules = override !== undefined ? ['xhsTitle'] : [];
  if (!title) throw new SkillError('USAGE', '标题不能为空');
  if (override === undefined && titleLen(title) > LIMITS.xhs.title) {
    const found = title.match(/(?:\d{4}[-/.年])?(\d{1,2})[-/.月](\d{1,2})(?:日)?/);
    const shortDate = found ? `${found[1]}.${found[2]}` : (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? `${Number(date.slice(5,7))}.${Number(date.slice(8,10))}` : '');
    if (found) title = title.replace(found[0], shortDate);
    title = title.replace(/[（(]\s*(\d{1,2}\.\d{1,2})\s*[）)]/g, '$1');
    rules.push('日期缩为M.D、去日期括号');
    title = title.replace(/今天最值得知道的|今天最火的|今日|今天/g,'').replace(/的/g,'').replace(/\s+/g,' ').trim();
    rules.push('删除可省词');
    if (shortDate && !title.includes(shortDate)) title += shortDate;
    if(shortDate&&/[｜|]/.test(title)) {
      title=title.replace(shortDate,'').replace(/[｜|]/,'｜'+shortDate+' ').trim();
      rules.push('日期置于栏目之后');
    }
    if (titleLen(title) > LIMITS.xhs.title) {
      title = title.replace(/(\d+)个开源项目/g,'开源$1选').replace(/(\d+)个项目/g,'$1项');
      rules.push('缩写项目数量');
    }
  }
  if (titleLen(title) > LIMITS.xhs.title) throw new SkillError('USAGE', `标题压缩后仍为 ${titleLen(title)} 字，超过20字：${title}；请设置 xhsTitle，绝不硬截断`);
  return {titleOriginal:original, titleFinal:title, titleCompressed:title !== original, titleRule:rules.join('；') || '原题符合限制', titleCount:titleLen(title)};
}

export const DETAIL_CUE = '每个项目的详细介绍见图';

/** 图片内删除 URL 专行；正文提到的裸站点名转成无域名的站点称呼，避免删出残句。 */
export function cleanImageText(value) {
  const text=String(value??'').replace(/^\s*链接[：:].*$/gm,'')
    .replace(/(?<![\w@/.-])((?:[a-z0-9-]+\.)+)(com|org|net|io|co|cn|news|me|info|xyz|ai|app|dev|cc)(?![\w/.-])/gi,
      (_,host)=>host.replace(/\.$/,'').replace(/\./g,' ')+'站点');
  return collapseLinkShells(stripHashtagLines(stripLanVTags(sanitizeLinks(text,{policy:'strip'}).text).text));
}

/** 离线分割，优先把整段详细介绍移到图中，正文保留榜单和我的看法。 */
export function splitBody(content, appendix=[], {bodyLimit=1000,topics=[]}={}) {
  const original = String(content).trim();
  const topicReserve = topics.reduce((n,t)=>n+charLen(t)+4,0);
  const max = bodyLimit - topicReserve;
  const cleanCue = s => s.replace(/每(?:条|个项目)(?:的)?详细介绍(?:和链接)?见(?:评论(?:区)?|图)[。！]?/g,'').trim();
  let main = original;
  const moved = [];
  if (appendix.length || charLen(main) > max) {
    main = cleanCue(main);
    if (charLen(main + '\n\n' + DETAIL_CUE) > max) {
      const parts = main.split(/\n\s*\n/);
      // 独立榜单、看法段落必须保留；其余段落按原文转图。
      const keep = [], extras = [];
      for (const p of parts) (/^(?:\d+[.、\s]|我的看法[：:])/.test(p.trim()) ? keep : extras).push(p);
      if(!keep.length) {
        const remaining=[];let full=false;
        for(const p of parts) {
          if(!full&&charLen([...remaining,p].join('\n\n')+'\n\n'+DETAIL_CUE)<=max) remaining.push(p);
          else {full=true;moved.push(p);}
        }
        main=remaining.join('\n\n');
        if(!main) main='完整内容见图';
      } else {main = keep.join('\n\n'); moved.push(...extras);}
      if (charLen(main + '\n\n' + DETAIL_CUE) > max) {
        throw new SkillError('USAGE','正文榜单及我的看法加话题后仍超 bodyLimit；请提供完整且较短的小红书正文，不截断观点');
      }
    }
    main += '\n\n' + DETAIL_CUE;
  }
  return {content:main, contentOriginal:original, bodyCount:charLen(main), topicReserve, overflowText:[...moved,...appendix], bodyMovedToImages:moved.length>0 || appendix.length>0};
}



/** 去掉正文里当纯文本写的 #话题 行（正式话题稍后用下拉插入） */
export function stripHashtagLines(text) {
  return String(text ?? '')
    .replace(/^[ \t]*(#[^\s#]+[ \t]*)+$/gm, '')
    .replace(/[ \t]+$/gm, '');
}

/** 去掉正文开头与标题重复的一行（含｜/|、（11.10）等细微差别） */
export function stripRepeatedTitle(content, ...titles) {
  const lines = String(content ?? '').split(/\n/);
  if (!lines.length) return String(content ?? '');
  const norm = (s) => String(s || '').trim().replace(/[｜|]/g, '｜').replace(/\s+/g, '').replace(/[（(]11\.10[）)]$/, '');
  const first = lines[0].trim();
  const candidates = titles.map((x) => String(x || '').trim()).filter(Boolean);
  if (!first || !candidates.length) return String(content ?? '');
  const hit = candidates.some((title) => {
    const a = norm(first);
    const b = norm(title);
    return a === b || a.startsWith(b) || b.startsWith(a);
  });
  if (!hit) return String(content ?? '');
  const rest = lines.slice(1).join('\n').replace(/^\n+/, '');
  return rest;
}

/** 去掉含「蓝V」的话题（X 专用，不是小红书话题） */
export function filterTopics(list) {
  const topics = [];
  const removed = [];
  for (const value of Array.isArray(list) ? list : []) {
    const original = String(value);
    const topic = original.trim().replace(/^#+\s*/, '').trim();
    if (/蓝\s*V/i.test(topic)) {
      removed.push(original);
      log(`已删除含「蓝V」的话题: ${original}`);
    } else if (topic) {
      topics.push(topic);
    }
  }
  return { topics, removed };
}

/** 删除正文里的 #蓝V交友、蓝V互关 等标签，保留 #AI 等 */
export function stripLanVTags(text) {
  const removed = [];
  let out = String(text ?? '');
  out = out.replace(/#[^\s#]*蓝\s*V[^\s#]*/gi, (m) => { removed.push(m); return ''; });
  out = out.replace(/(?<![#\w/])蓝\s*V[^\s#]*/gi, (m) => { removed.push(m); return ''; });
  out = out.replace(/[ \t]{2,}/g, ' ');
  if (removed.length) log(`已从正文删除含「蓝V」的标签: ${removed.join(' ')}`);
  return { text: out, removed };
}

/** 清掉「链接：」空壳和多余空行 */
export function collapseLinkShells(text) {
  return String(text ?? '')
    .replace(/^[ \t]*链接[：:][ \t]*$/gm, '')
    .replace(/^[ \t]*来源[：:][ \t]*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

/**
 * 外链处理。小红书默认 strip：删除 http(s) URL、www.、以及带路径的裸域名（如 cnbc.com/2026/...）。
 * 不含域名的 owner/repo 仓库短名保留。
 * policy: strip（默认）/ describe（转述）/ keep（原样，需用户明确承担风险）
 */
export function sanitizeLinks(text, { policy = 'strip' } = {}) {
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
    /https?:\/\/[^\s，。、；："'“”‘’（）()【】《》<>|！？`]+/gi,
    /(?<![\w@/.-])www\.[^\s，。、；："'“”‘’（）()【】《》<>|！？`]+/gi,
    /(?<![\w@/.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|co|cn|news|me|info|xyz|ai|app|dev|cc)(?![\w-])(?::\d+)?(?:[/?#][^\s，。、；："'“”‘’（）()【】《》<>|！？`]*)?/gi,
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
  const contentLimit = job.bodyLimit ?? lim.content;
  const warnings = [];
  const errors = [];
  if (!job.images.length && lim.images[0] > 0) errors.push('至少需要 1 张图片');
  if (job.images.length > lim.images[1]) errors.push(`图片最多 ${lim.images[1]} 张，当前 ${job.images.length} 张`);
  if (platform === 'xhs' && !job.title) errors.push('标题不能为空');
  const tl = platform === 'xhs' ? titleLen(job.title) : charLen(job.title);
  if (tl > lim.title) {
    errors.push(`标题 ${tl} 字，超过平台上限 ${lim.title} 字`);
  } else if (tl > lim.title - 2) {
    warnings.push(`标题 ${tl} 字，接近上限 ${lim.title} 字`);
  }
  const cl = charLen(job.content) + (job.topicReserve ?? 0);
  if (!cl) errors.push('正文不能为空');
  if (cl > contentLimit) errors.push(`正文 ${cl} 字，超过平台上限 ${contentLimit} 字`);
  else if (cl > contentLimit - 50) warnings.push(`正文 ${cl} 字，接近上限 ${contentLimit} 字`);

  // 纯文字模式：没给 caption 时会把 content 全文塞进发布页正文框（上限 1000 字）
  if (platform === 'xhs' && job.images.length === 0) {
    const effective = job.caption && job.caption.trim() ? job.caption.trim() : job.content.trim();
    const capLen = charLen(effective);
    if (capLen + (job.topicReserve??0) > contentLimit) errors.push(`发布页正文及话题超过 ${contentLimit}，须先转详情图，不截断`);
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
