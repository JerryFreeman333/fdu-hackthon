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
  const normalized = input.replace(/\s/g, '');
  if (!normalized) return null;
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  if (/^[零〇一二两三四五六七八九]$/.test(normalized)) return DIGITS[normalized];

  // 老人口语中“一百五”通常表示 150，“二百三”表示 230，而不是 105/203。
  const abbreviatedHundreds = normalized.match(
    /^([一二两三四五六七八九])百([零〇]?)([一二两三四五六七八九])$/,
  );
  if (abbreviatedHundreds) {
    return DIGITS[abbreviatedHundreds[1]] * 100 + DIGITS[abbreviatedHundreds[3]] * 10;
  }
  const abbreviatedThousands = normalized.match(
    /^([一二两三四五六七八九])千([零〇]?)([一二两三四五六七八九])$/,
  );
  if (abbreviatedThousands) {
    return DIGITS[abbreviatedThousands[1]] * 1000 + DIGITS[abbreviatedThousands[3]] * 100;
  }

  let total = 0;
  let current = 0;
  for (const ch of normalized) {
    if (ch === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else if (ch === '百') {
      total += (current || 1) * 100;
      current = 0;
    } else if (ch === '千') {
      total += (current || 1) * 1000;
      current = 0;
    } else if (ch === '万') {
      total = (total + current) * 10000;
      current = 0;
    } else if (ch in DIGITS) {
      current = DIGITS[ch];
    } else {
      return null;
    }
  }
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
    patterns: [
      new RegExp(String.raw`(?:静息心率|心率|脉搏).{0,6}?${RANGE}\s*(?:次(?:/分钟|每分钟)?|bpm)?`),
    ],
  },
];

interface BloodPressureParts {
  systolic?: { value: number; sourceText: string };
  diastolic?: { value: number; sourceText: string };
}

function parseBloodPressureNumber(raw: string): number | null {
  return parseChineseNumber(raw.replace(/\s/g, ''));
}

function parseBloodPressure(text: string): BloodPressureParts | null {
  // 完整双值：血压 150/90、150，90、150比90、150-90，以及“高压150低压90”。
  const bloodPressurePairPatterns: Array<{ pattern: RegExp; lowFirst?: boolean }> = [
    {
      pattern: new RegExp(
        String.raw`(?:血压)\s*(${NUMBER})\s*(?:[/／,，、:：比和及-~])\s*(${NUMBER})`,
      ),
    },
    {
      pattern: new RegExp(String.raw`(?:血压)\s*(${NUMBER})\s+(${NUMBER})`),
    },
    {
      pattern: new RegExp(
        String.raw`(?:高压|收缩压|上压)\s*(${NUMBER})\s*(?:[,，、:：/／\s比和及\-~])*\s*(?:低压|舒张压|下压)\s*(${NUMBER})`,
      ),
    },
    {
      pattern: new RegExp(
        String.raw`(?:低压|舒张压|下压)\s*(${NUMBER})\s*(?:[,，、:：/／\s比和及\-~])*\s*(?:高压|收缩压|上压)\s*(${NUMBER})`,
      ),
      lowFirst: true,
    },
  ];

  for (const { pattern, lowFirst } of bloodPressurePairPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const first = parseBloodPressureNumber(match[1]);
    const second = parseBloodPressureNumber(match[2]);
    if (first === null || second === null) continue;
    const sourceText = match[0];
    return lowFirst
      ? { systolic: { value: second, sourceText }, diastolic: { value: first, sourceText } }
      : { systolic: { value: first, sourceText }, diastolic: { value: second, sourceText } };
  }

  // 单值也必须保留下来：血压计常先报高压，丢掉它会绕过 >180 的安全红线。
  const systolicOnlyPatterns = [
    new RegExp(String.raw`(?:高压|收缩压|上压)\s*(${NUMBER})`),
    new RegExp(String.raw`(?:血压)\s*(${NUMBER})`),
  ];
  for (const pattern of systolicOnlyPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = parseBloodPressureNumber(match[1]);
    if (value !== null) return { systolic: { value, sourceText: match[0] } };
  }

  return null;
}

export function extractBloodPressureValues(text: string): ExtractedValue[] {
  const parts = parseBloodPressure(text);
  if (!parts) return [];
  const values: ExtractedValue[] = [];
  if (parts.systolic) {
    values.push({
      metric: 'systolic',
      value: parts.systolic.value,
      unit: 'mmHg',
      sourceText: parts.systolic.sourceText,
    });
  }
  if (parts.diastolic) {
    values.push({
      metric: 'diastolic',
      value: parts.diastolic.value,
      unit: 'mmHg',
      sourceText: parts.diastolic.sourceText,
    });
  }
  return values;
}

export function extractHealthValues(text: string): ExtractedValue[] {
  const results: ExtractedValue[] = [...extractBloodPressureValues(text)];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = parseValue(match[1].replace(/\s/g, ''));
      if (Number.isFinite(value)) {
        results.push({ metric: rule.metric, value, unit: rule.unit, sourceText: match[0] });
      }
      break;
    }
  }
  return results;
}
