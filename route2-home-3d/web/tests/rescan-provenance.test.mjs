import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const actionPlanPath = resolve(here, '../src/hometwin/actionPlan.ts');
const mainPath = resolve(here, '../src/main.ts');
const workflowPath = resolve(here, '../src/hometwin/rescanWorkflow.ts');
const clientPath = resolve(here, '../src/hometwin/rescanClient.ts');
const resultPath = resolve(here, '../src/hometwin/rescanResult.ts');
const fixturePath = resolve(here, '../public/data/family-action-plan.json');

async function source(path) { return readFile(path, 'utf8'); }

test('frontend action plans require complete rescan provenance before closure', async () => {
  const text = await source(actionPlanPath);
  assert.match(text, /captureId: string/);
  assert.match(text, /reconstructionId: string/);
  assert.match(text, /sameProvenance/);
  assert.match(text, /acceptRescanActionPlan/);
  assert.match(text, /candidate snapshot 不是更新版本/);
  assert.match(text, /resolvedAtProvenance/);
  assert.doesNotMatch(text, /export function applyRescan\(/);
});

test('frontend rescan flow rejects riskId-only fallback, duplicate and stale responses', async () => {
  const text = await source(mainPath);
  assert.match(text, /rescanInFlight/);
  assert.match(text, /const generation = \+\+rescanGeneration/);
  assert.match(text, /generation !== rescanGeneration/);
  assert.match(text, /acceptRescanActionPlan\(currentActionPlan, parsed\)/);
  assert.match(text, /拒绝覆盖当前风险\/行动状态/);
  assert.doesNotMatch(text, /applyRescan\(currentActionPlan, result\.latestRiskIds\)/);
});

test('rescan workflow has no riskId-only closure authority and sanitizes reload state', async () => {
  const text = await source(workflowPath);
  assert.match(text, /sanitizeRestoredWorkflow/);
  assert.match(text, /Browser storage is not a trust boundary/);
  assert.match(text, /acceptRescanActionPlan\(state\.previousPlan, currentPlan\)/);
  assert.doesNotMatch(text, /latestRiskIds/);
  assert.doesNotMatch(text, /applyRescan\(/);
});

test('rescan client validates action plans before exposing them to UI', async () => {
  const text = await source(clientPath);
  assert.match(text, /parseHomeSafetyActionPlan/);
  assert.match(text, /if \(rawActionPlan !== undefined && !actionPlan\)/);
  assert.match(text, /缺少当前 provenance/);
  assert.match(text, /actionPlan\?: HomeSafetyActionPlan/);
});

test('rescan result validates top-level and embedded provenance', async () => {
  const text = await source(resultPath);
  assert.match(text, /parseHomeSafetyActionPlan/);
  assert.match(text, /parseTopLevelProvenance/);
  assert.match(text, /provenanceMatches/);
  assert.match(text, /actionPlan\?\.provenance && topLevelProvenance/);
});

test('demo baseline is bound to an explicit Home Twin snapshot', async () => {
  const plan = JSON.parse(await source(fixturePath));
  assert.equal(plan.provenance.current.homeId, 'demo-home-001');
  assert.equal(plan.provenance.current.homeVersion, 1);
  assert.equal(plan.provenance.current.riskRuleVersion, 'person-home-risk-v1');
  assert.equal(plan.provenance.current.captureId, 'demo-capture-001');
  assert.equal(plan.provenance.current.reconstructionId, 'demo-reconstruction-001');
});
