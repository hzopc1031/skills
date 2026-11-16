// Existing-note jobs deliberately do not use post readJob: no title compression,
// GitHub layout, overflow rendering, or implicit body/topic replacement.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { rememberPromotionInput, promotionInput } from './promotion-context.mjs';
import { SkillError, titleLen, charLen, sanitizeLinks, stripLanVTags, stripHashtagLines, collapseLinkShells, filterTopics } from './util.mjs';

const own = (o, k) => Object.hasOwn(o, k);
const fail = (message) => { throw new SkillError('USAGE', message); };
const text = (v, field) => {
  if (typeof v !== 'string' || !v.trim()) fail(`${field} 必须是非空字符串`);
  return v.trim();
};

// Structural/container checks, not a pixel decoder; platform upload must still finish.
function pngContainer(bytes) {
  if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
  let pos=8,idat=false,header=false;
  while(pos+12<=bytes.length){
    const size=bytes.readUInt32BE(pos),type=bytes.toString('ascii',pos+4,pos+8);
    if(pos+12+size>bytes.length) return false;
    if(pos===8){header=type==='IHDR'&&size===13&&bytes.readUInt32BE(pos+8)>0&&bytes.readUInt32BE(pos+12)>0;if(!header)return false;}
    if(type==='IDAT'&&size>0)idat=true;
    if(type==='IEND')return size===0&&pos+12===bytes.length&&header&&idat;
    pos+=size+12;
  }
  return false;
}
function jpegContainer(bytes) {
  if(bytes.length<12||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return false;
  let pos=2;
  while(pos+4<bytes.length&&bytes[pos]===255){
    while(bytes[pos]===255)pos++;
    if(pos+3>bytes.length)return false;
    const marker=bytes[pos++];
    if(marker===0xda||marker===0xd9)return false;
    if(marker>=0xd0&&marker<=0xd7)continue;
    const size=bytes.readUInt16BE(pos);
    if(size<2||pos+size>bytes.length)return false;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))
      return size>=8&&bytes.readUInt16BE(pos+3)>0&&bytes.readUInt16BE(pos+5)>0;
    pos+=size;
  }
  return false;
}
function webpContainer(bytes) {
  if(bytes.length<25||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)return false;
  const type=bytes.toString('ascii',12,16),size=bytes.readUInt32LE(16);
  if(size+20>bytes.length)return false;
  if(type==='VP8X')return size===10&&bytes.length>=30;
  if(type==='VP8L')return size>=5&&bytes[20]===0x2f;
  return type==='VP8 '&&size>=10&&bytes.length>=30&&bytes.subarray(23,26).equals(Buffer.from([0x9d,1,0x2a]))&&(bytes.readUInt16LE(26)&0x3fff)>0&&(bytes.readUInt16LE(28)&0x3fff)>0;
}

