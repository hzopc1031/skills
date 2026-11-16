import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePromotionRisk, promotionRiskRulesVersion } from '../scripts/lib/promotion-risk.mjs';

const scan = (text, name = 'body') => analyzePromotionRisk([{ name, text }]);
const has = (result, ruleId, severity) => result.findings.some((f) => f.ruleId === ruleId && (!severity || f.severity === severity));
const notBlocked = (result) => assert.notEqual(result.status, 'blocked');

test('screenshot 1: global free access plus third-party products requires review', () => {
  const result = scan('而且今天起全球免费用户就能用，Google 搜索、Sheets、Gemini App 都换了它的底座。');
  assert.equal(result.status, 'needs_review');
  assert.ok(has(result, 'B_THIRD_PARTY_BENEFIT', 'review'));
  assert.ok(has(result, 'E_UNVERIFIED_CLAIM', 'review'));
});

test('screenshot 2: adjacent short sentence inherits product context for endorsement', () => {
  const result = scan('蚂蚁灵光更克制，主要靠支付宝账单帮你分析消费。两家都被应用墙挡着，但已经能替你办一些具体的事。');
  assert.equal(result.status, 'needs_review');
  assert.ok(has(result, 'C_THIRD_PARTY_ENDORSEMENT', 'review'));
});

test('screenshot 3: explicit switch-and-try CTA is blocked', () => {
  const result = scan('Gemini 4 这次是真的把便宜和聪明同时做到了，日常写代码、做表格可以直接换过去试；');
  assert.equal(result.status, 'blocked');
  assert.ok(has(result, 'A_OFF_PLATFORM_CTA', 'block'));
});

test('a list of brand names alone is clear', () => {
  assert.equal(scan('Google、Gemini、ChatGPT、Claude、DeepSeek、蚂蚁灵光、支付宝、微信、抖音、淘宝、拼多多、京东、GitHub、YouTube、Telegram。').status, 'clear');
});

test('neutral product comparison does not block', () => {
  assert.equal(scan('Google 与 Claude 使用不同的技术路线，本文对比它们的响应长度和延迟。').status, 'clear');
});

test('a verb-shaped product name is not an action instruction', () => {
  assert.equal(scan('Google 搜索与 Gemini App 均发布了技术更新。').status, 'clear');
});

test('download and search statistics are nouns, not an external instruction', () => {
  assert.equal(scan('Google 下载量与 Gemini 访问量都属于统计数据。').status, 'clear');
});

test('single-character action words inside neutral verbs are not CTA', () => {
  assert.equal(scan('Google 增加 Gemini 的研发预算，报告提到 Claude，过去 ChatGPT 的数据另列。').status, 'clear');
});

test('neutral financial news is not a promotional block', () => {
  notBlocked(scan('Google 财报披露收入变化，免费用户规模属于财报统计口径，并非使用建议。'));
});

for (const [label, text] of [
  ['free', 'Gemini 提供免费额度。'],
  ['discount', '淘宝推出限时优惠。'],
  ['subscription', 'ChatGPT 会员订阅有专享权益。'],
  ['invitation', '某App 提供邀请码和红包福利。'],
  ['English benefit', 'Claude offers a free subscription.'],
  ['unknown named app', 'Acme App 有优惠。'],
]) {
  test(`third-party benefit: ${label} requires review, not an automatic block`, () => {
    const result = scan(text);
    assert.equal(result.status, 'needs_review');
    assert.ok(has(result, 'B_THIRD_PARTY_BENEFIT', 'review'));
  });
}

