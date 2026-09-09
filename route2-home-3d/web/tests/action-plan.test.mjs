import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function json(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

test('family action fixture uses explicit rescan closure rules', async () => {
  const plan = await json('../public/data/family-action-plan.json');
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.type, 'person-home-action-plan');
  assert.equal(plan.status, 'open');
  assert.ok(plan.actions.length > 0);

  for (const action of plan.actions) {
    assert.equal(action.requiresRescan, true);
    assert.equal(action.closureRule.type, 'risk-disappears-after-rescan');
    assert.equal(action.closureRule.riskId, action.riskId);
    assert.equal(action.status, 'open');
  }
});

test('rescan fixture keeps an unresolved risk while allowing another risk to disappear', async () => {
  const plan = await json('../public/data/family-action-plan.json');
  const rescan = await json('../public/data/family-action-rescan.json');
  const active = new Set(rescan.risks.map((risk) => risk.id));

  const surface = plan.actions.find((action) => action.riskId === 'person-home-surface');
  const night = plan.actions.find((action) => action.riskId === 'person-home-night-route');
  assert.ok(surface);
  assert.ok(night);
  assert.equal(active.has(surface.riskId), false);
  assert.equal(active.has(night.riskId), true);
});