export function preflightEditImages(images) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 18) fail('替换图片必须为 1..18 张');
  return images.map(file => {
    let stat, bytes;
    try { stat = fs.statSync(file); } catch { fail(`图片不存在或不可读: ${file}`); }
    if (!stat.isFile() || stat.size === 0 || stat.size > 32 * 1024 * 1024) fail(`图片必须为非空普通文件且不超过32MB: ${file}`);
    const ext = path.extname(file).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) fail(`图片只支持 png/jpg/jpeg/webp: ${file}`);
    try { bytes = fs.readFileSync(file); } catch { fail(`图片不可读: ${file}`); }
    if(bytes.length!==stat.size||bytes.length>32*1024*1024) fail(`图片在预检期间发生变化或超过32MB: ${file}`);
    const png = pngContainer(bytes);
    const jpg = jpegContainer(bytes);
    const webp = webpContainer(bytes);
    if (!(ext === '.png' ? png : ext === '.webp' ? webp : jpg)) fail(`图片格式头/尺寸无效或与扩展名不符: ${file}`);
    return { path: file, bytes: stat.size, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
}

export function prepareEditJob(raw, { baseDir = process.cwd(), jobFile } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('edit job 必须是对象');
  const edit = raw.edit ?? {};
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) fail('job.edit 必须是对象');
  const allowed = ['targetTitle','originalTitle','date','title','content','topics','replaceImages'];
  for (const key of Object.keys(edit)) if (!allowed.includes(key)) fail(`未知 edit 字段: ${key}`);
  const targets = [edit.targetTitle, edit.originalTitle, raw.originalTitle].filter(v => v !== undefined).map(v => text(v, 'originalTitle/targetTitle'));
  if (new Set(targets).size > 1) fail('originalTitle 与 edit.targetTitle 不一致');
  const targetTitle = targets[0] ?? text(raw.title, 'edit.targetTitle（旧任务可用 job.title）');
  const date = edit.date ?? raw.date;
  if (edit.date !== undefined && raw.date !== undefined && edit.date !== raw.date) fail('edit.date 与 job.date 不一致');
  if (date !== undefined) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date) fail('edit.date 必须是有效业务日期 YYYY-MM-DD');
  }
  if (raw.submit !== undefined && typeof raw.submit !== 'boolean') fail('job.submit 必须是布尔值');
  if (edit.replaceImages !== undefined && typeof edit.replaceImages !== 'boolean') fail('edit.replaceImages 必须是布尔值，图片路径放在 job.images');
  if (raw.images !== undefined && (!Array.isArray(raw.images) || raw.images.some(p => typeof p !== 'string' || !p.trim()))) fail('job.images 必须是路径数组');
  const replaceImages = edit.replaceImages ?? Boolean(raw.images?.length);
  const images = replaceImages ? (raw.images ?? []).map(p => path.resolve(baseDir, p)) : [];
  const imagePreflight = replaceImages ? preflightEditImages(images) : [];
  const plan = { targetTitle, ...(date === undefined ? {} : { date }), replaceImages };
  // Only explicit nested fields authorize a rewrite. Legacy content/caption/topics are ignored.
  if (own(edit, 'title')) {
    plan.title = text(edit.title, 'edit.title');
    if (titleLen(plan.title) > 20) fail('edit.title 超过20字；编辑不压缩、不截断标题');
    if (sanitizeLinks(plan.title).text !== plan.title) fail('edit.title 不得包含URL或域名');
  }
  if (own(edit, 'content')) {
    if (typeof edit.content !== 'string') fail('edit.content 必须是字符串（可用空串明确清空正文）');
    // No automatic overflow, repeated-title removal, or source-content fallback.
    plan.content = collapseLinkShells(stripHashtagLines(stripLanVTags(sanitizeLinks(edit.content).text).text));
    if (charLen(plan.content) > 1000) fail('edit.content 超过1000字；编辑不自动转图或截断');
  }
  if (own(edit, 'topics')) {
    if (!Array.isArray(edit.topics) || edit.topics.some(t => typeof t !== 'string' || !t.trim())) fail('edit.topics 必须是非空话题名数组，[] 明确删除话题');
    const result = filterTopics(edit.topics);
    if (result.removed.length || result.topics.some(t => sanitizeLinks(t).text !== t)) fail('edit.topics 不支持蓝V话题、URL或域名');
    plan.topics = [...new Map(result.topics.map(t => [t.toLowerCase(),t])).values()];
  }
  if (own(plan,'content') && own(plan,'topics') && charLen(plan.content) + plan.topics.reduce((n,t)=>n+charLen(t)+4,0) > 1000) fail('新正文加正式话题超过1000字');
  if (!replaceImages && !['title','content','topics'].some(k => own(plan,k))) fail('edit 没有授权任何修改；请给新图片或显式 edit.title/content/topics');
  return rememberPromotionInput({ account:raw.account, edit:plan, images, imagePreflight, jobFile:jobFile ?? raw.jobFile,
    promotionReview:raw.promotionReview,
    submit:raw.submit, submitDisabled:raw.submitDisabled === true || raw.submit === false },
    promotionInput(raw)?.original ?? raw, 'edit');
}

export function readEditJob(file) {
  if (typeof file !== 'string' || !file.trim()) fail('缺少 --job 文件路径');
  const abs = path.resolve(file);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(abs,'utf8').replace(/^\uFEFF/,'')); }
  catch(e) { fail(`编辑任务读取失败: ${e.message}`); }
  return prepareEditJob(raw, { baseDir:path.dirname(abs), jobFile:abs });
}