for (const text of [
  '去其他平台下载试用。', '打开 Gemini 试一试。', '下载 ChatGPT。',
  '注册 Claude 账号。', '访问 Google 官网。', '切换到 DeepSeek。',
  '到淘宝搜索并购买。', '加微信联系我。', '下载灵巧App。',
  'Visit GitHub to get started.', 'Download ChatGPT now.',
  'Sign up for Claude.', 'Switch to Gemini.', 'Go to YouTube.',
  'Visit https://example.com/start.', '访问 example.com 了解详情。',
]) {
  test(`explicit external CTA blocks: ${text}`, () => {
    const result = scan(text);
    assert.equal(result.status, 'blocked');
    assert.ok(has(result, 'A_OFF_PLATFORM_CTA', 'block'));
  });
}

for (const text of ['链接见评论区。', '下载地址在主页。', '评论区领下载地址。', '私信获取二维码。', '联系方式见简介。']) {
  test(`external handoff blocks: ${text}`, () => {
    const result = scan(text);
    assert.equal(result.status, 'blocked');
    assert.ok(has(result, 'A_CONTACT_TRANSFER', 'block'));
  });
}

for (const text of ['看主页合集，欢迎在评论区讨论。', '在评论区分享你的看法。', '打开小红书看主页合集。', '在小红书搜索 Gemini 相关笔记。', '打开小红书搜索 Google 的新闻。']) {
  test(`in-platform interaction is not blocked: ${text}`, () => {
    assert.equal(scan(text).status, 'clear');
  });
}

for (const text of ['不要去其他平台下载。', '禁止加微信导流。', '请勿打开 Gemini。', "Don't download ChatGPT.", 'Do not visit GitHub.']) {
  test(`negated or forbidden CTA is not positive promotion: ${text}`, () => {
    const result = scan(text);
    notBlocked(result);
    assert.ok(has(result, 'A_OFF_PLATFORM_CTA', 'info'));
  });
}

for (const text of ['不要\n下载 Gemini。', "Don't\nDownload ChatGPT.", '链接禁止放评论区。', '不要在评论区领下载地址。']) {
  test(`soft-wrapped or handoff-local negation remains non-blocking: ${JSON.stringify(text)}`, () => {
    notBlocked(scan(text));
  });
}

test('not every Chinese character 不 is semantic negation', () => {
  assert.equal(scan('不妨去 Google 官网。').status, 'blocked');
  assert.ok(has(scan('Gemini 不错，值得用。'), 'C_THIRD_PARTY_ENDORSEMENT', 'review'));
});

test('negation does not leak past a contrast into a positive CTA', () => {
  assert.equal(scan('不要相信传闻，但可以去 Gemini 官网试用。').status, 'blocked');
});

test('negation does not leak past a comma into a positive CTA', () => {
  assert.equal(scan('禁止乱加群，去官网下载 Gemini。').status, 'blocked');
});

test('a negated free claim is not benefit promotion', () => {
  const result = scan('Gemini 并不免费，Claude 也不便宜。');
  notBlocked(result);
  assert.equal(has(result, 'B_THIRD_PARTY_BENEFIT'), false);
});

test('a negated recommendation is not endorsement', () => {
  assert.equal(has(scan('我不推荐 Gemini，也不建议 ChatGPT。'), 'C_THIRD_PARTY_ENDORSEMENT'), false);
});

test('quoted third-party CTA requires review rather than silently clearing or blocking', () => {
  const result = scan('有人说：“去 Google 官网注册”。这是转述，不是我的建议。');
  assert.equal(result.status, 'needs_review');
  assert.ok(has(result, 'A_OFF_PLATFORM_CTA', 'review'));
});

test('quoted English CTA requires review', () => {
  const result = scan('An example says "Visit GitHub".');
  assert.equal(result.status, 'needs_review');
  assert.ok(has(result, 'A_OFF_PLATFORM_CTA', 'review'));
});

test('a quoted warning stays non-blocking', () => {
  notBlocked(scan('规则提醒：“不要去其他平台下载”。'));
});

test('an author CTA after a completed quotation is still blocked', () => {
  const result = scan('有人说“不要导流”。现在去 Google 官网注册。');
  assert.equal(result.status, 'blocked');
});

