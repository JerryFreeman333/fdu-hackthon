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

async function source(path) {
  return readFile(path, 'utf8');
}

test('frontend action plans require complete rescan provenance before closure', async () => {
  const text = await source(actionPlanPath);
  assert.match(text, /captureId: string/);
  assert.match(text, /reconstructionId: string/);
  assert.match(text, /function parseProvenance/);
  assert.match(text, /sameProvenance/);
  assert.match(text, /status === 'resolved'/);
  assert.match(text, /resolvedAtProvenance/);
  assert.match(text, /A resolved rescan-dependent action is never accepted without a complete/);
  assert.doesNotMatch(text, /export function applyRescan\(/);
});

test('frontend rescan flow rejects riskId-only fallback and duplicate submission', async () => {
  const text = await source(mainPath);
  assert.match(text, /if \(result\.actionPlan\)/);
  assert.match(text, /!parsed\?\.provenance\?\.current/);
  assert.match(text, /rescanInFlight/);
  assert.match(text, /const generation = \+\+rescanGeneration/);
  assert.match(text, /generation !== rescanGeneration/);
  assert.match(text, /复扫服务未返回可验证的行动计划/);
  assert.doesNotMatch(text, /applyRescan\(currentActionPlan, result\.latestRiskIds\)/);
});

test('rescan workflow has no riskId-only closure authority', async () => {
  const text = await source(workflowPath);
  assert.match(text, /applyRescanProjection/);
  assert.match(text, /result: unknown/);
  assert.match(text, /payload\.actionPlan/);
  assert.match(text, /parseHomeSafetyActionPlan/);
  assert.doesNotMatch(text, /import \{ parseHomeSafetyActionPlan, applyRescan \}/);
  assert.doesNotMatch(text, /latestRiskIds/);
  assert.doesNotMatch(text, /applyRescan\(/);
});

test('rescan client validates action plans before exposing them to UI', async () => {
  const text = await source(clientPath);
  assert.match(text, /parseHomeSafetyActionPlan/);
  assert.match(text, /if \(rawActionPlan !== undefined && !actionPlan\)/);
  assert.match(text, /!actionPlan\.provenance\?\.current/);
  assert.match(text, /actionPlan\?: HomeSafetyActionPlan/);
});

test('rescan result validates action-plan provenance and rejects mismatches', async () => {
  const text = await source(resultPath);
  assert.match(text, /parseHomeSafetyActionPlan/);
  assert.match(text, /parseTopLevelProvenance/);
  assert.match(text, /provenanceMatches/);
  assert.match(text, /actionPlan\?\.provenance && topLevelProvenance/);
});