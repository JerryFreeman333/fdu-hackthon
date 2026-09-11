/**
 * 内置 Mock Vision Provider：仅用于测试与本地脱机演示。
 * 通过图片像素的"最低限度"特征区分 BP / 体重 / 报告：
 *   - 文件名 / 大小 / 像素颜色直方图 都不会被读取。
 *   - 这里采用一种"测试约定"：调用方在 context.kind 传入 kind 时，Mock 也尊重 kind。
 *     但即便 kind 不传，Mock 也会返回一个 unknown 的严格结构，便于测试错误分支。
 *
 * 设计目标：让 Real parser 的所有分支都能在本地无后端、无 API Key 的情况下被覆盖。
 */
import type { HealthVisionProvider, HealthVisionResult, VisionParseContext } from './ImageHealthParser';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneResult(result: HealthVisionResult): HealthVisionResult {
  return {
    kind: result.kind,
    measurements: result.measurements.map((item) => ({ ...item })),
    labResults: result.labResults.map((item) => ({
      ...item,
      referenceRange: item.referenceRange ? { ...item.referenceRange } : undefined,
    })),
    rawText: result.rawText,
    confidence: result.confidence,
  };
}

/**
 * 严格的固定输出集合：测试用例通过 context.imageMeta / context.kind 显式选择。
 * 不读取 Blob 字节，避免"假装 OCR"。
 */
export const MOCK_RESPONSES: Record<string, HealthVisionResult> = {
  bloodPressure: {
    kind: 'bloodPressure',
    measurements: [
      { metric: 'systolic', value: 148, unit: 'mmHg', confidence: 0.95 },
      { metric: 'diastolic', value: 88, unit: 'mmHg', confidence: 0.95 },
      { metric: 'restingHr', value: 76, unit: 'bpm', confidence: 0.7 },
    ],
    labResults: [],
    rawText: 'SYS 148\nDIA 88\nPULSE 76',
    confidence: 0.93,
  },
  weight: {
    kind: 'weight',
    measurements: [{ metric: 'weight', value: 63.4, unit: 'kg', confidence: 0.95 }],
    labResults: [],
    rawText: '63.4 kg',
    confidence: 0.95,
  },
  report: {
    kind: 'report',
    measurements: [],
    labResults: [
      { name: 'GLU', value: 5.6, unit: 'mmol/L', confidence: 0.9, referenceRange: { low: 3.9, high: 6.1 } },
      { name: 'LDL-C', value: 3.2, unit: 'mmol/L', confidence: 0.88 },
    ],
    rawText: 'GLU 5.6 mmol/L\nLDL-C 3.2 mmol/L',
    confidence: 0.88,
  },
};

export class MockVisionProvider implements HealthVisionProvider {
  readonly name = 'mock';

  /** 测试可注入：返回 malformed JSON 模拟 provider 异常。 */
  public malformedNext = false;
  /** 测试可注入：返回低 confidence 模拟 provider 模糊。 */
  public forceLowConfidence = false;
  /** 测试可注入：模拟 unknown image。 */
  public forceUnknown = false;
  /** 测试可注入：模拟缺少单位。 */
  public forceMissingUnit = false;
  /** 测试可注入：只返回血压收缩压一个数字。 */
  public systolicOnly = false;

  async analyzeImage(_image: Blob, context?: VisionParseContext): Promise<HealthVisionResult> {
    await delay(5);
    if (this.malformedNext) {
      // 故意抛错：模拟 provider 返回不可解析的内容。
      throw new SyntaxError('Unexpected token } in JSON at position 12');
    }
    const kind = context?.kind ?? 'unknown';
    if (this.forceUnknown || kind === 'unknown') {
      return {
        kind: 'unknown',
        measurements: [],
        labResults: [],
        rawText: '',
        confidence: 0.0,
      };
    }
    const template = MOCK_RESPONSES[kind];
    if (!template) {
      return { kind: 'unknown', measurements: [], labResults: [], rawText: '', confidence: 0.0 };
    }
    const result = cloneResult(template);
    if (this.forceLowConfidence) {
      result.confidence = Math.min(result.confidence, 0.4);
      for (const m of result.measurements) m.confidence = Math.min(m.confidence, 0.4);
    }
    if (this.forceMissingUnit && result.measurements[0]) {
      result.measurements[0].unit = '';
    }
    if (this.systolicOnly && result.kind === 'bloodPressure') {
      result.measurements = result.measurements.filter((m) => m.metric === 'systolic');
    }
    return result;
  }
}
