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

function detectLeadingConnector(text: string): NaturalLanguageUnit['connector'] | undefined {
  return CONNECTOR_PATTERNS.find((candidate) => candidate.pattern.test(text))?.connector;
}

/**
 * 把老人自然语言拆成“最小事实候选单元”：
 * - 句号/问号/感叹号/分号/逗号/换行均可作为边界；
 * - 保留原始分句文字，只去掉首尾空白；
 * - 识别但不删除“后来/然后/不过”等连接关系，供后续时间、状态层使用；
 * - 不做人物、时间、否定或症状推断。
 */
export function splitNaturalLanguageUnits(input: string): NaturalLanguageUnit[] {
  const rawUnits = input
    .replace(/[\u3000\t\r]+/g, ' ')
    .split(/[。！？!?；;，,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

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
