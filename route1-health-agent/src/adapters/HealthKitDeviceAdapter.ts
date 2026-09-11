import type { DeviceAdapter } from './DeviceAdapter';
import { METRICS, type HealthMeasurement, type MetricKey } from '../types';

const METRIC_KEYS = new Set<MetricKey>(Object.keys(METRICS) as MetricKey[]);

export interface HealthKitBridgeDiagnostics {
  authorizationStatus: 'not-requested' | 'request-completed' | 'limited-or-no-data' | 'unknown';
  receivedAt?: string;
  generatedAt?: string;
  sampleCount?: number;
  deviceName?: string;
}

export class HealthKitAdapterError extends Error {
  constructor(
    message: string,
    readonly code: 'unavailable' | 'network' | 'invalid-response' | 'no-samples',
  ) {
    super(message);
    this.name = 'HealthKitAdapterError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMeasurement(value: unknown, index: number): HealthMeasurement {
  if (!record(value)) throw new HealthKitAdapterError(`第 ${index + 1} 条数据不是对象`, 'invalid-response');
  const metric = value.metric;
  if (typeof metric !== 'string' || !METRIC_KEYS.has(metric as MetricKey)) {
    throw new HealthKitAdapterError(`第 ${index + 1} 条数据包含未知指标`, 'invalid-response');
  }
  const key = metric as MetricKey;
  if (value.source !== 'healthkit') {
    throw new HealthKitAdapterError(`第 ${index + 1} 条数据 source 不是 healthkit`, 'invalid-response');
  }
  if (typeof value.id !== 'string' || !value.id || typeof value.timestamp !== 'string' || Number.isNaN(Date.parse(value.timestamp))) {
    throw new HealthKitAdapterError(`第 ${index + 1} 条数据缺少有效 id/timestamp`, 'invalid-response');
  }
  if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
    throw new HealthKitAdapterError(`第 ${index + 1} 条数据 value 无效`, 'invalid-response');
  }
  if (value.unit !== METRICS[key].unit) {
    throw new HealthKitAdapterError(
      `第 ${index + 1} 条 ${key} 单位应为 ${METRICS[key].unit}，实际为 ${String(value.unit)}`,
      'invalid-response',
    );
  }
  const metadata = record(value.metadata)
    ? Object.fromEntries(
        Object.entries(value.metadata).filter((entry): entry is [string, string | number | boolean] =>
          ['string', 'number', 'boolean'].includes(typeof entry[1]),
        ),
      )
    : undefined;
  return {
    id: value.id,
    timestamp: new Date(value.timestamp).toISOString(),
    metric: key,
    value: value.value,
    unit: METRICS[key].unit,
    source: 'healthkit',
    confidence: typeof value.confidence === 'number' ? value.confidence : 1,
    visibility: value.visibility === 'family_ok' ? 'family_ok' : 'private',
    metadata,
  };
}

export class HealthKitDeviceAdapter implements DeviceAdapter {
  readonly source = 'healthkit' as const;
  lastDiagnostics?: HealthKitBridgeDiagnostics;

  constructor(private readonly endpoint: string) {}

  async getMeasurements(userId: string, from: string, to: string): Promise<HealthMeasurement[]> {
    let response: Response;
    try {
      const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
      const url = new URL(this.endpoint, origin);
      url.searchParams.set('userId', userId);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    } catch (error) {
      throw new HealthKitAdapterError(`无法连接 HealthKit 桥接服务：${error instanceof Error ? error.message : String(error)}`, 'network');
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new HealthKitAdapterError(`HealthKit 桥接服务返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`, response.status === 503 ? 'unavailable' : 'network');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new HealthKitAdapterError('HealthKit 桥接服务未返回有效 JSON', 'invalid-response');
    }
    const list = Array.isArray(payload) ? payload : record(payload) ? payload.measurements : null;
    if (!Array.isArray(list)) throw new HealthKitAdapterError('响应缺少 measurements 数组', 'invalid-response');
    if (record(payload) && record(payload.diagnostics)) {
      const status = payload.diagnostics.authorizationStatus;
      this.lastDiagnostics = {
        authorizationStatus:
          status === 'not-requested' || status === 'request-completed' || status === 'limited-or-no-data'
            ? status
            : 'unknown',
        receivedAt: typeof payload.diagnostics.receivedAt === 'string' ? payload.diagnostics.receivedAt : undefined,
        generatedAt: typeof payload.diagnostics.generatedAt === 'string' ? payload.diagnostics.generatedAt : undefined,
        sampleCount: typeof payload.diagnostics.sampleCount === 'number' ? payload.diagnostics.sampleCount : undefined,
        deviceName: typeof payload.diagnostics.deviceName === 'string' ? payload.diagnostics.deviceName : undefined,
      };
    }
    const measurements = list.map(normalizeMeasurement).filter((item) => item.timestamp.slice(0, 10) >= from && item.timestamp.slice(0, 10) <= to);
    if (measurements.length === 0) {
      throw new HealthKitAdapterError('桥接已连接，但所选日期内没有可读取的 HealthKit 样本；请检查 Apple 健康权限和数据时间范围。', 'no-samples');
    }
    return measurements;
  }
}
