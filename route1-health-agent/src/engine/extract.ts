import type { HealthMetric, SymptomTag } from '../types';

export interface ExtractedValue {
  metric: HealthMetric;
  value: number;
  unit: string;
  sourceText: string;
}

const NUMBER = String.raw`(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)`;
const RANGE = String.raw`(?:\d+(?:\.\d+)?)`;

function chineseDigitValue(char: string): number | null {
  const digits: Record<string, number> = {
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
  return digits[char] ?? null;
}

function parseChineseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);

  if (!/[零〇一二两三四五六七八九十百千万]/.test(text)) return null;

  const chars = [...text];
  let total = 0;
  let section = 0;
  let number = 0;
  let lastUnit = 1;

  const unitMap: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

  for (const char of chars) {
    const digit = chineseDigitValue(char);
    if (digit !== null) {
      number = number * 10 + digit;
      continue;
    }

    const unit = unitMap[char];
    if (!unit) return null;

    if (unit === 10000) {
      section += number;
      total += section * unit;
      section = 0;
      number = 0;
      lastUnit = unit;
      continue;
    }

    const normalized = number === 0 ? (lastUnit > unit ? 0 : 1) : number;
    section += normalized * unit;
    number = 0;
    lastUnit = unit;
  }

  const result = total + section + number;
  return Number.isFinite(result) ? result : null;
}

interface MetricPattern {
  metric: HealthMetric;
  unit: string;
  patterns: RegExp[];
}

const METRIC_PATTERNS: MetricPattern[] = [
  {
    metric: 'systolicBp',
    unit: 'mmHg',
    patterns: [
      new RegExp(String.raw`(?:收缩压|高压|上压)\s*(${RANGE})`),
      new RegExp(String.raw`(?:收缩压|高压|上压)(?:大约|差不多|约)?\s*(${NUMBER})`),
    ],
  },
  {
    metric: 'diastolicBp',
    unit: 'mmHg',
    patterns: [new RegExp(String.raw`(?:舒张压|低压|下压)\s*(${RANGE})`)],
  },
  {
    metric: 'spo2',
    unit: '%',
    patterns: [new RegExp(String.raw`(?:血氧|血氧饱和度|指尖血氧|氧饱和度)\s*(${RANGE})\s*%?`)],
  },
  {
    metric: 'temperature',
    unit: '°C',
    patterns: [new RegExp(String.raw`(?:体温|温度)\s*(${RANGE})\s*(?:°\s*C|℃|度)?`)],
  },
  {
    metric: 'glucose',
    unit: 'mmol/L',
    patterns: [new RegExp(String.raw`(?:血糖|血糖值)\s*(${RANGE})\s*(?:mmol/L)?`)],
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
      pattern: new RegExp(String.raw`(?:血压)\s*(${NUMBER})\s*(?:[/／,，、:：比和及\-~])\s*(${NUMBER})`),
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
      metric: 'systolicBp',
      value: parts.systolic.value,
      unit: 'mmHg',
      sourceText: parts.systolic.sourceText,
    });
  }
  if (parts.diastolic) {
    values.push({
      metric: 'diastolicBp',
      value: parts.diastolic.value,
      unit: 'mmHg',
      sourceText: parts.diastolic.sourceText,
    });
  }
  return values;
}

export function extractHealthValues(text: string): ExtractedValue[] {
  const bloodPressureValues = extractBloodPressureValues(text);
  const values = [...bloodPressureValues];

  for (const { metric, unit, patterns } of METRIC_PATTERNS) {
    if (metric === 'systolicBp' || metric === 'diastolicBp') continue;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = parseChineseNumber(match[1]);
      if (value === null) continue;
      values.push({ metric, value, unit, sourceText: match[0] });
      break;
    }
  }
  return values;
}

export function extractSymptomTags(text: string): SymptomTag[] {
  const tags: SymptomTag[] = [];
  const checks: Array<[SymptomTag, RegExp]> = [
    ['chestPain', /胸痛|胸口痛|胸口疼|胸部疼/],
    ['dyspnea', /喘不上气|喘不过气|气短|呼吸困难|呼吸不畅|胸闷气短|喘/],
    ['dizziness', /头晕|眩晕|晕乎乎/],
    ['fall', /摔倒|摔了一跤|跌倒|跌了一跤|滑倒/],
    ['edema', /水肿|浮肿|脚肿|腿肿|眼皮肿/],
    ['nocturia', /夜尿|起夜|晚上尿多/],
    ['poorSleep', /睡不好|睡不着|失眠|睡眠差/],
    ['medicationMissed', /没吃药|漏服|忘记吃药|忘了吃药|没按时吃药/],
  ];
  for (const [tag, pattern] of checks) {
    if (pattern.test(text)) tags.push(tag);
  }
  return tags;
}
