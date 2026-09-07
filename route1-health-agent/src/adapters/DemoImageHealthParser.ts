import type { ImageHealthParser, ImageParseContext, ParsedHealthData } from './ImageHealthParser';
import type { MetricKey } from '../types';

export type DemoImageKind = 'bloodPressure' | 'weight' | 'report';

/**
 * Demo-only image parser. It intentionally does not inspect pixels or pretend to perform OCR.
 * The selected image kind maps to deterministic sample data so the ImageHealthParser seam is exercised end to end.
 * Privacy is assigned by the caller, not by the parser.
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