for (const text of ['来源：https://example.com/report', '资料：www.example.org', '来源 example.ai/report', '请核对示例.中国 的来源', '微信号：abc_123', 'VX:abc_123', 'contact@example.org', '电话：13800138000', '图内有二维码提示。']) {
  test(`visible external reference is review without a CTA: ${text}`, () => {
    const result = scan(text);
    assert.equal(result.status, 'needs_review');
    assert.ok(has(result, 'D_VISIBLE_EXTERNAL_REFERENCE', 'review'));
  });
}

test('a neutral reference location is not a comment/profile/private-message handoff', () => {
  assert.equal(scan('来源链接在参考文献中，本文只记录研究方法。').status, 'clear');
});

test('owner/repo short names and file names are not URLs', () => {
  const result = scan('开源项目 owner/repo、deepseek-ai/DeepSeek-V3，说明见 README.md 与 index.mjs。');
  assert.equal(has(result, 'D_VISIBLE_EXTERNAL_REFERENCE'), false);
  notBlocked(result);
});

test('model versions and decimal numbers are not bare domains', () => {
  const result = scan('Gemini4.0 的延迟是 1.25 秒，版本 v2.3.4。');
  assert.equal(has(result, 'D_VISIBLE_EXTERNAL_REFERENCE'), false);
  assert.ok(has(result, 'E_UNVERIFIED_CLAIM', 'review'));
  notBlocked(result);
});

test('standalone decimals have no promotion context', () => {
  assert.equal(scan('测量值为 4.0，另一个值是 1.25。').status, 'clear');
});

for (const text of ['Gemini 是最便宜的模型。', 'Claude 是最好用的模型。', 'ChatGPT 今天起所有人可用。', 'Gemini 4 已发布。', 'Claude 价格为 20 美元每月。']) {
  test(`unverified assertion gets a factual-review reminder: ${text}`, () => {
    const result = scan(text);
    assert.ok(has(result, 'E_UNVERIFIED_CLAIM', 'review'));
    notBlocked(result);
  });
}

test('surfaces never inherit third-party context from each other', () => {
  const result = analyzePromotionRisk([{ name: 'account-a', text: 'Gemini' }, { name: 'account-b', text: '现在免费，已经能替你办事，换过去试。' }]);
  assert.equal(result.status, 'clear');
  assert.deepEqual(result.findings, []);
});

test('identical surface names still do not cause context sharing or deduplication loss', () => {
  const result = analyzePromotionRisk([{ name: 'body', text: '下载 ChatGPT。' }, { name: 'body', text: '下载 ChatGPT。' }]);
  assert.equal(result.summary.block, 2);
});

test('an unrelated intervening sentence stops context inheritance', () => {
  const result = scan('Gemini 是一个产品。今天讲一道数学题。现在免费。');
  assert.equal(result.status, 'clear');
});

test('a blank paragraph stops context inheritance', () => {
  assert.equal(scan('Gemini。\n\n现在免费。').status, 'clear');
});

test('far-away terms in a long paragraph are not arbitrarily combined', () => {
  const result = scan(`Gemini${'中性叙述'.repeat(100)}现在免费`);
  assert.equal(result.status, 'clear');
});

test('unrelated local destination does not become an external CTA because of a brand', () => {
  assert.equal(scan('Google 发布新闻。下课后去图书馆。').status, 'clear');
});

test('adjacent short English sentences may inherit product context', () => {
  assert.ok(has(scan('Gemini.\nIt is free.'), 'B_THIRD_PARTY_BENEFIT', 'review'));
});

for (const text of ['打开\nGemini。', 'Download\nChatGPT.', '访问\r\nGoogle 官网。']) {
  test(`a soft line wrap may connect an action to its external target: ${JSON.stringify(text)}`, () => {
    assert.equal(scan(text).status, 'blocked');
  });
}

test('a blank line does not connect an action to an external target', () => {
  assert.equal(scan('下载\n\nGemini。').status, 'clear');
});

