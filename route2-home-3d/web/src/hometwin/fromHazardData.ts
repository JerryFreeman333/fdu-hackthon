import type { HazardData } from '../types';
import type { HomeTwinSnapshot } from './model';

const now = '2026-09-09T00:00:00Z';

export function buildDemoHomeTwin(data: HazardData): HomeTwinSnapshot {
  const rooms: HomeTwinSnapshot['rooms'] = [
    { id: 'bedroom', label: '卧室', kind: 'bedroom' },
    { id: 'corridor', label: '走廊', kind: 'corridor' },
    { id: 'livingroom', label: '客厅', kind: 'livingroom' },
    { id: 'bathroom', label: '卫生间', kind: 'bathroom' },
    { id: 'kitchen', label: '厨房', kind: 'kitchen' }
  ];

  const objects = [
    { id: 'bed', category: 'bed', label: '床', roomId: 'bedroom', position: [-3.2, 0, -1.2] as [number, number, number] },
    { id: 'bedside-glasses', category: 'glasses', label: '老花镜', roomId: 'bedroom', position: [-4.0, 0.55, -1.3] as [number, number, number] },
    { id: 'bedside-medicine', category: 'medicine', label: '降压药', roomId: 'bedroom', position: [-3.9, 0.55, -0.9] as [number, number, number] },
    { id: 'rug-curl', category: 'rug', label: '地毯翘边', roomId: 'corridor', position: [-0.6, 0.06, 0.2] as [number, number, number] },
    { id: 'step-no-rail', category: 'threshold', label: '高差台阶', roomId: 'corridor', position: [0.9, 0.3, -1.9] as [number, number, number] },
    { id: 'bathroom-entrance', category: 'door', label: '卫生间入口', roomId: 'bathroom', position: [2.1, 0.04, -2.6] as [number, number, number] },
    { id: 'keys', category: 'keys', label: '钥匙', roomId: 'livingroom', position: [2.6, 0.45, 0.55] as [number, number, number] }
  ].map(obj => ({
    ...obj,
    position: { x: obj.position[0], y: obj.position[1], z: obj.position[2] },
    confidence: 1,
    source: 'demo' as const,
    observedAt: now
  }));

  const routeById = new Map(data.paths.map(path => [path.id, path]));
  const routes = data.paths
    .map(path => ({
      id: path.id,
      title: path.title,
      startObjectId: path.id === 'night-toilet' || path.id === 'day-kitchen' ? 'bed' : 'keys',
      endObjectId: path.id === 'night-toilet' ? 'bathroom-entrance' : path.id === 'day-kitchen' ? 'bedside-medicine' : 'keys',
      hazardIds: path.hazardIds,
      confidence: path.demoPoints.length >= 2 ? 1 : 0
    }))
    .filter(route => routeById.has(route.id));

  const relations = [
    { subjectId: 'bedside-glasses', relation: 'near' as const, objectId: 'bed', confidence: 1 },
    { subjectId: 'bedside-medicine', relation: 'near' as const, objectId: 'bed', confidence: 1 },
    { subjectId: 'rug-curl', relation: 'on-route' as const, objectId: 'bed', confidence: 0.9 },
    { subjectId: 'step-no-rail', relation: 'on-route' as const, objectId: 'bathroom-entrance', confidence: 0.95 },
    { subjectId: 'bathroom-entrance', relation: 'connects' as const, objectId: 'step-no-rail', confidence: 1 },
    { subjectId: 'keys', relation: 'inside' as const, objectId: 'keys', confidence: 1 }
  ];

  return {
    homeId: 'demo-home-001',
    version: 1,
    capturedAt: now,
    scaleConfidence: 0.85,
    rooms,
    objects,
    relations,
    routes
  };
}
