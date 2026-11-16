/**
 * Offline text-only preflight heuristics, not a Xiaohongshu policy decision.
 * No file/network/browser access; brands are context, never a block by themselves.
 */
export const promotionRiskRulesVersion = '1.0.0';

const BRAND_SOURCE = String.raw`(?<![a-z])(?:Google(?:\s*(?:搜索|Sheets|Play))?|Gemini(?:\s*\d+(?:\.\d+)*)?|ChatGPT|GPT(?:[- ]?\d+(?:\.\d+)*)?|Claude(?:\s*\d+(?:\.\d+)*)?|DeepSeek(?:[- ]?[VR]\d+)?|GitHub|YouTube|Telegram|WhatsApp|WeChat|TikTok|Facebook|Instagram|Discord|OpenAI|Copilot|Perplexity|Notion)(?![a-z])|蚂蚁灵光|支付宝|微信|抖音|淘宝|拼多多|京东|百度|夸克|豆包|通义千问|腾讯元宝|小米|快手|哔哩哔哩`;
const GENERIC_TARGET_SOURCE = String.raw`外站|站外|其他平台|其它平台|第三方平台|其他\s*App|某\s*App|某平台|某软件|官网|官方网站|官方\s*(?:App|客户端)|应用商店|App\s+Store|[a-z][a-z0-9_-]{1,24}\s+(?:App|AI|platform|app)|[a-z][a-z0-9_-]{1,24}App|[\u4e00-\u9fff]{2,8}App`;
const TARGET_SOURCE = `(?:${BRAND_SOURCE}|${GENERIC_TARGET_SOURCE})`;
const ACTION_SOURCE = String.raw`换过去试(?:试)?|切换过去|切换(?:到|至)?|转到|转去|前往|打开|下载|注册|访问|试用|购买|搜索|去|到|加(?:一下|我的|我)?|添加|联系|扫码|扫描|\b(?:go\s+to|head\s+to|open|download|register(?:\s+(?:on|at|for))?|sign\s+up(?:\s+(?:on|at|for))?|visit|switch\s+to|try|buy(?:\s+(?:on|from))?|search(?:\s+(?:on|for))?|add|join|contact)\b`;
const BENEFIT_SOURCE = String.raw`免费|低价|便宜|优惠|会员|订阅|红包(?:福利)?|福利|专享权益|邀请码|折扣|限免|\b(?:free|cheaper|cheap|discount|coupon|exclusive\s+(?:offer|benefit)|invite\s+code|subscription)\b`;
const ENDORSE_SOURCE = String.raw`种草|强烈建议|推荐|真香|值得(?:一)?用|值得试|能(?:够)?(?:帮你|替你|帮我们|替我们)[^，,。！？!?\n]{0,18}(?:做|办|完成|分析|处理)|已经能替你办|\b(?:highly\s+recommend|recommend|worth\s+(?:using|trying)|helps?\s+you)\b`;
const DOMAIN_SOURCE = String.raw`(?<![a-z0-9_@./-])(?:[a-z0-9\u4e00-\u9fff](?:[a-z0-9\u4e00-\u9fff-]{0,61}[a-z0-9\u4e00-\u9fff])?\.)+(?:[a-z]{2,24}|中国|公司|网络)(?![a-z0-9_-])(?::\d{1,5})?(?:[/?#][^\s<>"'，。；！？、（）【】“”‘’]*)?`;
const URL_SOURCE = String.raw`https?:\/\/[^\s<>"'，。；！？、（）【】“”‘’]+|www\.[a-z0-9][^\s<>"'，。；！？、（）【】“”‘’]*|${DOMAIN_SOURCE}`;
const CONTACT_SOURCE = String.raw`(?:微信号\s*[:：]?|微[信訊][：:]|V[Xx][：:]|v信[：:]|WeChat\s*[:：]|Telegram\s*[:：@]|电[话話][：:]|手机号[：:]|联系方式[：:])\s*[a-z0-9_+@-]{3,}|(?<![a-z0-9_])[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}\b|(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)|二维码|QR\s*code`;
const TRANSFER_SOURCE = String.raw`(?:链接|网址|下载地址|下载链接|安装包|二维码|微信号|联系方式|邀请码)[^。！？!?；;\n]{0,16}(?:评论区|主页|简介|私信)|(?:评论区|主页|简介|私信)[^。！？!?；;\n]{0,16}(?:领|获取|拿|发|给|见|查看|有|放|提供)[^。！？!?；;\n]{0,12}(?:链接|网址|下载地址|安装包|二维码|微信号|联系方式|邀请码)|(?:私信|评论)[^。！？!?；;\n]{0,10}(?:发你|给你|领取|获取)[^。！？!?；;\n]{0,10}(?:链接|网址|下载地址|二维码|微信号)`;
const CLAIM_SOURCE = String.raw`全球免费|最便宜|最好(?:用)?|今天起[^，,。！？!?\n]{0,12}(?:都(?:可|能)(?:用|使用)|全部可用|所有人可用)|(?:Gemini|GPT|Claude|DeepSeek|模型)[-\s]*\d+(?:\.\d+)*|[$¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|美元|美金)(?:\s*(?:/月|每月|/年|每年))?`;
const MAX_UNIT = 240;
const SHORT_UNIT = 72;
const MAX_ASSOCIATION = 120;

