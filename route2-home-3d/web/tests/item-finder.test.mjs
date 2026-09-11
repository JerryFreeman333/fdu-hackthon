import test from 'node:test';
import assert from 'node:assert/strict';
import { locateItem } from '../src/hometwin/itemFinder.ts';

const NOW = '2026-09-01T00:00:00Z';

// 关键场景：没有任何 connects 关系、没有任何路线——找药/找物必须仍然可用。
const snapshot = {
  homeId: 'test-home',
  version: 1,
  capturedAt: NOW,
  scaleConfidence: 0.8,
  rooms: [{ id: 'bedroom', label: '卧室', kind: 'bedroom' }],
  objects: [
    {
      id: 'medicine-1',
      category: 'medicine',
      label: '降压药',
      roomId: 'bedroom',
      position: { x: 0, y: 0, z: 0 },
      confidence: 0.95,
      source: 'vision',
      observedAt: NOW,
      locationText: '卧室床头柜上的药盒内',
      lastConfirmedAt: NOW,
      evidence: { imageIds: ['img-medicine-1'] }
    },
    {
      id: 'glasses-1',
      category: 'glasses',
      label: '老花镜',
      roomId: 'bedroom',
      position: { x: 1, y: 0, z: 0 },
      confidence: 0.3,
      source: 'inferred',
      observedAt: NOW
    }
  ],
  relations: [],
  routes: []
};

test('finding medicine works without any routes or connects relations', () => {
  const result = locateItem(snapshot, { category: 'medicine' });
  assert.equal(result.status, 'found');
  assert.equal(result.locationText, '卧室床头柜上的药盒内');
  assert.equal(result.lastConfirmedAt, NOW);
  assert.equal(result.confidence, 0.95);
  assert.deepEqual(result.evidenceImageIds, ['img-medicine-1']);
});

test('low-confidence or inferred item is explicitly flagged uncertain', () => {
  const result = locateItem(snapshot, { category: 'glasses' });
  assert.equal(result.status, 'uncertain');
  assert.ok(result.note && result.note.includes('不确定') || result.note.includes('推测'), 'uncertain item needs an explicit note');
  assert.equal(result.roomLabel, '卧室');
});

test('unknown item returns not_found with guidance instead of an error', () => {
  const result = locateItem(snapshot, { labelIncludes: '钥匙' });
  assert.equal(result.status, 'not_found');
  assert.ok(result.note);
});
