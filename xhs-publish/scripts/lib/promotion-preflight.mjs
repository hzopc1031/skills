// Local heuristics and explicit human declarations; never CDP, OCR, network, or platform approval.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyzePromotionRisk, promotionRiskRulesVersion } from './promotion-risk.mjs';
import { promotionInput } from './promotion-context.mjs';
import { SkillError } from './util.mjs';

const own = (o, k) => Object.hasOwn(o ?? {}, k);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const detailed = value => typeof value === 'string' && [...value.trim()].length >= 12;
const reviewerPresent = value => typeof value === 'string' && value.trim().length >= 2;

/** Ordered source binding, not a pixel/content hash or proof of inspection. */
export function retainedImagesHash(noteId, images) {
  return sha(JSON.stringify({ noteId, sources: images.map(image => image.src) }));
}

function addText(surfaces, name, value) {
  if (typeof value === 'string' && value.trim()) surfaces.push({ name, text: value });
  else if (Array.isArray(value)) value.forEach((item, index) => addText(surfaces, `${name}[${index}]`, item));
}
function projectText(surfaces, name, projects) {
  if (!Array.isArray(projects)) return;
  projects.forEach((project, index) => {
    if (!project || typeof project !== 'object') return;
    for (const [key, value] of Object.entries(project)) addText(surfaces, `${name}[${index}].${key}`, value);
    addText(surfaces, `${name}[${index}].context`, Object.values(project).filter(value=>typeof value==='string').join('\n'));
  });
}
function postText(surfaces, label, job) {
  for (const key of ['title', 'xhsTitle', 'content', 'unifiedPost', 'caption', 'topics', 'appendix', 'overflowText', 'introTitle']) {
    addText(surfaces, `${label}.${key}`, job[key]);
  }
  addText(surfaces, `${label}.noteContext`, [job.xhsTitle??job.title,job.content??job.unifiedPost,job.caption].filter(value=>typeof value==='string').join('\n'));
  addText(surfaces, `${label}.githubLayout.mainLine`, job.githubLayout?.mainLine);
  addText(surfaces, `${label}.overflow.heading`, job.overflow?.heading);
  const intro = job.githubIntro;
  if (intro && typeof intro === 'object' && intro.enabled !== false) {
    for (const key of ['title', 'subtitle', 'footer']) addText(surfaces, `${label}.githubIntro.${key}`, intro[key]);
    projectText(surfaces, `${label}.githubIntro.projects`, intro.projects);
  }
  projectText(surfaces, `${label}.projects`, job.projects);
  for (const [index, page] of (Array.isArray(job.overflowResult?.pages) ? job.overflowResult.pages : []).entries()) {
    addText(surfaces, `${label}.overflow.pages[${index}].text`, page.text);
  }
}
function editText(surfaces, label, job) {
  addText(surfaces, `${label}.edit.context`, [job.edit?.title,job.edit?.content].filter(value=>typeof value==='string').join('\n'));
  // Locators and ignored legacy top-level content/caption/topics never authorize a rewrite.
  for (const key of ['title', 'content', 'topics']) {
    if (own(job.edit, key)) addText(surfaces, `${label}.edit.${key}`, job.edit[key]);
  }
}
function validInspection(record) {
  return record && typeof record === 'object' && record.visualChecked === true
    && typeof record.visibleText === 'string' && record.conclusion === 'no-outbound-promotion'
    && detailed(record.rationale) && reviewerPresent(record.reviewer);
}
function generatedIntent(job, original) {
  return Boolean(job.overflowText?.length || original.type === 'github-ranking'
    || (original.githubIntro && original.githubIntro.enabled !== false));
}

/**
 * phase=offline is a non-rendering inventory; known gates known input before local
 * rendering/authorized editor reads; final gates every effective surface before UI mutation.
 * These phases are code-controlled, never a job flag or a production skip option.
 */
