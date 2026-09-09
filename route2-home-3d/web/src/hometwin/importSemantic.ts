import type { HomeObject, HomeObjectCategory, HomeTwinSnapshot } from './model';
import type { SemanticObservation } from './semantic';

export interface SemanticImportInput {
  homeId: string;
  version: number;
  capturedAt: string;
  scaleConfidence: number;
  rooms: HomeTwinSnapshot['rooms'];
  observations: SemanticObservation[];
}

const categoryRoomDefaults: Partial<Record<HomeObjectCategory, HomeTwinSnapshot['rooms'][number]['kind']>> = {
  bed: 'bedroom',
  rug: 'corridor',
  threshold: 'corridor',
  toilet: 'bathroom',
  door: 'corridor',
  cable: 'corridor'
};

export function importSemanticObservations(input: SemanticImportInput): HomeTwinSnapshot {
  const objects: HomeObject[] = [];

  for (const observation of input.observations) {
    if (!observation.anchor3D) continue;
    const preferredRoomKind = categoryRoomDefaults[observation.detection.category];
    const room = preferredRoomKind
      ? input.rooms.find(r => r.kind === preferredRoomKind)
      : undefined;
    const roomId = room?.id ?? input.rooms[0]?.id;
    if (!roomId) continue;

    objects.push({
      id: observation.detection.annotationId,
      category: observation.detection.category,
      label: observation.detection.label,
      roomId,
      position: observation.anchor3D.position,
      confidence: Math.min(observation.detection.confidence, observation.anchor3D.confidence),
      source: observation.anchor3D.source,
      observedAt: input.capturedAt,
      evidence: {
        imageIds: observation.anchor3D.imageIds,
        annotationId: observation.detection.annotationId
      }
    });
  }

  return {
    homeId: input.homeId,
    version: input.version,
    capturedAt: input.capturedAt,
    scaleConfidence: input.scaleConfidence,
    rooms: input.rooms,
    objects,
    relations: [],
    routes: []
  };
}
