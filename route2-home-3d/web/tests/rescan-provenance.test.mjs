import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const actionPlanPath = resolve(here, '../src/hometwin/actionPlan.ts');
const mainPath = resolve(here, '../src/main.ts');
const workflowPath = resolve(here, '../src/hometwin/rescanWorkflow.ts');
const clientPath = resolve(here, '../src/hometwin/rescanClient.ts');
const resultPath = resolve(here, '../src/hometwin/rescanResult.ts');
const fixturePath = resolve(here, '../public/data/family-action-plan.json');
const execFileAsync = promisify(execFile);

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

test('snapshot acceptance rejects stale and replayed results even after a newer snapshot was accepted', async () => {
  const text = await source(actionPlanPath);
  assert.match(text, /candidate\.homeVersion <= previous\.homeVersion/);
  assert.match(text, /candidatePlan\.provenance\?\.previous/);
  assert.match(text, /candidate previous provenance does not match current snapshot/);
  assert.match(text, /captureId === previous\.captureId/);
  assert.match(text, /reconstructionId === previous\.reconstructionId/);
});

test('compiled actionPlan enforces N→N+2 accepted then delayed N+1 rejected', async () => {
  const output = resolve(tmpdir(), `route2-actionPlan-${process.pid}-${Date.now()}.mjs`);
  try {
    await execFileAsync(resolve(here, '../node_modules/.bin/esbuild'), [
      actionPlanPath, '--format=esm', '--platform=neutral', '--outfile=' + output,
    ]);
    const { parseHomeSafetyActionPlan, acceptRescanActionPlan } = await import(output + `?t=${Date.now()}`);
    const provenance = (homeVersion, captureId, reconstructionId, previous = null) => ({
      current: { homeId: 'home-a', homeVersion, riskRuleVersion: 'rule-v1', captureId, reconstructionId },
      previous,
    });
    const plan = (p) => parseHomeSafetyActionPlan({
      schemaVersion: 1, type: 'person-home-action-plan', status: 'open', privacyScope: 'local-device',
      actions: [], provenance: p,
    });
    const n = plan(provenance(1, 'capture-n', 'recon-n'));
    const n1 = plan(provenance(2, 'capture-n1', 'recon-n1', n?.provenance.current));
    const n2 = plan(provenance(3, 'capture-n2', 'recon-n2', n1?.provenance.current));
    assert.ok(n && n1 && n2);
    assert.deepEqual(acceptRescanActionPlan(n, n1), { accepted: true });
    assert.deepEqual(acceptRescanActionPlan(n1, n2), { accepted: true });
    assert.match(acceptRescanActionPlan(n2, n1).reason, /candidate snapshot 不是更新版本/);
    assert.match(acceptRescanActionPlan(n2, n2).reason, /candidate snapshot 不是更新版本/);
  } finally {
    await rm(output, { force: true });
  }
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

test('rescan workflow chains from the latest accepted snapshot rather than the original baseline', async () => {
  const text = await source(workflowPath);
  assert.match(text, /const baselinePlan = state\.currentPlan \?\? state\.previousPlan/);
  assert.match(text, /acceptRescanActionPlan\(baselinePlan, currentPlan\)/);
  assert.match(text, /currentPlan,/);
  assert.match(text, /sanitizeRestoredWorkflow/);
  assert.match(text, /Browser storage is not a trust boundary/);
  assert.doesNotMatch(text, /latestRiskIds/);
  assert.doesNotMatch(text, /applyRescan\(/);
});

test('rescan workflow has no riskId-only closure authority and sanitizes reload state', async () => {
  const text = await source(workflowPath);
  assert.match(text, /safeStatus: RescanWorkflowStatus/);
  assert.match(text, /restoredStatus === 'processing'/);
  assert.doesNotMatch(text, /ready-for-review.*restoredStatus/);
  assert.doesNotMatch(text, /resolved.*restoredStatus/);
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