function matches(source, text) {
  return [...text.matchAll(new RegExp(source, 'giu'))].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}

function validate(surfaces, options) {
  if (!Array.isArray(surfaces)) throw new TypeError('surfaces must be an array of { name, text } objects');
  for (const surface of surfaces) {
    if (!surface || typeof surface !== 'object' || Array.isArray(surface)
      || typeof surface.name !== 'string' || typeof surface.text !== 'string') {
      throw new TypeError('each surface must have string name and text properties');
    }
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
}

// Sentence/line boundaries are retained for line numbers and bounded adjacency.
function unitsOf(text) {
  const units = [];
  let start = 0;
  function push(end) {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const content = raw.trim();
    if (content) {
      for (let offset = 0; offset < content.length;) {
        let stop = Math.min(offset + MAX_UNIT, content.length);
        if (stop < content.length && /[\uD800-\uDBFF]/u.test(content[stop - 1])) stop -= 1;
        units.push({ text: content.slice(offset, stop), start: start + lead + offset,
          end: start + lead + stop, wholeShort: content.length <= SHORT_UNIT });
        if (stop === content.length) break;
        offset = stop - 64;
      }
    }
    start = end;
  }
  for (let i = 0; i < text.length; i += 1) {
    if (/[。！？!?；;\n]/u.test(text[i]) || (text[i] === '.' && (i + 1 === text.length || /\s/u.test(text[i + 1])))) push(i + 1);
  }
  push(text.length);
  return units;
}

function quoteRanges(text) {
  const ranges = [];
  const stack = [];
  const closing = { '“': '”', '「': '」', '『': '』', '‘': '’', '"': '"', "'": "'", '`': '`' };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    // An apostrophe in don't/it's is not an opening quotation mark.
    if (char === "'" && /[a-z0-9]/iu.test(text[i - 1] || '') && /[a-z0-9]/iu.test(text[i + 1] || '')) continue;
    if (stack.length && stack[stack.length - 1].end === char) {
      ranges.push({ start: stack.pop().start, end: i + 1 });
    } else if (closing[char]) stack.push({ start: i, end: closing[char] });
  }
  return ranges;
}

