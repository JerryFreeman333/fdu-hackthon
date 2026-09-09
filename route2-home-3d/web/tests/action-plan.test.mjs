import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadModule() {
  const source = await readFile(new URL('../src/hometwin/actionPlan.ts', import.meta.url), 'utf8');
  const dataUrl = 'data:text/javascript,' + encodeURIComponent(source.replace(/: HomeSafetyActionPlan|: HomeSafetyActionPlan \| null|: Iterable<string>|: string|: boolean|: number|: HomeSafetyActionStatus/g, ''));
  return import(dataUrl);
}

test('action plan contract contains rescan closure rule', async () => {
  const { parseHomeSafetyActionPlan, applyRescan } = await loadModule();
  const plan = parseHomeSafetyActionPlan({
    schemaVersion: 1,
    type: 'person-home-action-plan',
    status: 'open',
    privacyScope: 'family_ok',
    actions: [{
      id: 'action-r1',
      riskId: 'r1',
      kind: 'safety_check',
      title: '处理地面障碍',
      description: '处理并重新扫描',
      status: 'open',
      requiresRescan: true,
      closureRule: { type: 'risk-disappears-after-rescan', riskId: 'r1' },
    }],
  });
  assert.ok(plan);
  const cleared = applyRescan(plan, []);
  assert.equal(cleared.status, 'clear');
  assert.equal(cleared.actions[0].status, 'resolved');
});
