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
    { id: 'bed', category: 'bed' as const, label: '床', roomId: 'bedroom', position: [-3.2, 0, -1.2] as [number, number, number] },
    { id: 'bedroom-door', category: 'door' as const, label: '卧室门', roomId: 'bedroom', position: [-1.4, 0, 0.2] as [number, number, number] },
    { id: 'rug-curl', category: 'rug' as const, label: '地毯', roomId: 'corridor', position: [-0.6, 0.06, 0.2] as [number, number, number] },
    { id: 'step-no-rail', category: 'threshold' as const, label: '高差台阶', roomId: 'corridor', position: [0.9, 0.3, -1.9] as [number, number, number] },
    { id: 'bathroom-door', category: 'door' as const, label: '卫生间入口', roomId: 'bathroom', position: [2.1, 0.04, -2.6] as [number, number, number] },
    { id: 'toilet', category: 'toilet' as const, label: '卫生间', roomId: 'bathroom', position: [2.6, 0, -3.0] as [number, number, number] },
    { id: 'bedside-glasses', category: 'glasses' as const, label: '老花镜', roomId: 'bedroom', position: [-4.0, 0.55, -1.3] as [number, number, number], locationText: '卧室床头柜上', lastConfirmedAt: now },
    { id: 'bedside-medicine', category: 'medicine' as const, label: '降压药', roomId: 'bedroom', position: [-3.9, 0.55, -0.9] as [number, number, number], locationText: '卧室床头柜上的药盒内', lastConfirmedAt: now },
    { id: 'keys', category: 'keys' as const, label: '钥匙', roomId: 'livingroom', position: [2.6, 0.45, 0.55] as [number, number, number], locationText: '客厅茶几上', lastConfirmedAt: now }
  ].map(obj => ({
    ...obj,
    position: { x: obj.position[0], y: obj.position[1], z: obj.position[2] },
    confidence: 1,
    source: 'demo' as const,
    observedAt: now
  }));

  const byId = new Map(objects.map(object => [object.id, object]));
  const relations: HomeTwinSnapshot['relations'] = [
    { subjectId: 'bedside-glasses', relation: 'near', objectId: 'bed', confidence: 1, source: 'demo' },
    { subjectId: 'bedside-medicine', relation: 'near', objectId: 'bed', confidence: 1, source: 'demo' },
    { subjectId: 'bedroom-door', relation: 'connects', objectId: 'rug-curl', confidence: 1, source: 'demo' },
    { subjectId: 'rug-curl', relation: 'connects', objectId: 'step-no-rail', confidence: 0.95, source: 'demo' },
    { subjectId: 'step-no-rail', relation: 'connects', objectId: 'bathroom-door', confidence: 0.95, source: 'demo' },
    { subjectId: 'bathroom-door', relation: 'connects', objectId: 'toilet', confidence: 1, source: 'demo' },
    { subjectId: 'rug-curl', relation: 'on-route', objectId: 'bed', confidence: 0.9, source: 'demo' },
    { subjectId: 'step-no-rail', relation: 'on-route', objectId: 'bathroom-door', confidence: 0.95, source: 'demo' }
  ];

  const demoNight = data.paths.find(path => path.id === 'night-toilet');
  const routes = demoNight && byId.has('bed') && byId.has('toilet') ? [
    {
      id: 'night-toilet',
      title: demoNight.title,
      startObjectId: 'bed',
      endObjectId: 'toilet',
      objectIds: ['bed', 'bedroom-door', 'rug-curl', 'step-no-rail', 'bathroom-door', 'toilet'],
      hazardIds: demoNight.hazardIds,
      confidence: 0.95,
      source: 'demo' as const,
      lastConfirmedAt: now
    }
  ] : [];

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
