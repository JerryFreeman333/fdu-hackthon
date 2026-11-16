import test from 'node:test';
import assert from 'node:assert/strict';
import { captureReadiness } from '../src/captureStatus.ts';

test('capture readiness only trusts a published model artifact', () => {
  const ready = captureReadiness({
    status: 'ready',
    modelUrl: '/api/route2/homes/home/model.ply',
    modelReady: true,
    semanticReady: true,
    semanticStatus: 'ready',
    semanticUrl: '/api/route2/homes/home/semantic.json',
    semanticMessage: '视觉识别完成，已定位 2 个有画面和 3D 证据的物品；路线和风险结论仍需人工确认。',
  });
  assert.equal(ready.visible, true);
  assert.equal(ready.model, 'ready');
  assert.equal(ready.semantic, 'ready');
  assert.equal(ready.canViewModel, true);
  assert.equal(ready.canViewSemantic, true);
  assert.match(ready.semanticText, /人工确认/);

  const missingModel = captureReadiness({
    status: 'ready',
    modelReady: true,
    semanticReady: true,
    semanticStatus: 'ready',
    semanticUrl: '/api/route2/homes/home/semantic.json',
  });
  assert.equal(missingModel.model, 'failed');
  assert.equal(missingModel.canViewModel, false);
  assert.equal(missingModel.semantic, 'failed');
  assert.equal(missingModel.canViewSemantic, false);
});

test('semantic readiness never upgrades missing or guessed artifacts', () => {
  const noSemantic = captureReadiness({
    status: 'ready',
    modelUrl: '/api/route2/homes/home/model.ply',
    modelReady: true,
    semanticReady: false,
    semanticStatus: 'unavailable',
    semanticMessage: '当前建模服务不在 Windows 上运行，未执行视觉语义识别；房间外观模型仍可查看。',
  });
  assert.equal(noSemantic.model, 'ready');
  assert.equal(noSemantic.semantic, 'unavailable');
  assert.equal(noSemantic.canViewSemantic, false);
  assert.match(noSemantic.semanticText, /未执行视觉语义识别/);

  const incomplete = captureReadiness({
    status: 'ready',
    modelUrl: '/api/route2/homes/home/model.ply',
    modelReady: true,
    semanticReady: true,
    semanticStatus: 'ready',
    semanticUrl: null,
  });
  assert.equal(incomplete.semantic, 'failed');
  assert.equal(incomplete.canViewSemantic, false);
  assert.match(incomplete.semanticText, /不会显示猜测/);

  const legacyReady = captureReadiness({ status: 'ready', modelUrl: '/api/route2/homes/home/model.ply' });
  assert.equal(legacyReady.model, 'ready');
  assert.equal(legacyReady.semantic, 'unavailable');
  assert.equal(legacyReady.canViewSemantic, false);
});

test('capture readiness separates appearance model progress from semantic work', () => {
  const processing = captureReadiness({
    status: 'ready',
    modelUrl: '/api/route2/homes/home/model.ply',
    modelReady: true,
    semanticReady: false,
    semanticStatus: 'processing',
    semanticMessage: '房间外观已生成，正在识别物品与位置；识别失败不会影响查看模型。',
  });
  assert.equal(processing.model, 'ready');
  assert.equal(processing.semantic, 'processing');
  assert.equal(processing.canViewSemantic, false);
  assert.match(processing.semanticText, /正在识别物品与位置/);

  const building = captureReadiness({ status: 'training', semanticStatus: 'pending' });
  assert.equal(building.model, 'building');
  assert.equal(building.semantic, 'pending');
  assert.equal(building.canViewModel, false);
  assert.match(building.modelText, /正在生成/);

  const failed = captureReadiness({ status: 'failed', semanticStatus: 'failed' });
  assert.equal(failed.model, 'failed');
  assert.equal(failed.semantic, 'failed');
  assert.equal(failed.canViewModel, false);
  assert.match(failed.semanticText, /不会显示猜测/);

  assert.equal(captureReadiness({ status: 'empty' }).visible, false);
  assert.equal(captureReadiness({ status: 'waiting_worker' }).visible, true);
});
