import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(here, '../public/data/semantic-targets.json');

test('Route 2 declares six core semantic categories', async () => {
  const data = JSON.parse(await readFile(path, 'utf8'));
  const categories = data.targets.map(x => x.category);
  assert.deepEqual(categories, ['bed', 'door', 'rug', 'cable', 'threshold', 'toilet']);
  assert.equal(new Set(categories).size, 6);
  for (const target of data.targets) {
    assert.ok(target.label);
    assert.ok(Array.isArray(target.prompts) && target.prompts.length >= 1);
  }
});
