/**
 * 影像/OCR 统一接口。
 * 当前 DemoImageHealthParser 不读取真实图片；未来接 OCR/Vision 后保持相同返回结构。
 *
 * 架构：
 *   File / Camera
 *     ↓
 *   RealImageHealthParser  (本文件)
 *     ↓
 *   HealthVisionProvider   (可替换的 provider 抽象，详见下方接口)
 *     ↓
 *   严格结构化结果
 *     ↓
 *   validation / normalization
 *     ↓
 *   用户确认
 *     ↓
 *   HealthMeasurement / LabResult
 *     ↓
 *   现有 HealthEvent pipeline
 *
 * Detection、Person Twin、Agent 只依赖 ImageHealthParser 接口；
 * 它们不会知道也不应该知道具体的视觉模型供应商。
 */
import type { HealthMeasurement, LabResult, MetricKey, SymptomTag } from '../types';

/** Parser 上下文：只承载元数据，不携带 API Key。 */
export type ImageParseContext = {
  userId?: string;
  capturedAt?: string;
  kind?: 'bloodPressure' | 'weight' | 'report';
};

/** Provider 上下文：补充 provider 需要的非敏感元数据。 */
export type VisionParseContext = ImageParseContext & {
  /** 用于 prompt 工程的额外描述，例如图片大致尺寸/类型，由 Parser 计算后注入。 */
  imageMeta?: string;
};

/** Provider 原始返回结构：严格 JSON，不含自然语言。 */
export type VisionKind = 'bloodPressure' | 'weight' | 'report' | 'unknown';

export interface VisionMeasurement {
  metric: string;
  value: number;
  unit: string;
  confidence: number;
}

export interface VisionLabResult {
  name: string;
  value: number;
  unit: string;
  confidence: number;
  referenceRange?: { low?: number; high?: number };
}

export interface HealthVisionResult {
  kind: VisionKind;
  measurements: VisionMeasurement[];
  labResults: VisionLabResult[];
  rawText?: string;
  /** 0~1，provider 整图识别置信度；与单条 confidence 分开。 */
  confidence: number;
}

/**
 * Provider 接口：可替换。浏览器端永远不保存模型 API Key，
 * 真实实现必须走后端代理 endpoint（例如 /api/health/image-parse）。
 */
export interface HealthVisionProvider {
  /** Provider 名称（用于日志、UI 标注，不包含 key）。 */
  readonly name: string;
  analyzeImage(image: Blob, context?: VisionParseContext): Promise<HealthVisionResult>;
}

/**
 * 解析结果：经过 validation/normalize 后的最终对外结构。
 * 与 HealthEvent pipeline 对接的形态保持向后兼容。
 */
export interface ParsedHealthData {
  measurements: HealthMeasurement[];
  labResults: LabResult[];
  tags: SymptomTag[];
  rawText?: string;
  /**
   * 解析后的可选元数据：provider 名、整体 confidence、是否需要用户确认等。
   * 不会进入 HealthEvent 持久层（pipeline 会过滤掉）。
   */
  parseMeta?: {
    provider: string;
    overallConfidence: number;
    needsConfirmation: boolean;
    detectedKind: VisionKind;
    warnings: string[];
  };
}

/** 图像解析失败原因（用于 UI 提示与日志，不展示 raw 图片内容）。 */
export type ImageParseError =
  | 'empty_image'
  | 'unsupported_format'
  | 'image_unreadable'
  | 'missing_values'
  | 'missing_unit'
  | 'low_confidence'
  | 'malformed_json'
  | 'unknown_image'
  | 'invalid_blood_pressure'
  | 'invalid_weight'
  | 'provider_error'
  | 'aborted';

export class ImageParserError extends Error {
  constructor(
    public readonly code: ImageParseError,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ImageParserError';
  }
}

export interface ImageHealthParser {
  parse(image: Blob, context?: ImageParseContext): Promise<ParsedHealthData>;
}

/** 真实识别后给到 UI 展示的预解析结构（带可编辑字段）。 */
export interface PendingPhotoImport {
  /** 临时 ID：用于在确认前引用此次识别结果。 */
  draftId: string;
  detectedKind: VisionKind;
  capturedAt: string;
  measurements: HealthMeasurement[];
  labResults: LabResult[];
  tags: SymptomTag[];
  rawText?: string;
  provider: string;
  overallConfidence: number;
  warnings: string[];
  /** 解析用过的原始图片，仅在内存中保留以支持"重新识别"。不会持久化。 */
  image: Blob;
}

/** 真实指标白名单：Provider 必须只能返回这些 MetricKey，避免污染现有 pipeline。 */
export const ALLOWED_METRIC_KEYS: MetricKey[] = [
  'weight',
  'systolic',
  'diastolic',
  'restingHr',
  'spo2',
  'bloodGlucose',
];