export function buildPromotionPreflight(job, { kind = 'post', phase = 'offline', visible, retained, platformLayout = false } = {}) {
  if (!['post', 'edit'].includes(kind) || !['offline', 'known', 'final'].includes(phase)) {
    throw new SkillError('USAGE', '推广预检 kind/phase 无效');
  }
  const context = promotionInput(job);
  const original = context?.kind === kind ? context.original : job;
  const surfaces = [];
  if (kind === 'edit') {
    editText(surfaces, 'raw', original);
    editText(surfaces, 'final', job);
    if (visible) {
      for (const key of ['title', 'content', 'topics']) addText(surfaces, `effective.${key}`, visible[key]);
      addText(surfaces, 'effective.noteContext', [visible.title,visible.content].filter(value=>typeof value==='string').join('\n'));
    }
  } else {
    postText(surfaces, 'raw', original);
    postText(surfaces, 'final', job);
  }
  const declarations = job.promotionReview;
  const imageIssues = [];
  const images = [];
  const inputImages = kind === 'edit' && !job.edit?.replaceImages ? [] : (job.images ?? []);
  for (const [index, file] of inputImages.entries()) {
    const name = `images[${index}]`;
    let digest;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size < 1 || stat.size > 32 * 1024 * 1024
        || !/\.(?:png|jpe?g|webp|gif|bmp)$/i.test(path.extname(file))) throw new Error('不是受支持的非空图片或超过32MB');
      digest = sha(fs.readFileSync(file));
    } catch (error) {
      images.push({ path: file, status: 'unreadable' });
      imageIssues.push({ surface: name, reason: `无法读取待审图片：${error.message}` });
      continue;
    }
    const matches = Array.isArray(declarations?.images) ? declarations.images.filter(row => row?.sha256 === digest) : [];
    const record = matches.length === 1 ? matches[0] : undefined;
    // Even a malformed matching declaration cannot hide a risky transcription.
    matches.forEach((row, i) => addText(surfaces, `${name}.visibleText[${i}]`, row.visibleText));
    const accepted = validInspection(record);
    images.push({ path: file, sha256: digest, status: accepted ? 'human-declaration' : 'needs_review',
      ...(accepted ? { reviewer: record.reviewer, rationale: record.rationale, transcriptProvided: true } : {}) });
    if (!accepted) imageIssues.push({ surface: name, sha256: digest,
      reason: '缺少唯一且绑定当前SHA256的逐图人工视觉/全部文字转录审阅声明（rationale至少12字、reviewer至少2字）' });
  }

  const pendingExisting = kind === 'edit' && !visible;
  const pendingPlatformLayout = kind === 'post' && (platformLayout || inputImages.length === 0);
  const pendingGenerated = kind === 'post' && phase !== 'final' && (pendingPlatformLayout || generatedIntent(job, original));
  if (phase === 'final' && pendingPlatformLayout) imageIssues.push({ surface:'images',
    reason:'旧平台一键排版长文尚无可绑定SHA256的本地卡片；请先独立本地渲染、逐张人工审阅后以图文发布，不先上传或预填来试审核。' });
  let retainedInspection;
  if (kind === 'edit' && visible && !job.edit?.replaceImages) {
    if (!retained || typeof retained.noteId !== 'string' || !Array.isArray(retained.images)
      || retained.images.some(image => typeof image?.src !== 'string' || !image.src)) {
      imageIssues.push({ surface: 'retained.images', reason: '缺少同ID有序原图来源，无法绑定保留图人工审阅' });
    } else {
      const digest = retainedImagesHash(retained.noteId, retained.images);
      const record = declarations?.retainedImages;
      const accepted = record?.noteId === retained.noteId && record?.sha256 === digest && validInspection(record);
      if (record?.noteId === retained.noteId && record?.sha256 === digest) addText(surfaces, 'retained.images.visibleText', record.visibleText);
      retainedInspection = { noteId: retained.noteId, sha256: digest, imageCount: retained.images.length,
        binding: 'ordered-source-strings-not-pixel-hash', status: accepted ? 'human-declaration' : 'needs_review',
        ...(accepted ? { reviewer: record.reviewer, rationale: record.rationale, transcriptProvided: true } : {}) };
      if (!accepted) imageIssues.push({ surface: 'retained.images', noteId: retained.noteId, sha256: digest,
        reason: '保留原图需要绑定同noteId及有序来源哈希的人工视觉/全部文字审阅；不得为通过检查擅自换图' });
    }
  }
  const analyzed = analyzePromotionRisk(surfaces);
  const surfaceHashes = new Map(surfaces.map(surface => [surface.name, sha(surface.text)]));
  const findings = analyzed.findings.map(finding => {
    // Bind the complete source surface too: edits outside an excerpt invalidate its decision.
    const findingHash = sha(JSON.stringify([promotionRiskRulesVersion, finding.ruleId, finding.severity,
      finding.excerpt, surfaceHashes.get(finding.surface)]));
    const matches = Array.isArray(declarations?.text) ? declarations.text.filter(row => row?.findingHash === findingHash) : [];
    const record = matches.length === 1 ? matches[0] : undefined;
    const accepted = finding.severity === 'review' && record?.decision === 'neutral-reporting'
      && detailed(record.rationale) && reviewerPresent(record.reviewer);
    return { ...finding, findingHash, review: { accepted,
      ...(accepted ? { decision: record.decision, rationale: record.rationale, reviewer: record.reviewer } : {}) } };
  });
  const blocked = findings.some(finding => finding.severity === 'block');
  const unresolved = findings.filter(finding => finding.severity === 'review' && !finding.review.accepted).length;
  const pendingOffline = phase === 'offline' && (pendingExisting || pendingGenerated);
  const status = blocked ? 'blocked' : unresolved || imageIssues.length || pendingOffline ? 'needs_review' : 'clear';
  return { ...analyzed, schemaVersion: 1, rulesVersion: promotionRiskRulesVersion, status, findings,
    kind, phase, textStatus: blocked ? 'blocked' : unresolved ? 'needs_review' : 'clear',
    ready: status === 'clear', offlineOnly: true, heuristic: true, guarantee: false,
    scope: phase === 'known' ? 'known-input-only-followed-by-mandatory-final-gate' : phase,
    unresolvedReviews: unresolved, imageIssues, pendingExisting, pendingGenerated, pendingPlatformLayout,
    surfaces: surfaces.map(surface => ({ name: surface.name, sha256: surfaceHashes.get(surface.name), characters: [...surface.text].length })),
    imageInspection: { method: 'human-declaration-only', automaticOcr: false, scriptViewedImages: false,
      images, retainedImages: retainedInspection ?? null, pendingExisting, pendingGenerated, pendingPlatformLayout,
      statement: '脚本仅核对文件/来源哈希和人工声明并扫描转录文字；未自动看图或OCR，不证明声明真实，不保证平台审核。' } };
}

export function assertPromotionReady(job, options = {}) {
  const report = buildPromotionPreflight(job, { phase: 'final', ...options });
  if (!report.ready) {
    const error = new SkillError('CONTENT_REVIEW_REQUIRED', '推广/站外引导预检未通过；停止渲染、上传、预填或提交，先处理报告中的阻断或具体人工审阅项');
    error.promotionPreflight = report;
    throw error;
  }
  return report;
}
