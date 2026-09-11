import type { HomeObjectCategory, ObjectSource, Vec3 } from './model';

export interface BBox2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisionDetection {
  annotationId: string;
  imageId: string;
  category: HomeObjectCategory;
  label: string;
  confidence: number;
  bbox: BBox2D;
}

export interface SpatialAnchor3D {
  annotationId: string;
  position: Vec3;
  confidence: number;
  source: Exclude<ObjectSource, 'demo'>;
  imageIds: string[];
}

export interface SemanticObservation {
  detection: VisionDetection;
  anchor3D?: SpatialAnchor3D;
}

export const ROUTE2_CORE_CATEGORIES: HomeObjectCategory[] = [
  'bed',
  'door',
  'rug',
  'cable',
  'threshold',
  'toilet'
];

export function isCoreRoute2Category(category: HomeObjectCategory): boolean {
  return ROUTE2_CORE_CATEGORIES.includes(category);
}

export function validateVisionDetection(d: VisionDetection): string[] {
  const errors: string[] = [];
  if (!d.annotationId) errors.push('annotationId is required');
  if (!d.imageId) errors.push('imageId is required');
  if (!isCoreRoute2Category(d.category)) errors.push(`unsupported route2 category: ${d.category}`);
  if (!Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1) errors.push('confidence must be between 0 and 1');
  if (!Number.isFinite(d.bbox.x) || !Number.isFinite(d.bbox.y) || d.bbox.width <= 0 || d.bbox.height <= 0) {
    errors.push('bbox must have positive width and height');
  }
  return errors;
}

export function validateSpatialAnchor(a: SpatialAnchor3D): string[] {
  const errors: string[] = [];
  if (!a.annotationId) errors.push('annotationId is required');
  if (!Number.isFinite(a.position.x) || !Number.isFinite(a.position.y) || !Number.isFinite(a.position.z)) {
    errors.push('position must contain finite x/y/z');
  }
  if (!Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) {
    errors.push('confidence must be between 0 and 1');
  }
  return errors;
}
