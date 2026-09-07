import type { HealthMeasurement, LabResult, SymptomTag } from '../types';

export interface ParsedHealthData {
  measurements: HealthMeasurement[];
  labResults: LabResult[];
  tags: SymptomTag[];
  rawText?: string;
}

/**
 * 影像/OCR 统一接口。
 * 当前 DemoImageHealthParser 不读取真实图片；未来接 OCR/Vision 后保持相同返回结构。
 */
export interface ImageHealthParser {
  parse(image: Blob, context?: { userId?: string; capturedAt?: string }): Promise<ParsedHealthData>;
}