test('line numbers are 1-based and anchored to the actual action', () => {
  const result = scan('第一行中性文字\r\n第二行中性文字\r\n去 Google 官网注册。', 'caption');
  const finding = result.findings.find((f) => f.severity === 'block');
  assert.equal(finding.line, 3);
  assert.equal(finding.surface, 'caption');
});

test('emoji do not break matching or truncate excerpt into a lone surrogate', () => {
  const result = scan(`${'🙂'.repeat(95)}打开 Gemini ${'🚀'.repeat(100)}`);
  assert.equal(result.status, 'blocked');
  for (const finding of result.findings) {
    assert.ok(finding.excerpt.length <= 160);
    assert.equal(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(finding.excerpt), false);
  }
});

test('summary exactly counts findings and blocked takes precedence', () => {
  const result = scan('禁止加微信导流。Gemini 免费。去 Google 官网。来源 example.com');
  const expected = { block: 0, review: 0, info: 0 };
  for (const finding of result.findings) expected[finding.severity] += 1;
  assert.deepEqual(result.summary, expected);
  assert.ok(result.summary.block > 0 && result.summary.review > 0 && result.summary.info > 0);
  assert.equal(result.status, 'blocked');
});

test('info alone does not turn status into needs_review', () => {
  const result = scan('禁止加微信导流。');
  assert.equal(result.status, 'clear');
  assert.ok(result.summary.info > 0);
});

test('empty text makes no image-inspection or platform-approval guarantee', () => {
  const result = analyzePromotionRisk([{ name: 'image-alt', text: '' }]);
  assert.deepEqual(result, { schemaVersion: 1, kind: 'xiaohongshu-promotion-risk', heuristic: true,
    status: 'clear', summary: { block: 0, review: 0, info: 0 }, findings: [],
    imageInspection: 'not-performed', guarantee: false });
  assert.deepEqual(analyzePromotionRisk([]), result);
});

test('options cannot force an image check, guarantee, or allow unsafe CTA', () => {
  const result = analyzePromotionRisk([{ name: 'body', text: '下载 ChatGPT。' }], { guarantee: true, imageInspection: 'performed', allow: true });
  assert.equal(result.guarantee, false);
  assert.equal(result.imageInspection, 'not-performed');
  assert.equal(result.status, 'blocked');
});

test('all findings have the fixed public shape and bounded excerpts', () => {
  const result = scan('Gemini 4 全球免费，推荐你用；去 Google 官网。链接见评论区，来源 example.com');
  for (const finding of result.findings) {
    assert.deepEqual(Object.keys(finding).sort(), ['ruleId', 'severity', 'surface', 'line', 'excerpt', 'reason', 'suggestion'].sort());
    assert.ok(['block', 'review', 'info'].includes(finding.severity));
    assert.ok(Number.isInteger(finding.line) && finding.line >= 1);
    assert.ok(finding.excerpt.length <= 160);
    assert.ok(finding.ruleId && finding.reason && finding.suggestion);
  }
  assert.equal(typeof promotionRiskRulesVersion, 'string');
});

test('analysis is deterministic and does not mutate caller input', () => {
  const surfaces = Object.freeze([Object.freeze({ name: 'body', text: 'Gemini 免费。' })]);
  const options = Object.freeze({});
  assert.deepEqual(analyzePromotionRisk(surfaces, options), analyzePromotionRisk(surfaces, options));
});

for (const invalid of [null, undefined, 'text', {}, 42, [null], [undefined], [{}], [{ name: 'body' }], [{ name: 1, text: '' }], [{ name: 'body', text: 1 }], [['body', 'text']], new Array(1)]) {
  test(`invalid surfaces throw TypeError: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => analyzePromotionRisk(invalid), TypeError);
  });
}

for (const invalid of [null, [], 'options', 42, true]) {
  test(`invalid options throw TypeError: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => analyzePromotionRisk([], invalid), TypeError);
  });
}
