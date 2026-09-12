import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const web = fileURLToPath(new URL('../', import.meta.url));
const compiled = mkdtempSync(path.join(tmpdir(), 'route2-provenance-'));
after(() => rmSync(compiled, { recursive: true, force: true }));
execFileSync(process.execPath, [
  path.join(web, 'node_modules/typescript/bin/tsc'),
  '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
  '--skipLibCheck', '--strict', '--outDir', compiled,
  ...['actionPlan', 'rescanWorkflow', 'rescanResult', 'rescanClient'].map(name => path.join(web, 'src/hometwin/' + name + '.ts')),
], { cwd: web, windowsHide: true });
const require = createRequire(import.meta.url);
const { parseHomeSafetyActionPlan: parse, acceptRescanActionPlan: accept } = require(path.join(compiled, 'actionPlan.js'));
const { applyRescanProjection: apply, createInitialRescanWorkflow: initial, sanitizeRestoredWorkflow: restore } = require(path.join(compiled, 'rescanWorkflow.js'));
const { parseRescanResult } = require(path.join(compiled, 'rescanResult.js'));
const { getRescanJob } = require(path.join(compiled, 'rescanClient.js'));

const source = version => ({
  homeId: 'home-1', homeVersion: version, riskRuleVersion: 'person-home-risk-v1',
  captureId: 'capture-' + version, reconstructionId: 'reconstruction-' + version,
});
function plan(version = 1, status = 'open') {
  return {
    schemaVersion: 1, type: 'person-home-action-plan', status: status === 'resolved' ? 'clear' : 'open',
    privacyScope: 'family_ok', provenance: { current: source(version), previous: version === 1 ? null : source(version - 1) },
    actions: [{ id: 'action-1', riskId: 'risk-1', kind: 'safety_check', title: '复核', description: '处理后复扫',
      status, requiresRescan: true, closureRule: { type: 'risk-disappears-after-rescan', riskId: 'risk-1' },
      ...(status === 'resolved' ? { resolvedAtProvenance: source(version) } : {}),
    }],
  };
}

test('current backend family_ok/private schema remains supported; malformed actions never disappear silently', () => {
  assert.ok(parse(plan()));
  assert.ok(parse({ ...plan(), privacyScope: 'private' }));
  assert.equal(parse({ ...plan(), actions: [null] }), null);
  assert.equal(parse({ ...plan(), status: 'clear' }), null);
  const duplicate = plan(); duplicate.actions.push({ ...duplicate.actions[0] });
  assert.equal(parse(duplicate), null);
});

test('resolved actions require complete matching reconstruction provenance', () => {
  const value = plan(2, 'resolved');
  assert.ok(parse(value));
  delete value.actions[0].resolvedAtProvenance;
  assert.equal(parse(value), null);
  const blank = plan(2, 'resolved'); blank.provenance.current.captureId = '';
  assert.equal(parse(blank), null);
});

test('only a newer same-household snapshot chained to the current plan is accepted', () => {
  assert.equal(accept(plan(1), plan(2, 'resolved')).accepted, true);
  for (const modify of [
    p => { p.provenance.current.homeId = 'other'; },
    p => { p.provenance.current.homeVersion = 1; },
    p => { p.provenance.current.captureId = 'capture-1'; },
    p => { p.provenance.current.reconstructionId = 'reconstruction-1'; },
    p => { p.provenance.current.riskRuleVersion = 'different'; },
    p => { p.provenance.previous = null; },
    p => { p.actions = []; p.status = 'clear'; },
  ]) {
    const next = plan(2); modify(next);
    assert.equal(accept(plan(1), next).accepted, false);
  }
});

test('risk-id-only response cannot resolve anything, and accepted snapshots become the next baseline', () => {
  const state = { ...initial(), previousPlan: plan(1) };
  assert.equal(apply(state, []).status, 'failed');
  assert.equal(apply(state, { latestRiskIds: [] }).currentPlan, null);
  const second = apply(state, { actionPlan: plan(2, 'resolved') });
  assert.equal(second.status, 'ready-for-review');
  assert.equal(apply(second, { actionPlan: plan(2, 'resolved') }).status, 'failed');
  assert.equal(apply(second, { actionPlan: plan(3, 'resolved') }).status, 'ready-for-review');
  const staleBase = plan(3, 'resolved'); staleBase.provenance.previous = source(1);
  assert.equal(apply(second, { actionPlan: staleBase }).status, 'failed');
  assert.deepEqual(restore(second), initial());
});

test('ready queue acknowledgement without inference is valid, but invalid/in-progress plans are rejected', async () => {
  const response = { schemaVersion: 1, type: 'home-twin-rescan-result', status: 'ready' };
  assert.ok(parseRescanResult(response));
  assert.ok(parseRescanResult({ ...response, actionPlan: plan(2, 'resolved') }));
  assert.equal(parseRescanResult({ ...response, actionPlan: { actions: [] } }), null);
  assert.equal(parseRescanResult({ ...response, status: 'processing', actionPlan: plan() }), null);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'ready', actionPlan: { actions: [] } }));
    await assert.rejects(() => getRescanJob('test'), /无效行动计划/);
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'ready', message: '素材已接收' }));
    assert.equal((await getRescanJob('test')).actionPlan, undefined);
  } finally { globalThis.fetch = original; }
});
