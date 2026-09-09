import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plannerPath = resolve(here, '../src/hometwin/routePlanner.ts');

async function planner() {
  return readFile(plannerPath, 'utf8');
}

test('route planner exposes an explicit eligibility gate', async () => {
  const source = await planner();
  assert.match(source, /export function assessRouteEligibility/);
  assert.match(source, /beds\.length !== 1 \|\| toilets\.length !== 1/);
  assert.match(source, /MIN_ENDPOINT_CONFIDENCE/);
  assert.match(source, /MIN_RELATION_CONFIDENCE/);
  assert.match(source, /relation\.relation === 'blocks'/);
  assert.match(source, /connectingRelations\.length === 0/);
  assert.match(source, /assessRouteEligibility\(snapshot\)/);
});

test('route planner does not claim an unexplained safe route', async () => {
  const source = await planner();
  assert.match(source, /可解释路线/);
  assert.match(source, /暂不生成路线/);
  assert.doesNotMatch(source, /title: '安全路线'/);
});
