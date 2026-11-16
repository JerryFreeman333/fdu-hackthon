/** 从老人自然语言中提取少量可用于趋势计算的结构化数值。 */
import type { MetricKey, TemperatureSite } from '../types';

export interface ExtractedValue {
  metric: MetricKey;
  value: number;
  unit: string;
  sourceText: string;
  /**
   * 仅体温使用：原文里明确说出的测量部位。
   * 缺失代表"原文没说"，下游按 unknown 处理——绝不在这里默认成腋温。
   */
  temperatureSite?: TemperatureSite;
}

const SIMPLE_DIGIT = '零〇一二两三四五六七八九';
// 模糊数字，包括口语里的「九十几 / 九十多 / 一百二十多 / 七点多」
const VAGUE = String.raw`(?:[${SIMPLE_DIGIT}]+十(?:[${SIMPLE_DIGIT}](?:几|多)|(?:几|多))|[${SIMPLE_DIGIT}]+点(?:几|多|零\d*))`;
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|${VAGUE}|[${SIMPLE_DIGIT}十百千万]+)`;
const RANGE = String.raw`(${NUMBER}(?:\s*(?:到|至|~|-)\s*${NUMBER})?)`;
const DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseChineseNumber(input: string): number | null {
  if (/^\d/.test(input)) return Number(input);
  // 口语约数："三四次 / 两三步 / 七八个"这类"升序相邻裸数字"是"约 N 个"，
  // 绝不是"三十四 / 二十三"——中文复合数必须带 十/百/千，裸数字只表达
  // 近似区间。升序对取两端平均，与"3到4次"的区间中位口径一致。
  // 其余裸数字串（降序/相同对如"血氧九二"、三位以上如"三四五"）不构成
  // 可信的精确数，返回 null 由调用方如实丢弃，绝不拼造精确值写进健康基线。
  if (/^[零〇一二两三四五六七八九]{2}$/.test(input) && DIGITS[input[0]] > 0 && DIGITS[input[0]] < DIGITS[input[1]]) {
    return (DIGITS[input[0]] + DIGITS[input[1]]) / 2;
  }
  if (/^[零〇一二两三四五六七八九]{2,}$/.test(input)) return null;
  if (input in DIGITS) return DIGITS[input];

  let total = 0;
  let current = 0;
  // 口语截断位：结尾数字补在最后一个 百/千/万 单位的下一位
  //（“一百二”=120、“一千五”=1500、“一万二”=12000）。
  let lastUnitMagnitude = 0;
  // “一百零五”里的“零”是个位补零：结尾数字已是真实数值，不能再按口语截断放大。
  let zeroAfterUnit = false;
  for (const ch of input) {
    if (ch === '十') {
      total += (current || 1) * 10;
      current = 0;
      lastUnitMagnitude = 0;
      zeroAfterUnit = false;
    } else if (ch === '百') {
      total += (current || 1) * 100;
      current = 0;
      lastUnitMagnitude = 100;
      zeroAfterUnit = false;
    } else if (ch === '千') {
      total += (current || 1) * 1000;
      current = 0;
      lastUnitMagnitude = 1000;
      zeroAfterUnit = false;
    } else if (ch === '万') {
      total = (total + current) * 10000;
      current = 0;
      lastUnitMagnitude = 10000;
      zeroAfterUnit = false;
    } else if (ch in DIGITS) {
      if (DIGITS[ch] === 0 && lastUnitMagnitude > 0) zeroAfterUnit = true;
      current = DIGITS[ch];
    } else {
      return null;
    }
  }
  if (lastUnitMagnitude > 0 && current > 0 && !zeroAfterUnit) {
    return total + current * (lastUnitMagnitude / 10);
  }
  return total + current;
}

function parseValue(raw: string): number {
  const parts = raw
    .split(/[到至~-]/)
    .map((part) => parseChineseNumber(part.trim()))
    .filter((value): value is number => value !== null);
  if (parts.length > 1) return (parts[0] + parts[1]) / 2;
  const direct = parseChineseNumber(raw);
  if (direct !== null) return direct;
  // 口语近似值。"X点多"/"X点几" → 取整数 + 0.5；"X点零几" → 取整数。
  const dotMatch = raw.match(
    /^([零〇一二两三四五六七八九十]+|十[零〇一二两三四五六七八九]+|\d+)点(几|多|零[\d零〇一二两三四五六七八九]+)?$/,
  );
  if (dotMatch) {
    const intPart = parseChineseNumber(dotMatch[1]);
    if (intPart !== null) {
      if (dotMatch[2] === '几' || dotMatch[2] === '多') return intPart + 0.5;
      return intPart;
    }
  }
  // "X十几"/"X十X多" → 假设中位为 5，例如 "九十几" = 95。
  const teenMatch = raw.match(/^([零〇一二两三四五六七八九]+|十?[零〇一二两三四五六七八九]+)十(几|多)$/);
  if (teenMatch) {
    const tens = parseChineseNumber(teenMatch[1] + '十');
    if (tens !== null) return tens + 5;
  }
  return Number.NaN;
}

interface Rule {
  metric: MetricKey;
  unit: string;
  patterns: RegExp[];
  /** 同一条读数可能以不同单位报出；统一换算到内部单位，避免 18 倍偏差。 */
  normalize?: (value: number, unit: string | undefined) => { value: number; unit: string };
}

const RULES: Rule[] = [
  {
    metric: 'nightWakes',
    unit: '次',
    patterns: [
      new RegExp(String.raw`(?:起夜|晚上|夜里|夜间).{0,12}?${RANGE}\s*(?:次|遍|趟)`),
      new RegExp(String.raw`${RANGE}\s*(?:次|遍|趟).{0,12}?(?:起夜|夜里|晚上|夜间)`),
    ],
  },
  {
    metric: 'steps',
    unit: '步',
    patterns: [
      new RegExp(String.raw`(?:走了|走|步数|今天).{0,8}?${RANGE}\s*(?:步|步数)`),
      new RegExp(String.raw`${RANGE}\s*(?:步|步数)`),
    ],
  },
  {
    metric: 'weight',
    unit: 'kg',
    patterns: [new RegExp(String.raw`(?:体重|重量).{0,6}?${RANGE}\s*(?:公斤|千克|kg|KG)`)],
  },
  {
    metric: 'sleepHours',
    unit: '小时',
    patterns: [
      // 口语既说“睡了三个小时”，也说“昨晚只睡三小时 / 才睡三小时”。
      new RegExp(String.raw`(?:睡了|睡眠|睡觉|睡).{0,6}?${RANGE}\s*(?:小时|个小时)`),
      new RegExp(String.raw`${RANGE}\s*(?:小时|个小时).{0,6}?(?:睡|睡眠)`),
    ],
  },
  {
    metric: 'restingHr',
    unit: 'bpm',
    patterns: [new RegExp(String.raw`(?:静息心率|心率|脉搏|心跳).{0,8}?${RANGE}\s*(?:次(?:/分钟|每分钟)?|bpm)?`)],
  },
  {
    metric: 'spo2',
    unit: '%',
    patterns: [
      // 血氧九十二 / 血氧 92 / spo2 95 / 我血氧掉到九十 / 血氧掉到九十几
      new RegExp(String.raw`(?:血氧|spo2|SPO2|SpO2|氧饱和度).{0,8}?${RANGE}\s*(?:%|％|个百分点)?`),
    ],
  },
  {
    metric: 'bloodGlucose',
    unit: 'mmol/L',
    patterns: [
      // 血糖七 / 血糖7.2 / 血糖 12 / 血糖十二 / 血糖七点多 / 血糖126 mg/dL
      new RegExp(
        String.raw`(?:血糖|空腹血糖|餐后血糖|glucose|GLUCOSE).{0,8}?${RANGE}\s*(mmol\/L|mg\/dL|毫摩尔每升|毫摩尔|毫克|mg)?`,
        'i',
      ),
    ],
    normalize(value, unit) {
      const measuredInMgDl = /mg\/dL|毫克|^mg$/i.test(unit ?? '') || (unit === undefined && value > 100);
      if (measuredInMgDl) {
        // mg/dL -> mmol/L 的常规换算系数；只做单位换算，不改变读数含义。
        return { value: Math.round((value / 18) * 10) / 10, unit: 'mmol/L' };
      }
      return { value, unit: 'mmol/L' };
    },
  },
];

function isPlausibleBloodPressure(systolic: number, diastolic: number): boolean {
  return systolic >= 70 && systolic <= 260 && diastolic >= 40 && diastolic <= 160 && systolic > diastolic;
}

function buildBloodPressure(systolicRaw: string, diastolicRaw: string, sourceText: string): ExtractedValue[] {
  const systolic = parseChineseNumber(systolicRaw.replace(/\s/g, ''));
  const diastolic = parseChineseNumber(diastolicRaw.replace(/\s/g, ''));
  if (systolic === null || diastolic === null || !isPlausibleBloodPressure(systolic, diastolic)) return [];
  return [
    { metric: 'systolic', value: systolic, unit: 'mmHg', sourceText },
    { metric: 'diastolic', value: diastolic, unit: 'mmHg', sourceText },
  ];
}

function buildPartialSystolic(raw: string, sourceText: string): ExtractedValue[] {
  const systolic = parseChineseNumber(raw.replace(/\s/g, ''));
  if (systolic === null || systolic < 70 || systolic > 260) return [];
  return [{ metric: 'systolic', value: systolic, unit: 'mmHg', sourceText }];
}

function extractBloodPressure(text: string): ExtractedValue[] {
  const results: ExtractedValue[] = [];
  let working = text;
  const safetyLimit = 5;
  for (let i = 0; i < safetyLimit; i += 1) {
    const sdl = working.match(new RegExp(String.raw`收缩压\s*(${NUMBER}).{0,4}?舒张压\s*(${NUMBER})`));
    const dsl = working.match(new RegExp(String.raw`舒张压\s*(${NUMBER}).{0,4}?收缩压\s*(${NUMBER})`));
    const hl = working.match(new RegExp(String.raw`高压\s*(${NUMBER}).{0,4}?低压\s*(${NUMBER})`));
    const lh = working.match(new RegExp(String.raw`低压\s*(${NUMBER}).{0,4}?高压\s*(${NUMBER})`));
    const pair = working.match(
      new RegExp(String.raw`(?:血压|高低压).{0,4}?(${NUMBER})\s*[/／,，、比\-至~]\s*(${NUMBER})`),
    );
    const fb = working.match(new RegExp(String.raw`(${NUMBER})\s*[/／,，、比]\s*(${NUMBER})`));
    let picked: { match: RegExpMatchArray; values: [string, string] } | null = null;
    if (sdl) picked = { match: sdl, values: [sdl[1], sdl[2]] };
    else if (dsl) picked = { match: dsl, values: [dsl[2], dsl[1]] };
    else if (hl) picked = { match: hl, values: [hl[1], hl[2]] };
    else if (lh) picked = { match: lh, values: [lh[2], lh[1]] };
    else if (pair) picked = { match: pair, values: [pair[1], pair[2]] };
    else if (fb) picked = { match: fb, values: [fb[1], fb[2]] };
    if (!picked) break;
    const built = buildBloodPressure(picked.values[0], picked.values[1], picked.match[0]);
    if (built.length > 0) results.push(...built);
    working = working.replace(picked.match[0], ' ');
  }
  const partialSystolic = working.match(
    new RegExp(String.raw`(?:收缩压|高压|血压)\s*(${NUMBER})(?!\s*[/／,，、比\-至~]\s*${NUMBER})`),
  );
  if (partialSystolic) results.push(...buildPartialSystolic(partialSystolic[1], partialSystolic[0]));
  return results;
}

const TEMPERATURE_CONTEXT =
  /(?:体温|体表温度|腋温|腋下|腋窝|口温|口腔|舌下|耳温|耳道|额温|额头|肛温|肛门|直肠|发烧|发热|高烧|低烧|烧到|烧了)/g;
const TEMPERATURE_NUMBER = String.raw`(\d{2,3}(?:\.\d+)?|[零〇一二两三四五六七八九十百]{2,4}(?:点[零〇一二两三四五六七八九]+)?)`;
const TEMPERATURE_NUMBER_PLAIN = String.raw`(?:\d{2,3}(?:\.\d+)?|[零〇一二两三四五六七八九十百]{2,4}(?:点[零〇一二两三四五六七八九]+)?)`;
const TEMPERATURE_UNIT = String.raw`(?:℃|°C|摄氏度|华氏度|℉|°F|F)`;

function isFahrenheitUnit(unit: string | undefined): boolean {
  return Boolean(unit && /^(?:华氏度|℉|°F|F)$/i.test(unit));
}

/**
 * 测量部位必须绑定到"这一条读数"，不能在整句里随便取一个关键词。
 * "腋温37.6，耳温38.4"是一条消息里的两个不同事实；把整句的部位套给所有
 * 读数，等于把耳温的高读数记成腋温、或把腋温的低读数记成耳温。
 */
const TEMPERATURE_SITE_PATTERNS: Array<{ site: TemperatureSite; pattern: RegExp }> = [
  { site: 'axillary', pattern: /腋(?:温|下|窝)/g },
  { site: 'oral', pattern: /(?:口温|口腔|舌下)/g },
  { site: 'ear', pattern: /(?:耳温|耳道)/g },
  { site: 'forehead', pattern: /(?:额温|额头)/g },
  { site: 'rectal', pattern: /(?:肛温|肛门|直肠)/g },
];

interface SiteMention {
  site: TemperatureSite;
  start: number;
  end: number;
}

function collectSiteMentions(text: string): SiteMention[] {
  const mentions: SiteMention[] = [];
  for (const { site, pattern } of TEMPERATURE_SITE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      mentions.push({ site, start: match.index, end: match.index + match[0].length });
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

/** 部位词与读数的最大允许距离（字符）。跨分句的"腋温"不应该管到下一个读数。 */
const TEMPERATURE_SITE_MAX_DISTANCE = 10;

function detectTemperatureSite(mentions: SiteMention[], numberStart: number, numberEnd: number): TemperatureSite {
  if (mentions.length === 0) return 'unknown';
  let best: { site: TemperatureSite; gap: number; before: boolean } | null = null;
  for (const mention of mentions) {
    // 读数前后的部位词都算："腋温38.2" 与 "38.2（腋温）"。
    const before = mention.end <= numberStart;
    const after = mention.start >= numberEnd;
    if (!before && !after) continue;
    const gap = before ? numberStart - mention.end : mention.start - numberEnd;
    if (gap > TEMPERATURE_SITE_MAX_DISTANCE) continue;
    if (!best || gap < best.gap || (gap === best.gap && before && !best.before)) {
      best = { site: mention.site, gap, before };
    }
  }
  if (best) return best.site;
  // 只有一种部位、且只有一条读数时，允许"腋下量了，38.2"这种跨了十几个字的表达。
  const distinctSites = new Set(mentions.map((mention) => mention.site));
  if (distinctSites.size === 1) return mentions[0]!.site;
  return 'unknown';
}

/**
 * 体温抽取只接受“体温/发热语境”或明确温度单位：
 * - 裸数字（"38.5"）不猜成体温；
 * - 华氏度必须显式写 °F/℉/华氏度，才做换算；
 * - 换算后或摄氏读数超出 34.0–43.0 ℃ 一律丢弃，避免把步数/血糖等数字误记成体温。
 * 这些阈值是产品安全分流边界，不是诊断标准。
 */
function extractTemperature(text: string): ExtractedValue[] {
  const candidates: Array<{
    index: number;
    value: number;
    sourceText: string;
    site: TemperatureSite;
  }> = [];
  const seen = new Set<number>();
  const siteMentions = collectSiteMentions(text);

  const pushCandidate = (
    index: number,
    rawNumber: string,
    unit: string | undefined,
    trailingTenth: string | undefined,
    sourceText: string,
  ): void => {
    if (seen.has(index)) return;
    const parsed = parseChineseNumber(rawNumber.replace(/\s/g, ''));
    if (parsed === null) return;
    let value = parsed;
    if (trailingTenth !== undefined) {
      const tenth = parseChineseNumber(trailingTenth);
      if (tenth === null || tenth < 0 || tenth > 9) return;
      value += tenth / 10;
    }
    if (isFahrenheitUnit(unit)) value = ((value - 32) * 5) / 9;
    value = Math.round(value * 10) / 10;
    if (value < 34 || value > 43) return;
    seen.add(index);
    const numberStart = index;
    const numberEnd = index + rawNumber.replace(/\s/g, '').length;
    candidates.push({
      index,
      value,
      sourceText,
      site: detectTemperatureSite(siteMentions, numberStart, numberEnd),
    });
  };

  // 明确单位：38.5℃ / 101°F / 101华氏度。显式单位本身就是温度语境，不要求再出现“发烧”。
  const explicitUnit = new RegExp(String.raw`${TEMPERATURE_NUMBER}\s*(${TEMPERATURE_UNIT})`, 'gi');
  let explicitMatch: RegExpExecArray | null;
  while ((explicitMatch = explicitUnit.exec(text)) !== null) {
    pushCandidate(explicitMatch.index, explicitMatch[1], explicitMatch[2], undefined, explicitMatch[0]);
  }

  // 华氏度前缀：华氏101度。
  const fahrenheitPrefix = new RegExp(String.raw`华氏\s*${TEMPERATURE_NUMBER}\s*(?:度|℉|°F|F)?`, 'gi');
  let fahrenheitMatch: RegExpExecArray | null;
  while ((fahrenheitMatch = fahrenheitPrefix.exec(text)) !== null) {
    // 读数本身在“华氏”之后，部位判定要用数字的真实起点，不能用整段前缀的起点。
    const numberOffset = fahrenheitMatch[0].indexOf(fahrenheitMatch[1]);
    pushCandidate(
      fahrenheitMatch.index + Math.max(0, numberOffset),
      fahrenheitMatch[1],
      '华氏度',
      undefined,
      fahrenheitMatch[0],
    );
  }

  // 口语“38度5”：只有带小数位的“度”才允许脱离发烧语境；
  // 单独的“今天38度”仍按天气/其他数字处理，避免误记成体温。
  const decimalDegree = /(\d{2})度\s*([0-9零〇一二两三四五六七八九])/g;
  let decimalMatch: RegExpExecArray | null;
  while ((decimalMatch = decimalDegree.exec(text)) !== null) {
    pushCandidate(decimalMatch.index, decimalMatch[1], '摄氏度', decimalMatch[2], decimalMatch[0]);
  }
  const chineseDecimalDegree = new RegExp(
    String.raw`([零〇一二两三四五六七八九十百]{2,4})度\s*([零〇一二两三四五六七八九])`,
    'g',
  );
  let chineseDecimalMatch: RegExpExecArray | null;
  while ((chineseDecimalMatch = chineseDecimalDegree.exec(text)) !== null) {
    pushCandidate(
      chineseDecimalMatch.index,
      chineseDecimalMatch[1],
      '摄氏度',
      chineseDecimalMatch[2],
      chineseDecimalMatch[0],
    );
  }

  // 发烧/体温语境：在关键词后的短窗口里找第一个落在合理范围内的读数。
  // 窗口内先出现的数字可能不是体温（"发烧10天，38度"），因此逐个检查而不是只取第一个。
  TEMPERATURE_CONTEXT.lastIndex = 0;
  let contextMatch: RegExpExecArray | null;
  while ((contextMatch = TEMPERATURE_CONTEXT.exec(text)) !== null) {
    const windowStart = contextMatch.index + contextMatch[0].length;
    const window = text.slice(windowStart, windowStart + 16);
    const numberPattern = new RegExp(TEMPERATURE_NUMBER_PLAIN, 'g');
    let numberMatch: RegExpExecArray | null;
    while ((numberMatch = numberPattern.exec(window)) !== null) {
      const after = window.slice(numberMatch.index + numberMatch[0].length);
      const reading = after.match(
        new RegExp(String.raw`^\s*(?:(?:(${TEMPERATURE_UNIT}))|(?:度)\s*([0-9零〇一二两三四五六七八九])?)?`, 'i'),
      );
      const index = windowStart + numberMatch.index;
      pushCandidate(
        index,
        numberMatch[0],
        reading?.[1],
        reading?.[2],
        text.slice(
          contextMatch.index,
          windowStart + numberMatch.index + numberMatch[0].length + (reading?.[0].length ?? 0),
        ),
      );
      if (seen.has(index)) break;
    }
  }

  return candidates
    .sort((a, b) => a.index - b.index)
    .map((candidate) => ({
      metric: 'temperature' as const,
      value: candidate.value,
      unit: '℃',
      sourceText: candidate.sourceText,
      temperatureSite: candidate.site,
    }));
}

function isPlausible(metric: MetricKey, value: number): boolean {
  switch (metric) {
    case 'steps':
      // “走两步就喘”是活动耐量描述，不是计步读数。低于 50 的“步数”
      // 对个人基线没有统计意义，却足以把基线拉到接近 0 并制造假告警。
      return value >= 50 && value <= 100000;
    case 'nightWakes':
      return value >= 0 && value <= 20;
    case 'sleepHours':
      return value >= 0 && value <= 24;
    case 'weight':
      return value >= 20 && value <= 300;
    case 'restingHr':
      return value >= 30 && value <= 220;
    case 'spo2':
      return value >= 50 && value <= 100;
    case 'bloodGlucose':
      // 归一化后统一是 mmol/L；极端值仍拒绝，避免把 126（未换算）之类
      // 数字直接写进血糖基线。
      return value >= 1 && value <= 40;
    default:
      return true;
  }
}

export function extractHealthValues(text: string): ExtractedValue[] {
  const results: ExtractedValue[] = [...extractBloodPressure(text), ...extractTemperature(text)];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const rawValue = parseValue(match[1].replace(/\s/g, ''));
      if (!Number.isFinite(rawValue)) break;
      const normalized = rule.normalize?.(rawValue, match[2]) ?? { value: rawValue, unit: rule.unit };
      if (isPlausible(rule.metric, normalized.value)) {
        results.push({
          metric: rule.metric,
          value: normalized.value,
          unit: normalized.unit,
          sourceText: match[0],
        });
      }
      break;
    }
  }
  return results;
}

/** Legacy black-box API: expose only BP measurements from the unified extractor. */
export function extractBloodPressureValues(text: string): ExtractedValue[] {
  return extractHealthValues(text).filter((value) => value.metric === 'systolic' || value.metric === 'diastolic');
}
