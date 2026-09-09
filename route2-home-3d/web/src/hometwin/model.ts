export type ObjectSource = 'vision' | 'manual' | 'inferred' | 'demo';
export type RelationType =
  | 'inside'
  | 'adjacent'
  | 'connects'
  | 'near'
  | 'blocks'
  | 'on-route';

export type HomeObjectCategory =
  | 'bed'
  | 'door'
  | 'rug'
  | 'cable'
  | 'threshold'
  | 'medicine'
  | 'glasses'
  | 'keys'
  | 'cabinet'
  | 'table'
  | 'chair'
  | 'toilet'
  | 'other';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface HomeObject {
  id: string;
  category: HomeObjectCategory;
  label: string;
  roomId: string;
  position: Vec3;
  confidence: number;
  source: ObjectSource;
  observedAt: string;
  evidence?: {
    imageIds?: string[];
    annotationId?: string;
  };
}

export interface HomeRoom {
  id: string;
  label: string;
  kind: 'bedroom' | 'corridor' | 'livingroom' | 'bathroom' | 'kitchen' | 'other';
}

export interface SpatialRelation {
  subjectId: string;
  relation: RelationType;
  objectId: string;
  confidence: number;
}

export interface HomeRoute {
  id: string;
  title: string;
  startObjectId: string;
  endObjectId: string;
  objectIds: string[];
  hazardIds: string[];
  confidence: number;
  source: ObjectSource;
}

export interface HomeTwinSnapshot {
  homeId: string;
  version: number;
  capturedAt: string;
  scaleConfidence: number;
  rooms: HomeRoom[];
  objects: HomeObject[];
  relations: SpatialRelation[];
  routes: HomeRoute[];
}

export function isConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateHomeTwin(snapshot: HomeTwinSnapshot): string[] {
  const errors: string[] = [];
  if (!snapshot.homeId) errors.push('homeId is required');
  if (!Number.isInteger(snapshot.version) || snapshot.version < 1) errors.push('version must be a positive integer');
  if (!snapshot.capturedAt) errors.push('capturedAt is required');
  if (!isConfidence(snapshot.scaleConfidence)) errors.push('scaleConfidence must be between 0 and 1');

  const roomIds = new Set(snapshot.rooms.map(r => r.id));
  const objectIds = new Set<string>();
  for (const obj of snapshot.objects) {
    if (objectIds.has(obj.id)) errors.push(`duplicate object id: ${obj.id}`);
    objectIds.add(obj.id);
    if (!roomIds.has(obj.roomId)) errors.push(`object ${obj.id} references missing room ${obj.roomId}`);
    if (!isConfidence(obj.confidence)) errors.push(`object ${obj.id} has invalid confidence`);
    if (!Number.isFinite(obj.position.x) || !Number.isFinite(obj.position.y) || !Number.isFinite(obj.position.z)) {
      errors.push(`object ${obj.id} has invalid position`);
    }
  }

  for (const relation of snapshot.relations) {
    if (!objectIds.has(relation.subjectId)) errors.push(`relation subject missing: ${relation.subjectId}`);
    if (!objectIds.has(relation.objectId)) errors.push(`relation object missing: ${relation.objectId}`);
    if (relation.subjectId === relation.objectId) errors.push(`relation self-reference: ${relation.subjectId}`);
    if (!isConfidence(relation.confidence)) errors.push(`relation ${relation.subjectId}->${relation.objectId} has invalid confidence`);
  }

  for (const route of snapshot.routes) {
    if (!objectIds.has(route.startObjectId)) errors.push(`route start missing: ${route.startObjectId}`);
    if (!objectIds.has(route.endObjectId)) errors.push(`route end missing: ${route.endObjectId}`);
    for (const objectId of route.objectIds) {
      if (!objectIds.has(objectId)) errors.push(`route ${route.id} references missing object ${objectId}`);
    }
    if (!isConfidence(route.confidence)) errors.push(`route ${route.id} has invalid confidence`);
  }

  return errors;
}