function isNegated(text, index) {
  const before = text.slice(Math.max(0, index - 32), index);
  // A single newline can be a soft wrap, but a paragraph is a hard boundary.
  const wrapped = before.split(/\r?\n\s*\r?\n/u).at(-1).replace(/[\r\n]/gu, ' ');
  // Never carry a negation over a contrast, comma, or a separate sentence.
  const clause = wrapped.split(/[，,。！？!?；;]|但是|但|而是|不过|\bbut\b/iu).at(-1);
  const negationClause = clause.replace(/不得不|不能不|不可不|不妨|不错|不仅|不但|不久/gu, '肯定');
  return /(?:不要|请勿|禁止|严禁|不得|不应(?:该)?|不可以|不能|避免|拒绝|不建议|别|并不|不是|没有|不再|不)[^，,。！？!?；;\n]{0,10}$/u.test(negationClause)
    || /\b(?:do\s+not|does\s+not|don't|dont|never|must\s+not|should\s+not|not|no)\s+(?:\w+\s+){0,2}$/iu.test(negationClause);
}

function gap(a, b) {
  return Math.max(0, a.start - b.end, b.start - a.end);
}

function related(match, targets, distance = MAX_ASSOCIATION) {
  return targets.some((target) => gap(match, target) <= distance);
}

function externalReferences(text) {
  const urls = matches(URL_SOURCE, text).filter((match) => !/\.(?:mjs|cjs|js|ts|tsx|jsx|md|json|txt|png|jpe?g|webp)$/iu.test(match.text));
  return [...urls, ...matches(CONTACT_SOURCE, text)];
}

function excerptAt(text, unit, absoluteIndex) {
  let start = Math.max(unit.start, absoluteIndex - 56);
  if (/[\uDC00-\uDFFF]/u.test(text[start] || '')) start += 1;
  let end = Math.min(unit.end, start + 160);
  if (/[\uD800-\uDBFF]/u.test(text[end - 1] || '')) end -= 1;
  return text.slice(start, end).trim();
}

/**
 * Analyze only caller-supplied visible text. Unknown options are intentionally
 * inert: no option can claim image inspection or disable/override a block.
 * Clear means no configured heuristic fired, never approval or a safety promise.
 */
export function analyzePromotionRisk(surfaces, options = {}) {
  validate(surfaces, options);
  const findings = [];
  const seen = new Set();
  for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex += 1) {
    const { name, text } = surfaces[surfaceIndex];
    const units = unitsOf(text);
    const quotes = quoteRanges(text);
    const lineStarts = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
    function add(ruleId, severity, unit, match, reason, suggestion) {
      const at = unit.start + match.start;
      const key = `${surfaceIndex}:${ruleId}:${at}`;
      if (seen.has(key)) return;
      seen.add(key);
      let low = 0;
      let high = lineStarts.length;
      while (low + 1 < high) {
        const mid = (low + high) >>> 1;
        if (lineStarts[mid] <= at) low = mid;
        else high = mid;
      }
      findings.push({ ruleId, severity, surface: name, line: low + 1,
        excerpt: excerptAt(text, unit, at), reason, suggestion });
    }
    function addCTA(ruleId, unit, match) {
      const at = unit.start + match.start;
      const negated = isNegated(text, at) || (ruleId === 'A_CONTACT_TRANSFER'
        && /(?:不要|请勿|禁止|严禁|不得|不应|别)[^，,。！？!?；;\n]{0,8}(?:见|放|发|领|获取|提供|私信|评论区|主页|简介)/u.test(match.text));
      const quoted = quotes.some((range) => range.start < at && at < range.end)
        || /(?:有人说|他说|她说|原文(?:写道|是)|引用|示例)[：:]?\s*$/u.test(text.slice(Math.max(0, at - 18), at));
      if (negated) {
        add(ruleId, 'info', unit, match,
          '检测到站外行动用语，但局部语境为否定、禁止或规则提醒；未按正向推广阻断。',
          '人工确认否定范围清晰，且没有其他正向站外引导。');
      } else if (quoted) {
        add(ruleId, 'review', unit, match,
          '引用或示例中仍对外展示了站外行动引导；仅凭文本不能判断展示目的。',
          '人工确认引用必要性和上下文，避免保留可执行的推广或联系方式。');
      } else {
        add(ruleId, 'block', unit, match,
          ruleId === 'A_CONTACT_TRANSFER'
            ? '检测到通过评论区、主页或私信转移链接、下载入口或联系方式的明确引导。'
            : '检测到与第三方目标或站外位置相连的行动引导；本地预检按推广风险阻断，并非平台定论。',
          '删除站外行动、下载/注册/购买入口或转移联系方式的引导，改为与主题有关的中性事实；需人工复核。');
      }
    }
    for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
      const unit = units[unitIndex];
      const previous = units[unitIndex - 1];
      const canInherit = previous && previous.wholeShort && unit.wholeShort
        && previous.end <= unit.start && !/\n\s*\n/u.test(text.slice(previous.start, unit.start));
      const targets = matches(TARGET_SOURCE, unit.text);
      const references = externalReferences(unit.text);
      const inherited = canInherit ? matches(TARGET_SOURCE, previous.text)
        .map((match) => ({ ...match, start: previous.start + match.start - unit.start, end: previous.start + match.end - unit.start })) : [];
      const contextTargets = [...targets, ...inherited];
      // A soft line wrap may split "Download\nChatGPT". Only join the
      // immediately adjacent short fragments, never paragraphs or sentences.
      const softWrap = canInherit && /[\r\n]/u.test(text.slice(previous.start, unit.start))
        && !/[。！？!?；;.][\r\n\s]*$/u.test(previous.text);
      const ctaUnit = softWrap ? { start: previous.start, end: unit.end,
        text: text.slice(previous.start, unit.end).replace(/[\r\n]/gu, ' ') } : unit;
      const actionTargets = softWrap
        ? [...matches(TARGET_SOURCE, ctaUnit.text), ...externalReferences(ctaUnit.text)]
        : [...targets, ...references];
      const actions = matches(ACTION_SOURCE, ctaUnit.text);
      const namedProducts = matches(BRAND_SOURCE, ctaUnit.text);
      for (const action of actions) {
        // A verb-shaped word inside a product name (Google 搜索) is not a CTA.
        if (namedProducts.some((product) => product.start <= action.start && product.end >= action.end)) continue;
        const beforeChar = ctaUnit.text[action.start - 1] || '';
        if ((action.text === '加' && /[增参附叠更]/u.test(beforeChar))
          || (action.text === '到' && /[得达提收遇看学想听做查找用谈说感等]/u.test(beforeChar))
          || (action.text === '去' && /[过失除减]/u.test(beforeChar))) continue;
        const afterAction = ctaUnit.text.slice(action.end);
        if (/^(?:下载|访问|搜索)$/u.test(action.text) && /^(?:量|次数|速度|记录|统计|引擎|结果|功能)/u.test(afterAction)) continue;
        const localPrefix = ctaUnit.text.slice(0, action.start).split(/[，,、。！？!?；;]/u).at(-1);
        if (/^(?:搜索|search(?:\s+(?:on|for))?)$/iu.test(action.text)
          && /(?:小红书|本平台|本站|站内)/u.test(localPrefix)) continue;
        // Match directional grammar locally; an unrelated earlier brand must not
        // turn "去图书馆" into an off-platform CTA.
        const followingTargets = matches(TARGET_SOURCE, ctaUnit.text.slice(action.end, action.end + 64))
          .map((target) => ({ ...target, start: target.start + action.end, end: target.end + action.end }));
        const direct = [...actionTargets, ...followingTargets].some((target) => {
          const between = target.start >= action.end
            ? ctaUnit.text.slice(action.end, target.start)
            : ctaUnit.text.slice(target.end, action.start);
          if (/[，,、。！？!?；;\n]/u.test(between) || /(?:小红书|本平台|本站|站内)/u.test(between)) return false;
          if (target.start >= action.end) return gap(action, target) <= 28;
          // Targets preceding an action need either adjacency or explicit
          // direction; neutral "Google发布下载统计" is not a command.
          return target.end <= action.start && gap(action, target) <= 24
            && /(?:请|快|赶紧|可以|直接|建议|不妨|现在|立即|一起|去|到|上|在|可|就|来|→|:|：)/u.test(between);
        });
        const anaphoric = /^(?:换过去试|切换过去)/u.test(action.text) && contextTargets.length > 0;
        if (direct || anaphoric) addCTA('A_OFF_PLATFORM_CTA', ctaUnit, action);
      }
      for (const transfer of matches(TRANSFER_SOURCE, unit.text)) addCTA('A_CONTACT_TRANSFER', unit, transfer);
      for (const benefit of matches(BENEFIT_SOURCE, unit.text)) {
        if (related(benefit, contextTargets) && !isNegated(unit.text, benefit.start)) {
          add('B_THIRD_PARTY_BENEFIT', 'review', unit, benefit,
            '第三方产品或平台附近出现免费、价格优惠、会员或权益宣传，可能构成利益导向推广。',
            '核对事实、适用范围和来源，删除与主题无关的利益招徕；不要把品牌名本身当成违规。');
        }
      }
      for (const endorsement of matches(ENDORSE_SOURCE, unit.text)) {
        if (related(endorsement, contextTargets) && !isNegated(unit.text, endorsement.start)) {
          add('C_THIRD_PARTY_ENDORSEMENT', 'review', unit, endorsement,
            '第三方目标附近出现正向安利或代办能力推荐；需结合全文人工判断是否构成实质推广。',
            '优先写可核实的具体事实、条件和局限，删除无依据的推荐与站外使用引导。');
        }
      }
      for (const reference of references) {
        add('D_VISIBLE_EXTERNAL_REFERENCE', isNegated(unit.text, reference.start) ? 'info' : 'review', unit, reference,
          '表面文字含网址、裸域名、联系方式或二维码提示；来源引用并不自动等于推广。',
          '人工区分必要来源与引流入口；仅文本扫描未访问链接，也未识别图片中的二维码。');
      }
      for (const claim of matches(CLAIM_SOURCE, unit.text)) {
        if ((related(claim, contextTargets) || /模型|价格/u.test(unit.text)) && !isNegated(unit.text, claim.start)) {
          add('E_UNVERIFIED_CLAIM', 'review', unit, claim,
            '出现绝对化利益、开放时间、模型版本或价格陈述；本地启发式未核实真实性，非事实真伪判定。',
            '依据可靠来源人工核对版本、日期、价格及适用范围，保留必要限定；不能承诺平台审核通过。');
        }
      }
    }
  }
  const summary = { block: 0, review: 0, info: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  return { schemaVersion: 1, kind: 'xiaohongshu-promotion-risk', heuristic: true,
    status: summary.block ? 'blocked' : summary.review ? 'needs_review' : 'clear',
    summary, findings, imageInspection: 'not-performed', guarantee: false };
}
