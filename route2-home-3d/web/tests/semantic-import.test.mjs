import test from 'node:test';
import assert from 'node:assert/strict';
import {
  itemsFromSnapshot,
  loadSemanticSnapshot,
  parseSemanticArtifact
} from '../src/hometwin/semanticSnapshot.ts';

const HOME_ID = 'a'.repeat(32);
const CAPTURED_AT = '2026-01-02T03:04:05Z';

function payload(overrides = {}) {
  const base = {
    schemaVersion: 1,
    localization: {
      provider: 'colmap-track-anchor',
      coordinateFrame: 'colmap-arbitrary',
      metricScaleAvailable: false
    },
    snapshot: {
      homeId: HOME_ID,
      version: 1,
      capturedAt: CAPTURED_AT,
      scaleConfidence: 0.0,
      rooms: [
        { id: 'bedroom', label: '卧室', kind: 'bedroom' },
        { id: 'bathroom', label: '卫生间', kind: 'bathroom' }
      ],
      objects: [
        {
          id: 'vision-bed-1',
          category: 'bed',
          label: 'bed',
          roomId: 'bedroom',
          position: { x: 0.1, y: -0.2, z: 1.3 },
          confidence: 0.72,
          source: 'vision',
          observedAt: CAPTURED_AT,
          evidence: { imageIds: ['frame-0001.jpg'], annotationId: 'frame-0001:0' }
        },
        {
          id: 'vision-toilet-1',
          category: 'toilet',
          label: 'toilet',
          roomId: 'bathroom',
          position: { x: 2.0, y: 0.0, z: -1.0 },
          confidence: 0.8,
          source: 'vision',
          observedAt: CAPTURED_AT,
          evidence: { imageIds: ['frame-0002.jpg', 'frame-0003.jpg'], annotationId: 'frame-0002:0' }
        }
      ],
      relations: [
        { subjectId: 'vision-bed-1', relation: 'connects', objectId: 'vision-toilet-1', confidence: 0.7, source: 'inferred' }
      ],
      routes: [
        {
          id: 'r1',
          title: '床到卫生间',
          startObjectId: 'vision-bed-1',
          endObjectId: 'vision-toilet-1',
          objectIds: ['vision-bed-1', 'vision-toilet-1'],
          hazardIds: [],
          confidence: 0.7,
          source: 'inferred',
          status: 'candidate'
        }
      ]
    }
  };
  return { ...base, ...overrides };
}

test('语义产物导入保留合法的 relations / routes，而不是永远丢掉', () => {
  const result = parseSemanticArtifact(payload(), { homeId: HOME_ID, capturedAt: CAPTURED_AT });
  assert.deepEqual(result.errors, []);
  assert.ok(result.snapshot);
  assert.equal(result.snapshot.objects.length, 2);
  assert.equal(result.snapshot.relations.length, 1);
  assert.equal(result.snapshot.routes.length, 1);
  assert.equal(result.snapshot.routes[0].status, 'candidate');
  assert.equal(result.snapshot.scaleConfidence, 0);
});

test('缺失 relations / routes 时退化为空数组，而不是让整份快照失效', () => {
  const raw = payload();
  delete raw.snapshot.relations;
  delete raw.snapshot.routes;
  const result = parseSemanticArtifact(raw, { homeId: HOME_ID });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.snapshot.relations, []);
  assert.deepEqual(result.snapshot.routes, []);
});

test('语义产物必须与本次拍摄绑定，且不能声称已有尺度或演示来源', () => {
  const cases = [
    ['homeId 不匹配', { ...payload(), snapshot: { ...payload().snapshot, homeId: 'b'.repeat(32) } }],
    ['capturedAt 不匹配', { ...payload(), snapshot: { ...payload().snapshot, capturedAt: '2026-02-02T00:00:00Z' } }],
    ['声称米制尺度', { ...payload(), localization: { coordinateFrame: 'colmap-arbitrary', metricScaleAvailable: true } }],
    ['scaleConfidence 非 0', { ...payload(), snapshot: { ...payload().snapshot, scaleConfidence: 0.9 } }],
    ['对象来源是 demo', { ...payload(), snapshot: { ...payload().snapshot, objects: [{ ...payload().snapshot.objects[0], source: 'demo' }], relations: [], routes: [] } }]
  ];
  for (const [label, raw] of cases) {
    const result = parseSemanticArtifact(raw, { homeId: HOME_ID, capturedAt: CAPTURED_AT });
    assert.equal(result.snapshot, null, `${label}: 必须整体拒绝`);
    assert.ok(result.errors.length > 0, `${label}: 必须说明拒绝原因`);
  }
});

test('引用了不存在物品的关系/路线会被引用完整性校验拒绝', () => {
  const raw = payload();
  raw.snapshot.relations = [
    { subjectId: 'vision-bed-1', relation: 'connects', objectId: 'ghost', confidence: 0.9, source: 'inferred' }
  ];
  const relationResult = parseSemanticArtifact(raw, { homeId: HOME_ID });
  assert.equal(relationResult.snapshot, null);
  assert.match(relationResult.errors.join(' '), /missing/);

  const rawRoute = payload();
  rawRoute.snapshot.routes = [
    {
      id: 'bad',
      title: '坏路线',
      startObjectId: 'vision-bed-1',
      endObjectId: 'ghost',
      objectIds: ['vision-bed-1'],
      hazardIds: [],
      confidence: 0.9,
      source: 'inferred'
    }
  ];
  const routeResult = parseSemanticArtifact(rawRoute, { homeId: HOME_ID });
  assert.equal(routeResult.snapshot, null);
  assert.match(routeResult.errors.join(' '), /route end missing/);
});

test('semanticReady 为假时不拉取，也不把模型外观当成识别结果', async () => {
  let called = 0;
  const fetchImpl = async () => {
    called += 1;
    return new Response('{}', { status: 200 });
  };
  const result = await loadSemanticSnapshot(
    { homeId: HOME_ID, modelReady: true, modelUrl: '/model.ply', semanticReady: false, semanticUrl: null },
    fetchImpl
  );
  assert.equal(result.snapshot, null);
  assert.equal(called, 0);
  assert.match(result.errors.join(' '), /没有可用的视觉识别结果/);
});

test('semanticReady 为真时读取 semanticUrl 并解析', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    return new Response(JSON.stringify(payload()), { status: 200 });
  };
  const result = await loadSemanticSnapshot(
    {
      homeId: HOME_ID,
      capturedAt: CAPTURED_AT,
      modelReady: true,
      modelUrl: '/model.ply',
      semanticReady: true,
      semanticUrl: `/api/route2/homes/${HOME_ID}/semantic.json`
    },
    fetchImpl
  );
  assert.deepEqual(requested, [`/api/route2/homes/${HOME_ID}/semantic.json`]);
  assert.ok(result.snapshot);
});

test('找东西只给文字位置，不返回未对齐的 3D 坐标', () => {
  const snapshot = parseSemanticArtifact(payload(), { homeId: HOME_ID }).snapshot;
  const items = itemsFromSnapshot(snapshot);
  assert.equal(items.length, 2);
  const bed = items.find(item => item.id === 'vision-bed-1');
  assert.equal(bed.title, '床');
  assert.equal(bed.location, '卧室');
  assert.match(bed.say, /画面证据 1 张/);
  assert.match(bed.say, /坐标尚未与查看器对齐/);
  assert.equal('realPos' in bed, false);
  assert.equal('demoPos' in bed, false);
  assert.equal('position' in bed, false);
});
