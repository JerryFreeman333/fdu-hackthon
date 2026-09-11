/** 从老人自然语言中提取少量可用于趋势计算的结构化数值。 */
import type { MetricKey } from '../types';

export interface ExtractedValue {
  metric: MetricKey;
  value: number;
  unit: string;
  sourceText: string;
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
  if (/^[零〇一二两三四五六七八九]{2}$/.test(input)) return DIGITS[input[0]] * 10 + DIGITS[input[1]];
  if (input in DIGITS) return DIGITS[input];

  let total = 0;
  let current = 0;
  let hasHundredOrThousand = false;
  for (const ch of input) {
    if (ch === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else if (ch === '百') {
      total += (current || 1) * 100;
      current = 0;
      hasHundredOrThousand = true;
    } else if (ch === '千') {
      total += (current || 1) * 1000;
      current = 0;
      hasHundredOrThousand = true;
    } else if (ch === '万') {
      total = (total + current) * 10000;
      current = 0;
      hasHundredOrThousand = true;
    } else if (ch in DIGITS) {
      current = DIGITS[ch];
    } else {
      return null;
    }
  }
  if (hasHundredOrThousand && current > 0 && !input.includes('十')) return total + current * 10;
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
      new RegExp(String.raw`(?:睡了|睡眠|睡觉).{0,6}?${RANGE}\s*(?:小时|个小时)`),
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
      // 血糖七 / 血糖7.2 / 血糖 12 / 血糖十二 / 血糖七点多
      new RegExp(
        String.raw`(?:血糖|空腹血糖|餐后血糖|glucose|GLUCOSE).{0,8}?${RANGE}\s*(?:mmol\/L|mg\/dL|毫摩尔|毫摩尔每升|毫克|mg)?`,
      ),
    ],
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

function isPlausible(metric: MetricKey, value: number): boolean {
  switch (metric) {
    case 'restingHr':
      return value >= 30 && value <= 220;
    case 'spo2':
      return value >= 50 && value <= 100;
    case 'bloodGlucose':
      // mmol/L 与 mg/dL 都能落在这个区间之内
      return value >= 1 && value <= 40;
    default:
      return true;
  }
}

export function extractHealthValues(text: string): ExtractedValue[] {
  const results: ExtractedValue[] = [...extractBloodPressure(text)];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = parseValue(match[1].replace(/\s/g, ''));
      if (Number.isFinite(value) && isPlausible(rule.metric, value)) {
        results.push({ metric: rule.metric, value, unit: rule.unit, sourceText: match[0] });
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
