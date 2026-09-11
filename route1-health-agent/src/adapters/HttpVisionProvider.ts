/**
 * HTTP Vision Provider：通过服务端代理调用视觉模型。
 *
 * 重要：浏览器端永远不保存 OpenAI / Claude / Gemini 等供应商 API Key。
 * 真实 key 必须放在服务端，前端只调用本仓库提供的 endpoint。
 *
 * 请求协议：
 *   POST {endpoint}
 *   multipart/form-data:
 *     - image: 文件
 *     - kind: bloodPressure | weight | report
 *     - meta:  JSON 字符串（capturedAt、userId 等元数据）
 *
 * 响应协议（严格 JSON）：
 *   { kind, measurements: [...], labResults: [...], rawText?, confidence }
 *
 * 任何返回非 JSON / 缺字段 / 字段类型不对 的情况都会抛 ImageParserError。
 */
import type {
  HealthVisionProvider,
  HealthVisionResult,
  VisionParseContext,
  VisionKind,
  VisionMeasurement,
  VisionLabResult,
} from './ImageHealthParser';
import { ImageParserError } from './ImageHealthParser';

export interface HttpVisionProviderOptions {
  endpoint: string;
  /** 浏览器端带过去的额外头，例如内部鉴权 token；不能用于携带模型 API Key。 */
  headers?: Record<string, string>;
  /** 网络超时（毫秒）。 */
  timeoutMs?: number;
  /** 自定义 fetch，便于测试；默认为 globalThis.fetch。 */
  fetchImpl?: typeof fetch;
}

function isVisionKind(value: unknown): value is VisionKind {
  return value === 'bloodPressure' || value === 'weight' || value === 'report' || value === 'unknown';
}

function sanitizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseMeasurement(raw: unknown): VisionMeasurement | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const value = sanitizeNumber(obj.value);
  const metric = typeof obj.metric === 'string' ? obj.metric.trim() : '';
  const unit = typeof obj.unit === 'string' ? obj.unit.trim() : '';
  const confidence = sanitizeNumber(obj.confidence);
  if (!metric || value === null || confidence === null) return null;
  return { metric, value, unit, confidence: Math.max(0, Math.min(1, confidence)) };
}

function parseLabResult(raw: unknown): VisionLabResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const value = sanitizeNumber(obj.value);
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const unit = typeof obj.unit === 'string' ? obj.unit.trim() : '';
  const confidence = sanitizeNumber(obj.confidence);
  if (!name || value === null || confidence === null) return null;
  let referenceRange: { low?: number; high?: number } | undefined;
  if (obj.referenceRange && typeof obj.referenceRange === 'object') {
    const rangeObj = obj.referenceRange as Record<string, unknown>;
    const low = sanitizeNumber(rangeObj.low);
    const high = sanitizeNumber(rangeObj.high);
    referenceRange = {
      ...(low !== null ? { low } : {}),
      ...(high !== null ? { high } : {}),
    };
    if (!referenceRange.low && !referenceRange.high) referenceRange = undefined;
  }
  return { name, value, unit, confidence: Math.max(0, Math.min(1, confidence)), referenceRange };
}

function parseProviderResponse(payload: unknown): HealthVisionResult {
  if (!payload || typeof payload !== 'object') {
    throw new ImageParserError('malformed_json', 'Vision provider returned non-object payload');
  }
  const obj = payload as Record<string, unknown>;
  if (!isVisionKind(obj.kind)) {
    throw new ImageParserError('malformed_json', 'Vision provider response missing/invalid kind');
  }
  const measurementsRaw = Array.isArray(obj.measurements) ? obj.measurements : [];
  const labResultsRaw = Array.isArray(obj.labResults) ? obj.labResults : [];
  const measurements = measurementsRaw.map(parseMeasurement).filter((item): item is VisionMeasurement => item !== null);
  const labResults = labResultsRaw.map(parseLabResult).filter((item): item is VisionLabResult => item !== null);
  const confidenceNum = sanitizeNumber(obj.confidence);
  const result: HealthVisionResult = {
    kind: obj.kind,
    measurements,
    labResults,
    confidence: confidenceNum === null ? 0 : Math.max(0, Math.min(1, confidenceNum)),
  };
  if (typeof obj.rawText === 'string') result.rawText = obj.rawText;
  return result;
}

export class HttpVisionProvider implements HealthVisionProvider {
  readonly name = 'http-proxy';
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpVisionProviderOptions) {
    if (!options.endpoint || !/^https?:\/\//i.test(options.endpoint)) {
      throw new Error('HttpVisionProvider: endpoint must be an absolute http(s) URL');
    }
    this.endpoint = options.endpoint;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async analyzeImage(image: Blob, context?: VisionParseContext): Promise<HealthVisionResult> {
    const form = new FormData();
    const filename = (image as File).name ?? 'capture.jpg';
    const safeName = /^[a-zA-Z0-9._-]+$/.test(filename) ? filename : 'capture.jpg';
    form.append('image', image, safeName);
    if (context?.kind) form.append('kind', context.kind);
    const meta = {
      capturedAt: context?.capturedAt,
      imageMeta: context?.imageMeta,
    };
    form.append('meta', JSON.stringify(meta));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        body: form,
        headers: this.headers,
        signal: controller.signal,
      });
    } catch (error) {
      throw new ImageParserError('provider_error', `Vision provider request failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ImageParserError('provider_error', `Vision provider responded with status ${response.status}`);
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ImageParserError('malformed_json', 'Vision provider returned non-JSON body');
    }
    return parseProviderResponse(payload);
  }
}
