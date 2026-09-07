/**
 * 影像/OCR 统一接口。
 * 当前 DemoImageHealthParser 不读取真实图片；未来接 OCR/Vision 后保持相同返回结构。
 */
import type { HealthMeasurement, LabResult, SymptomTag } from '../types';

export interface ParsedHealthData {
  measurements: HealthMeasurement[];
  labResults: LabResult[];
  tags: SymptomTag[];
  rawText?: string;
}

export type ImageParseContext = {
  userId?: string;
  capturedAt?: string;
  kind?: 'bloodPressure' | 'weight' | 'report';
};

export interface ImageHealthParser {
  parse(image: Blob, context?: ImageParseContext): Promise<ParsedHealthData>;
}
