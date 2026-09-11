/**
 * Route 1 自然语言核心层：只负责把老人原话拆成稳定、可独立判断的语言单元。
 *
 * 这一层刻意不判断人物、时间、否定、假设或安全等级。任何语义判断都必须发生在
 * StructuredClaim 阶段，避免“分句器”自己偷偷产生第二套事实。
 */

export interface NaturalLanguageUnit {
  text: string;
  index: number;
  connector?: 'later' | 'then' | 'however' | 'meanwhile' | 'also' | 'otherwise';
}

const CONNECTOR_PATTERNS: Array<{
  connector: NonNullable<NaturalLanguageUnit['connector']>;
  pattern: RegExp;
}> = [
  { connector: 'later', pattern: /^后来[，,]?/ },
  { connector: 'then', pattern: /^(?:然后|接着|之后)[，,]?/ },
  { connector: 'however', pattern: /^(?:但是|不过|只是)[，,]?/ },
  { connector: 'meanwhile', pattern: /^(?:同时|这时候|当时)[，,]?/ },
  { connector: 'also', pattern: /^(?:另外|此外|而且|再说)[，,]?/ },
  { connector: 'otherwise', pattern: /^(?:反而|否则)[，,]?/ },
];

const IMPLICIT_BOUNDARY = /(?:后来|然后|接着|但是|不过|只是|同时|这时候|当时|另外|此外|而且|再说|反而|否则)/g;
const NUMERIC_START = /^(?:\d|[零〇一二两三四五六七八九十百千万])/;
const BP_LABEL_CONTINUATION = /^(?:低压|舒张压)/;

function detectLeadingConnector(text: string): NaturalLanguageUnit['connector'] | undefined {
  return CONNECTOR_PATTERNS.find((candidate) => candidate.pattern.test(text))?.connector;
}

function splitImplicitBoundaries(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  IMPLICIT_BOUNDARY.lastIndex = 0;

  for (const match of text.matchAll(IMPLICIT_BOUNDARY)) {
    const index = match.index ?? -1;
    if (index <= start) continue;
    const before = text.slice(start, index).trim();
    if (!before) continue;
    parts.push(before);
    start = index;
  }

  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.length > 0 ? parts : [text];
}

function isNumericContinuation(input: string, delimiterIndex: number): boolean {
  const next = input.slice(delimiterIndex + 1).replace(/^\s+/, '');
  return NUMERIC_START.test(next) || BP_LABEL_CONTINUATION.test(next);
}

function splitPunctuationUnits(input: string): string[] {
  const normalized = input.replace(/[\u3000\t\r]+/g, ' ');
  const parts: string[] = [];
  let start = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const isHardBoundary = /[。！？!?；;\n]/.test(char);
    const isCommaBoundary = /[，,]/.test(char) && !isNumericContinuation(normalized, index);
    if (!isHardBoundary && !isCommaBoundary) continue;

    const part = normalized.slice(start, index).trim();
    if (part) parts.push(part);
    start = index + 1;
  }

  const tail = normalized.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * 把老人自然语言拆成“最小事实候选单元”：
 * - 句号/问号/感叹号/分号/换行均可作为边界；
 * - 对普通逗号做边界，但“150,90 / 一百五，九十 / 高压150,低压90”这类数值连接不得被拆开；
 * - 对没有标点的典型话语连接词再做一次保守切分；
 * - 保留原始分句文字，只去掉首尾空白；
 * - 识别但不删除“后来/然后/不过”等连接关系，供后续时间、状态层使用；
 * - 不做人物、时间、否定或症状推断。
 */
export function splitNaturalLanguageUnits(input: string): NaturalLanguageUnit[] {
  const punctuationUnits = splitPunctuationUnits(input);
  const rawUnits = punctuationUnits.flatMap((unit) => splitImplicitBoundaries(unit));

  return rawUnits.map((text, index) => {
    const connector = detectLeadingConnector(text);
    return {
      text,
      index,
      ...(connector ? { connector } : {}),
    };
  });
}

/** 仅供旧调用点过渡；不会创建第二套解析逻辑。 */
export function splitNaturalLanguageTexts(input: string): string[] {
  return splitNaturalLanguageUnits(input).map((unit) => unit.text);
}
