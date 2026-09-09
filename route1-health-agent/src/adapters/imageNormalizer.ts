/**
 * 把 Provider 返回的严格结构化结果，校验并转换为 ParsedHealthData。
 *
 * 这里严格遵循"不要静默写入错误数据"的边界：
 *   - 单位缺失 → 抛 ImageParserError('missing_unit')
 *   - 数值缺失或越界 → 抛 ImageParserError('invalid_blood_pressure' / 'invalid_weight' / 'missing_values')
 *   - 整体 confidence 过低 → 抛 ImageParserError('low_confidence')
 *   - kind=unknown → 抛 ImageParserError('unknown_image')
 *   - 血压只识别到收缩压 → 抛 ImageParserError('invalid_blood_pressure')
 *   - 体重出现明显异常值 → 抛 ImageParserError('invalid_weight')
 */
import { ALLOWED_METRIC_KEYS, ImageParserError, type HealthVisionResult, type ImageParseContext, type ParsedHealthData } from './ImageHealthParser';
import type { HealthMeasurement, LabResult, MetricKey, SymptomTag } from '../types';

const METRIC_TO_UNIT_HINT: Record<MetricKey, string[]> = {
  steps: ['步', 'steps'],
  walkSpeed: ['m/s'],
  sleepHours: ['h', '小时', 'hr', 'hour'],
  nightWakes: ['次'],
  restingHr: ['bpm', '次/分', '次每分', '次/min'],
  weight: ['kg', '公斤', '斤'],
  spo2: ['%', 'spo2'],
  systolic: ['mmhg', 'mmHg'],
  diastolic: ['mmhg', 'mmHg'],
  bloodGlucose: ['mmol/l', 'mmol/L', 'mg/dl'],
};

function unitsCompatible(unit: string, key: MetricKey): boolean {
  const allowed = METRIC_TO_UNIT_HINT[key];
  if (allowed.length === 0) return true;
  const normalized = unit.trim().toLowerCase();
  if (!normalized) return false;
  return allowed.some((hint) => normalized === hint.toLowerCase());
}

/** 血压合理范围（成人，单位 mmHg）：不取代临床阈值，只是防止明显荒谬的 OCR 错误进入事件流。 */
const SYSTOLIC_RANGE = { min: 60, max: 260 };
const DIASTOLIC_RANGE = { min: 30, max: 180 };
const HEARTRATE_RANGE = { min: 25, max: 220 };
const WEIGHT_RANGE_KG = { min: 20, max: 250 };

/** Provider 真实阈值：低于此即视为识别不可靠，要求用户重新拍照或手动输入。 */
export const MIN_OVERALL_CONFIDENCE = 0.55;
export const MIN_MEASUREMENT_CONFIDENCE = 0.4;

function pushIfMissing<T>(set: Set<T>, value: T, condition: boolean): void {
  if (condition) set.add(value);
}

