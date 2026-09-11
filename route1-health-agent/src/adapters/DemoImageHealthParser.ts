import type { ImageHealthParser, ImageParseContext, ParsedHealthData } from './ImageHealthParser';
import type { MetricKey } from '../types';

export type DemoImageKind = 'bloodPressure' | 'weight' | 'report';

/**
 * Demo fallback image parser.
 *
 * 设计意图：
 *   - 当 VITE_HEALTH_VISION_ENDPOINT 未配置时，App 自动切到这个 parser，
 *     老人/演示者仍能完成"拍照 → 写示例数据"的完整链路，便于讲产品故事。
 *   - 它**不读取**图像像素，也不假装 OCR。返回的固定示例值仅用于演示目的，
 *     并通过 metadata.demoParser: true 标记。
 *   - 真实视觉解析必须走 RealImageHealthParser + HealthVisionProvider。
 *
 * 隐私：
 *   - parser 不访问 image Blob 内容；
 *   - 调用方负责把 visibility 写入最终 HealthMeasurement。
 */
export class DemoImageHealthParser implements ImageHealthParser {
  async parse(_image: Blob, context?: ImageParseContext & { kind?: DemoImageKind }): Promise<ParsedHealthData> {
    const capturedAt = context?.capturedAt ?? new Date().toISOString();
    const kind = context?.kind ?? 'bloodPressure';
    const base = {
      source: 'photo' as const,
      confidence: 0.6,
      metadata: { demoParser: true, userConfirmedKind: kind },
    };

    const measurementFor = (metric: MetricKey, value: number, unit: string) => ({
      id: `demo-photo-${kind}-${metric}-${capturedAt}`,
      timestamp: capturedAt,
      metric,
      value,
      unit,
      source: base.source,
      confidence: base.confidence,
      metadata: base.metadata,
    });

    switch (kind) {
      case 'weight':
        return {
          measurements: [measurementFor('weight', 63.4, 'kg')],
          labResults: [],
          tags: [],
          rawText: '演示识别：体重 63.4 kg（示例数据，请人工确认）',
        };
      case 'report':
        return {
          measurements: [measurementFor('systolic', 148, 'mmHg'), measurementFor('diastolic', 88, 'mmHg')],
          labResults: [],
          tags: ['bpHigh' as const],
          rawText: '演示识别：收缩压 148 mmHg，舒张压 88 mmHg（示例数据，请人工确认）',
        };
      default:
        return {
          measurements: [measurementFor('systolic', 148, 'mmHg'), measurementFor('diastolic', 88, 'mmHg')],
          labResults: [],
          tags: ['bpHigh' as const],
          rawText: '演示识别：血压 148/88 mmHg（示例数据，请人工确认）',
        };
    }
  }
}

export const demoImageHealthParser = new DemoImageHealthParser();
