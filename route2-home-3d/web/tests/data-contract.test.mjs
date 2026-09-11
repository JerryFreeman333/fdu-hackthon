import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, '../public/data/hazards.json');

async function loadData() {
  return JSON.parse(await readFile(dataPath, 'utf8'));
}

test('hazard, route and item ids are unique', async () => {
  const data = await loadData();
  for (const key of ['hazards', 'paths', 'items']) {
    const ids = data[key].map(x => x.id);
    assert.equal(new Set(ids).size, ids.length, `${key} contains duplicate ids`);
  }
});

test('all route hazard references resolve', async () => {
  const data = await loadData();
  const hazardIds = new Set(data.hazards.map(x => x.id));
  for (const path of data.paths) {
    for (const id of path.hazardIds) {
      assert.ok(hazardIds.has(id), `${path.id} references missing hazard ${id}`);
    }
    assert.ok(Array.isArray(path.demoPoints) && path.demoPoints.length >= 2, `${path.id} needs demo route points`);
    assert.ok(path.realPoints === null || (Array.isArray(path.realPoints) && path.realPoints.length >= 2), `${path.id} has invalid realPoints`);
  }
});

test('positions use xyz triples and real coordinates are explicitly nullable', async () => {
  const data = await loadData();
  for (const hazard of data.hazards) {
    assert.equal(hazard.demoPos.length, 3, `${hazard.id} demoPos`);
    assert.ok(hazard.realPos === null || hazard.realPos.length === 3, `${hazard.id} realPos`);
    assert.match(hazard.level, /^(high|medium|low)$/);
  }
  for (const item of data.items) {
    assert.equal(item.demoPos.length, 3, `${item.id} demoPos`);
    assert.ok(item.realPos === null || item.realPos.length === 3, `${item.id} realPos`);
  }
});

test('real mode never claims full calibration while coordinates are null', async () => {
  const data = await loadData();
  const uncalibratedHazards = data.hazards.filter(x => x.realPos === null);
  const uncalibratedPaths = data.paths.filter(x => x.realPoints === null);
  const uncalibratedItems = data.items.filter(x => x.realPos === null);
  assert.ok(uncalibratedHazards.length + uncalibratedPaths.length + uncalibratedItems.length > 0,
    'fixture must exercise the explicit uncalibrated state');
});