function buildMeasurements(
  result: HealthVisionResult,
  context: ImageParseContext,
): { measurements: HealthMeasurement[]; warnings: string[] } {
  const measurements: HealthMeasurement[] = [];
  const warnings: string[] = [];
  const capturedAt = context.capturedAt ?? new Date().toISOString();

  for (const m of result.measurements) {
    const metric = ALLOWED_METRIC_KEYS.find((key) => key === m.metric);
    if (!metric) {
      // 不在白名单的 metric：忽略并记录 warning，绝不悄悄落库。
      warnings.push(`unknown_metric:${m.metric}`);
      continue;
    }
    if (!m.unit || !m.unit.trim()) {
      throw new ImageParserError('missing_unit', `${metric} 缺少单位`);
    }
    if (!unitsCompatible(m.unit, metric)) {
      throw new ImageParserError('missing_unit', `${metric} 单位不识别：${m.unit}`);
    }
    if (m.confidence < MIN_MEASUREMENT_CONFIDENCE) {
      throw new ImageParserError('low_confidence', `${metric} 单条置信度过低`);
    }
    // 值范围校验
    if (metric === 'systolic' && (m.value < SYSTOLIC_RANGE.min || m.value > SYSTOLIC_RANGE.max)) {
      throw new ImageParserError('invalid_blood_pressure', `收缩压越界 ${m.value}`);
    }
    if (metric === 'diastolic' && (m.value < DIASTOLIC_RANGE.min || m.value > DIASTOLIC_RANGE.max)) {
      throw new ImageParserError('invalid_blood_pressure', `舒张压越界 ${m.value}`);
    }
    if (metric === 'restingHr' && (m.value < HEARTRATE_RANGE.min || m.value > HEARTRATE_RANGE.max)) {
      throw new ImageParserError('missing_values', `心率越界 ${m.value}`);
    }
    if (metric === 'weight') {
      // 体重识别里若单位是"斤"，先换算成 kg。
      let kg = m.value;
      if (/斤/.test(m.unit)) kg = m.value / 2;
      if (kg < WEIGHT_RANGE_KG.min || kg > WEIGHT_RANGE_KG.max) {
        throw new ImageParserError('invalid_weight', `体重值无法解释：${m.value}${m.unit}`);
      }
      measurements.push({
        id: `photo-${metric}-${capturedAt}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: capturedAt,
        metric,
        value: kg,
        unit: 'kg',
        source: 'photo',
        confidence: m.confidence,
        metadata: {
          providerMetric: m.metric,
          providerUnit: m.unit,
          rawValue: m.value,
        },
      });
      continue;
    }
    measurements.push({
      id: `photo-${metric}-${capturedAt}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: capturedAt,
      metric,
      value: m.value,
      unit: m.unit,
      source: 'photo',
      confidence: m.confidence,
      metadata: {
        providerMetric: m.metric,
        providerUnit: m.unit,
      },
    });
  }

  // 血压完整性：如果同时识别到 systolic 但没识别到 diastolic，视为不合法。
  const hasSystolic = measurements.some((item) => item.metric === 'systolic');
  const hasDiastolic = measurements.some((item) => item.metric === 'diastolic');
  if (hasSystolic && !hasDiastolic) {
    throw new ImageParserError('invalid_blood_pressure', '血压只识别到收缩压，未识别到舒张压');
  }
  if (hasDiastolic && !hasSystolic) {
    throw new ImageParserError('invalid_blood_pressure', '血压只识别到舒张压，未识别到收缩压');
  }

  return { measurements, warnings };
}

function buildLabResults(
  result: HealthVisionResult,
  context: ImageParseContext,
): { labResults: LabResult[]; warnings: string[] } {
  const labResults: LabResult[] = [];
  const warnings: string[] = [];
  const capturedAt = context.capturedAt ?? new Date().toISOString();
  for (const lab of result.labResults) {
    if (!lab.name.trim()) {
      warnings.push('lab_missing_name');
      continue;
    }
    if (!lab.unit.trim()) {
      // 第一阶段不允许"裸数值"：不知道单位就不入库。
      throw new ImageParserError('missing_unit', `化验项 ${lab.name} 缺少单位`);
    }
    if (lab.confidence < MIN_MEASUREMENT_CONFIDENCE) {
      warnings.push(`lab_low_confidence:${lab.name}`);
      continue;
    }
    labResults.push({
      id: `photo-lab-${lab.name}-${capturedAt}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: capturedAt,
      name: lab.name.trim(),
      value: lab.value,
      unit: lab.unit.trim(),
      source: 'photo',
      confidence: lab.confidence,
      referenceRange: lab.referenceRange,
    });
  }
  return { labResults, warnings };
}

function deriveTagsFromMeasurements(measurements: HealthMeasurement[]): SymptomTag[] {
  const tags = new Set<SymptomTag>();
  for (const m of measurements) {
    if (m.metric === 'systolic' && m.value >= 140) pushIfMissing(tags, 'bpHigh', true);
    if (m.metric === 'diastolic' && m.value >= 90) pushIfMissing(tags, 'bpHigh', true);
  }
  return [...tags];
}

/**
 * 校验入口：综合判定。
 *   - 整体 confidence 过低 → unknown_image（用户应重拍）
 *   - kind=unknown → unknown_image
 *   - measurements 与 labResults 都为空 → unknown_image
 */
export function validateVisionResult(result: HealthVisionResult): void {
  if (result.kind === 'unknown') {
    throw new ImageParserError('unknown_image', '图片无法识别为已知类型');
  }
  if (result.measurements.length === 0 && result.labResults.length === 0) {
    throw new ImageParserError('unknown_image', '图片中未识别到任何健康数据');
  }
  if (result.confidence < MIN_OVERALL_CONFIDENCE) {
    throw new ImageParserError('low_confidence', `整体置信度过低 (${result.confidence.toFixed(2)})`);
  }
}

export function buildParsedHealthData(
  result: HealthVisionResult,
  context: ImageParseContext,
  providerName: string,
): ParsedHealthData {
  validateVisionResult(result);
  const { measurements, warnings: mWarnings } = buildMeasurements(result, context);
  const { labResults, warnings: lWarnings } = buildLabResults(result, context);
  const tags = deriveTagsFromMeasurements(measurements);
  const warnings = [...mWarnings, ...lWarnings];
  const needsConfirmation = result.confidence < 0.85 || warnings.length > 0;
  return {
    measurements,
    labResults,
    tags,
    rawText: result.rawText,
    parseMeta: {
      provider: providerName,
      overallConfidence: result.confidence,
      needsConfirmation,
      detectedKind: result.kind,
      warnings,
    },
  };
}

/** 输入侧校验（在调用 Provider 之前完成）。 */
export function validateImageInput(image: Blob): void {
  if (!image) throw new ImageParserError('empty_image', '图片为空');
  if (image.size === 0) throw new ImageParserError('empty_image', '图片为空');
  const type = image.type;
  if (type && !/^image\/(png|jpe?g|webp|heic|heif)$/i.test(type)) {
    throw new ImageParserError('unsupported_format', `不支持的图片格式：${type}`);
  }
}