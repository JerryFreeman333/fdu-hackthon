/** 从老人自然语言中提取少量可用于趋势计算的结构化数值。 */
import type { MetricKey } from '../types';

export interface ExtractedValue {
  metric: MetricKey;
  value: number;
  unit: string;
  sourceText: string;
}

const SIMPLE_DIGIT = '零〇一二两三四五六七八九';
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|[${SIMPLE_DIGIT}十百千万]+)`;
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
  if (/^[零〇一二两三四五六七八九]{2}$/.test(input)) {
    return DIGITS[input[0]] * 10 + DIGITS[input[1]];
  }
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
  return parts.length > 1 ? (parts[0] + parts[1]) / 2 : (parseChineseNumber(raw) ?? Number.NaN);
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
    patterns: [new RegExp(String.raw`(?:静息心率|心率|脉搏).{0,6}?${RANGE}\s*(?:次(?:/分钟|每分钟)?|bpm)?`)],
  },
];

function extractBloodPressure(text: string): ExtractedValue[] {
  const highLow = text.match(new RegExp(String.raw`高压\s*(${NUMBER}).{0,4}?低压\s*(${NUMBER})`));
  const lowHigh = text.match(new RegExp(String.raw`低压\s*(${NUMBER}).{0,4}?高压\s*(${NUMBER})`));
  const pair = text.match(new RegExp(String.raw`(?:血压|高低压).{0,4}?(${NUMBER})\s*[/／,，、比\-至~]\s*(${NUMBER})`));
  const selected = highLow
    ? { systolic: highLow[1], diastolic: highLow[2], sourceText: highLow[0] }
    : lowHigh
      ? { systolic: lowHigh[2], diastolic: lowHigh[1], sourceText: lowHigh[0] }
      : pair
        ? { systolic: pair[1], diastolic: pair[2], sourceText: pair[0] }
        : null;
  if (!selected) return [];

  const systolic = parseChineseNumber(selected.systolic.replace(/\s/g, ''));
  const diastolic = parseChineseNumber(selected.diastolic.replace(/\s/g, ''));
  if (systolic === null || diastolic === null) return [];
  return [
    { metric: 'systolic', value: systolic, unit: 'mmHg', sourceText: selected.sourceText },
    { metric: 'diastolic', value: diastolic, unit: 'mmHg', sourceText: selected.sourceText },
  ];
}

export function extractHealthValues(text: string): ExtractedValue[] {
  const results: ExtractedValue[] = [...extractBloodPressure(text)];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = parseValue(match[1].replace(/\s/g, ''));
      if (Number.isFinite(value)) results.push({ metric: rule.metric, value, unit: rule.unit, sourceText: match[0] });
      break;
    }
  }
  return results;
}
