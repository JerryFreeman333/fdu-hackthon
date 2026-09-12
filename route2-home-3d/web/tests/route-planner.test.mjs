import test from 'node:test';
import assert from 'node:assert/strict';
// Node >= 23.6 原生支持 TS 类型剥离；被测模块只使用 type-only import，无需编译。
import { planBedToToilet, assessRouteEligibility } from '../src/hometwin/routePlanner.ts';

const NOW = '2026-09-01T00:00:00Z';

function obj(id, category, roomId, position, extra = {}) {
  return {
    id,
    category,
    label: id,
    roomId,
    position: { x: position[0], y: position[1], z: position[2] },
    confidence: 0.9,
    source: 'vision',
    observedAt: NOW,
    ...extra
  };
}

function snapshot({ objects, relations = [], routes = [] }) {
  return {
    homeId: 'test-home',
    version: 1,
    capturedAt: NOW,
    scaleConfidence: 0.8,
    rooms: [
      { id: 'bedroom', label: '卧室', kind: 'bedroom' },
      { id: 'corridor', label: '走廊', kind: 'corridor' },
      { id: 'bathroom', label: '卫生间', kind: 'bathroom' }
    ],
    objects,
    relations,
    routes
  };
}

const baseObjects = () => [
  obj('bed', 'bed', 'bedroom', [0, 0, 0], { locationText: '卧室靠墙', lastConfirmedAt: NOW }),
  obj('bedroom-door', 'door', 'bedroom', [1, 0, 0]),
  obj('corridor-mark', 'other', 'corridor', [2, 0, 0]),
  obj('bathroom-door', 'door', 'bathroom', [3, 0, 0]),
  obj('toilet', 'toilet', 'bathroom', [4, 0, 0], { locationText: '卫生间内右侧', lastConfirmedAt: NOW, evidence: { imageIds: ['img-1'] } })
];

const fullConnects = () => [
  { subjectId: 'bed', relation: 'connects', objectId: 'bedroom-door', confidence: 0.9, source: 'vision' },
  { subjectId: 'bedroom-door', relation: 'connects', objectId: 'corridor-mark', confidence: 0.9, source: 'vision' },
  { subjectId: 'corridor-mark', relation: 'connects', objectId: 'bathroom-door', confidence: 0.9, source: 'vision' },
  { subjectId: 'bathroom-door', relation: 'connects', objectId: 'toilet', confidence: 0.9, source: 'vision' }
];

test('ambiguous, low-confidence, demo-only and blocked endpoints fail closed with location fallback', () => {
  const cases = [
    snapshot({ objects: [...baseObjects(), obj('bed-2', 'bed', 'bedroom', [0, 0, 1])], relations: fullConnects() }),
    snapshot({ objects: baseObjects().map(o => o.id === 'bed' ? { ...o, confidence: 0.1 } : o), relations: fullConnects() }),
    snapshot({ objects: baseObjects(), relations: fullConnects().map(r => ({ ...r, source: 'demo' })) }),
    snapshot({ objects: baseObjects(), relations: [...fullConnects(), { subjectId: 'toilet', relation: 'blocks', objectId: 'bathroom-door', confidence: 1, source: 'vision' }] }),
  ];
  for (const value of cases) {
    assert.equal(assessRouteEligibility(value).eligible, false);
    assert.equal(planBedToToilet(value).route, null);
    assert.match(planBedToToilet(value).fallback.locationText, /卫生间/);
  }
});

test('a previously verified different path cannot certify the newly inferred path', () => {
  const value = snapshot({ objects: baseObjects(), relations: fullConnects(), routes: [{
    id: 'old', startObjectId: 'bed', endObjectId: 'toilet',
    objectIds: ['bed', 'toilet'], status: 'verified', source: 'manual',
  }] });
  assert.equal(planBedToToilet(value).status, 'candidate');
});

test('enough connects relations produce a candidate route with door on path', () => {
  const result = planBedToToilet(snapshot({ objects: baseObjects(), relations: fullConnects() }));
  assert.equal(result.status, 'candidate');
  assert.ok(result.route, 'candidate result should carry a route');
  assert.equal(result.route.objectIds[0], 'bed');
  assert.equal(result.route.objectIds.at(-1), 'toilet');
  assert.equal(result.route.status, 'candidate');
});

test('candidate route never claims to be a safety guarantee', () => {
  const result = planBedToToilet(snapshot({ objects: baseObjects(), relations: fullConnects() }));
  assert.ok(result.fallback?.notes?.some(n => n.includes('不是安全保证')));
});

test('missing door / broken connects returns needs_confirmation with fallback', () => {
  // 没有任何门对象，且 connects 链断裂
  const objects = baseObjects().filter(o => o.category !== 'door');
  const relations = [
    { subjectId: 'bed', relation: 'connects', objectId: 'corridor-mark', confidence: 0.9, source: 'vision' }
  ];
  const result = planBedToToilet(snapshot({ objects, relations }));
  assert.equal(result.status, 'needs_confirmation');
  assert.equal(result.route, null);
  assert.ok(result.fallback, 'needs_confirmation must still carry fallback info');
  assert.equal(result.fallback.locationText, '卫生间内右侧');
  assert.equal(result.fallback.lastConfirmedAt, NOW);
  assert.deepEqual(result.fallback.evidenceImageIds, ['img-1']);
});

test('missing endpoint object returns unavailable but keeps fallback', () => {
  const objects = baseObjects().filter(o => o.category !== 'toilet');
  const result = planBedToToilet(snapshot({ objects, relations: fullConnects() }));
  assert.equal(result.status, 'unavailable');
  assert.equal(result.route, null);
  assert.ok(result.fallback, 'unavailable must not leave the elder with nothing');
  assert.ok(result.fallback.notes.length > 0);
  assert.equal(result.fallback.locationText, '卧室靠墙');
});

test('pre-confirmed stored route upgrades status to verified', () => {
  const routes = [{
    id: 'night-toilet',
    title: '床 → 卫生间',
    startObjectId: 'bed',
    endObjectId: 'toilet',
    objectIds: ['bed', 'bedroom-door', 'corridor-mark', 'bathroom-door', 'toilet'],
    hazardIds: [],
    confidence: 0.95,
    source: 'manual',
    status: 'verified',
    lastConfirmedAt: NOW
  }];
  const result = planBedToToilet(snapshot({ objects: baseObjects(), relations: fullConnects(), routes }));
  assert.equal(result.status, 'verified');
  assert.equal(result.route.status, 'verified');
});
