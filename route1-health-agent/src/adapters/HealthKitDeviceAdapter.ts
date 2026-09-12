import type { DeviceAdapter } from './DeviceAdapter';
import { METRICS, type HealthMeasurement, type MetricKey } from '../types';

const METRIC_KEYS = new Set<MetricKey>(Object.keys(METRICS) as MetricKey[]);

export interface HealthKitBridgeDiagnostics {
  authorizationStatus: 'not-requested' | 'request-completed' | 'limited-or-no-data' | 'unknown';
  receivedAt?: string;
  generatedAt?: string;
  sampleCount?: number;
  deviceName?: string;
  freshness?: 'fresh' | 'stale' | 'unknown';
  ageMinutes?: number;
  maxAgeMinutes?: number;
}

export type HealthKitAdapterErrorCode =
  | 'unavailable'
  | 'network'
  | 'invalid-response'
  | 'no-samples'
  | 'stale'
  | 'user-mismatch'
  | 'unauthorized';

export class HealthKitAdapterError extends Error {
  constructor(
    message: string,
    readonly code: HealthKitAdapterErrorCode,
  ) {
    super(message);
    this.name = 'HealthKitAdapterError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diagnosticsFrom(value: unknown): HealthKitBridgeDiagnostics | undefined {
  if (!record(value)) return undefined;
  const status = value.authorizationStatus;
  const freshness = value.freshness;
  return {
    authorizationStatus:
      status === 'not-requested' || status === 'request-completed' || status === 'limited-or-no-data'
        ? status
        : 'unknown',
    receivedAt: typeof value.receivedAt === 'string' ? value.receivedAt : undefined,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : undefined,
    sampleCount: typeof value.sampleCount === 'number' ? value.sampleCount : undefined,
    deviceName: typeof value.deviceName === 'string' ? value.deviceName : undefined,
    freshness: freshness === 'fresh' || freshness === 'stale' ? freshness : 'unknown',
    ageMinutes: typeof value.ageMinutes === 'number' ? value.ageMinutes : undefined,
    maxAgeMinutes: typeof value.maxAgeMinutes === 'number' ? value.maxAgeMinutes : undefined,
  };
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
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.timestamp !== 'string' ||
    Number.isNaN(Date.parse(value.timestamp))
  ) {
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

  constructor(
    private readonly endpoint: string,
    private readonly bridgeToken = '',
  ) {}

  async getMeasurements(userId: string, from: string, to: string): Promise<HealthMeasurement[]> {
    this.lastDiagnostics = undefined;
    let response: Response;
    try {
      const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
      const url = new URL(this.endpoint, origin);
      url.searchParams.set('userId', userId);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.bridgeToken) headers['X-HealthKit-Bridge-Token'] = this.bridgeToken;
      response = await fetch(url, { headers, cache: 'no-store' });
    } catch (error) {
      throw new HealthKitAdapterError(
        `无法连接 HealthKit 桥接服务：${error instanceof Error ? error.message : String(error)}`,
        'network',
      );
    }
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      let errorPayload: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (record(parsed)) errorPayload = parsed;
      } catch {
        // 保留非 JSON 错误文本用于现场诊断。
      }
      this.lastDiagnostics = diagnosticsFrom(errorPayload?.diagnostics);
      const bridgeCode = errorPayload?.error;
      const bridgeMessage = typeof errorPayload?.message === 'string' ? errorPayload.message : raw;
      if (response.status === 401 || bridgeCode === 'unauthorized') {
        throw new HealthKitAdapterError('HealthKit bridge token 错误或缺失，请检查三端 token 配置。', 'unauthorized');
      }
      if (bridgeCode === 'user_mismatch') {
        throw new HealthKitAdapterError('当前桥接数据属于另一测试用户，请重新上传或检查测试用户 ID。', 'user-mismatch');
      }
      if (bridgeCode === 'stale_data') {
        throw new HealthKitAdapterError(
          `旧数据，不能用于本轮真实硬件验收。${bridgeMessage ? ` ${bridgeMessage}` : ''}`,
          'stale',
        );
      }
      if (response.status === 503 || bridgeCode === 'unavailable') {
        throw new HealthKitAdapterError(bridgeMessage || 'HealthKit 桥接服务当前不可用。', 'unavailable');
      }
      throw new HealthKitAdapterError(
        `HealthKit 桥接服务返回 HTTP ${response.status}${bridgeMessage ? `：${bridgeMessage}` : ''}`,
        'network',
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new HealthKitAdapterError('HealthKit 桥接服务未返回有效 JSON', 'invalid-response');
    }
    const list = Array.isArray(payload) ? payload : record(payload) ? payload.measurements : null;
    if (!Array.isArray(list)) throw new HealthKitAdapterError('响应缺少 measurements 数组', 'invalid-response');
    if (record(payload)) this.lastDiagnostics = diagnosticsFrom(payload.diagnostics);
    const measurements = list
      .map(normalizeMeasurement)
      .filter((item) => item.timestamp.slice(0, 10) >= from && item.timestamp.slice(0, 10) <= to);
    if (measurements.length === 0) {
      throw new HealthKitAdapterError(
        '桥接已连接，但所选日期内没有可读取的 HealthKit 样本；请检查 Apple 健康权限和数据时间范围。',
        'no-samples',
      );
    }
    return measurements;
  }
}
