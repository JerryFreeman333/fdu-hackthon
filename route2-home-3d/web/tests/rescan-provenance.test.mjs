import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const actionPlanPath = resolve(here, '../src/hometwin/actionPlan.ts');
const mainPath = resolve(here, '../src/main.ts');

async function source(path) {
  return readFile(path, 'utf8');
}

test('frontend action plans require complete rescan provenance before closure', async () => {
  const text = await source(actionPlanPath);
  assert.match(text, /captureId: string/);
  assert.match(text, /reconstructionId: string/);
  assert.match(text, /function parseProvenance/);
  assert.match(text, /禁止自动关闭历史风险/);
  assert.match(text, /resolvedAtProvenance/);
  assert.match(text, /if \(!plan\.provenance\?\.current\)/);
});

test('frontend rescan flow rejects riskId-only fallback', async () => {
  const text = await source(mainPath);
  assert.match(text, /if \(result\.actionPlan\)/);
  assert.match(text, /复扫行动计划缺少完整 provenance/);
  assert.match(text, /复扫服务未返回可验证的行动计划/);
  assert.doesNotMatch(text, /applyRescan\(currentActionPlan, result\.latestRiskIds\)/);
});
