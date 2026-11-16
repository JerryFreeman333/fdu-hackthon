import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const catalogPath = resolve(root, 'public/data/semantic-targets.json');
const detectorPath = resolve(root, '../pipeline/semantic/detect_and_localize.py');
const runnerPath = resolve(root, '../pipeline/scripts/06_detect_semantics.ps1');
const requirementPath = resolve(root, '../pipeline/semantic/requirements.txt');

test('Route 2 declares six core semantic categories', async () => {
  const data = JSON.parse(await readFile(catalogPath, 'utf8'));
  const categories = data.targets.map(x => x.category);
  assert.deepEqual(categories, ['bed', 'door', 'rug', 'cable', 'threshold', 'toilet']);
  assert.equal(new Set(categories).size, 6);
  for (const target of data.targets) {
    assert.ok(target.label);
    assert.ok(Array.isArray(target.prompts) && target.prompts.length >= 1);
  }
});

test('Route 2 semantic pipeline keeps detection and localization conservative', async () => {
  const detector = await readFile(detectorPath, 'utf8');
  const runner = await readFile(runnerPath, 'utf8');
  const requirements = await readFile(requirementPath, 'utf8');
  assert.match(detector, /YOLOWorld\(/);
  assert.match(detector, /points3D\.txt/);
  assert.match(detector, /images\.txt/);
  assert.match(detector, /scaleConfidence.*0\.0/);
  assert.match(detector, /colmap-arbitrary/);
  assert.match(detector, /supportPointCount/);
  assert.match(detector, /anchor = None/);
  assert.match(runner, /model_converter/);
  assert.match(runner, /detect_and_localize\.py/);
  assert.match(requirements, /ultralytics>=8\.3,<9/);
  assert.match(requirements, /Pillow>=10,<12/);
});

test('semantic output is tied to the real capture task instead of demo runtime defaults', async () => {
  const detector = await readFile(detectorPath, 'utf8');
  const runner = await readFile(runnerPath, 'utf8');
  assert.match(runner, /\[string\]\$CapturedAt/);
  assert.match(runner, /\[string\]\$HomeId/);
  assert.match(runner, /--captured-at \$CapturedAt/);
  assert.match(runner, /--home-id \$HomeId/);
  assert.match(detector, /--captured-at/);
  assert.match(detector, /--home-id/);
  assert.match(detector, /HOME_ID\.fullmatch/);
  assert.match(detector, /"capturedAt": captured_at/);
  assert.match(detector, /"homeId": home_id/);
});

test('main scene actually consumes the semantic artifact instead of only checking its status', async () => {
  const main = await readFile(resolve(root, 'src/main.ts'), 'utf8');
  const capture = await readFile(resolve(root, 'src/captureHome.ts'), 'utf8');
  // 主场景必须按 homeId 拉取语义产物，并用它替换演示物品/风险，而不是只看 semanticUrl 是否存在。
  assert.match(main, /fetchCaptureHome\(/);
  assert.match(main, /loadSemanticSnapshot\(/);
  assert.match(main, /itemsFromSnapshot\(/);
  assert.match(main, /panelData/);
  assert.match(main, /hazards: \[\]/);
  // 拍摄页必须能把 homeId 带回主场景，否则识别结果永远进不了找东西/路线。
  assert.match(capture, /\?home=\$\{encodeURIComponent/);
});
