import type { ImageHealthParser, ImageParseContext, ParsedHealthData } from './ImageHealthParser';
import { METRICS, type HealthMeasurement, type MetricKey } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class HttpImageHealthParser implements ImageHealthParser {
  constructor(private readonly endpoint: string) {}

  async parse(image: Blob, context: ImageParseContext = {}): Promise<ParsedHealthData> {
    const form = new FormData();
    form.append('image', image, 'health-image.jpg');
    form.append('context', JSON.stringify(context));
    const response = await fetch(this.endpoint, { method: 'POST', body: form });
    if (!response.ok) throw new Error(`真实 Vision 服务返回 HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.measurements)) throw new Error('真实 Vision 响应缺少 measurements[]');
    const measurements: HealthMeasurement[] = payload.measurements.map((value, index) => {
      if (!isRecord(value) || typeof value.metric !== 'string' || !(value.metric in METRICS)) {
        throw new Error(`真实 Vision 第 ${index + 1} 条指标无效`);
      }
      const metric = value.metric as MetricKey;
      if (typeof value.value !== 'number' || !Number.isFinite(value.value)) throw new Error(`真实 Vision 第 ${index + 1} 条数值无效`);
      return {
        id: typeof value.id === 'string' ? value.id : `vision-${metric}-${context.capturedAt ?? new Date().toISOString()}`,
        timestamp: typeof value.timestamp === 'string' ? value.timestamp : (context.capturedAt ?? new Date().toISOString()),
        metric,
        value: value.value,
        unit: METRICS[metric].unit,
        source: 'photo',
        confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
        metadata: { parserMode: 'real-http' },
      };
    });
    return { measurements, labResults: [], tags: [], rawText: typeof payload.rawText === 'string' ? payload.rawText : undefined };
  }
}
