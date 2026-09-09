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
