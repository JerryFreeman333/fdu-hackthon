import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = String(18000 + Math.floor(Math.random() * 1000));
const temp = await mkdtemp(join(tmpdir(), 'ankang-healthkit-'));
const endpoint = `http://127.0.0.1:${port}/api/healthkit/measurements`;
const child = spawn(process.execPath, ['scripts/healthkit-bridge.mjs'], {
  env: { ...process.env, HEALTHKIT_BRIDGE_PORT: port, HEALTHKIT_BRIDGE_HOST: '127.0.0.1', HEALTHKIT_BRIDGE_DATA_FILE: join(temp, 'latest.json') },
  stdio: ['ignore', 'pipe', 'inherit'],
});

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bridge startup timeout')), 5000);
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('HealthKit bridge listening')) { clearTimeout(timer); resolve(); }
    });
  });

  const base = {
    userId: '现场测试用户', generatedAt: '2026-09-12T08:00:00.000Z', authorizationStatus: 'request-completed', deviceName: 'Test iPhone',
  };
  const measurement = {
    id: 'healthkit-test-1', timestamp: '2026-09-12T07:55:00.000Z', metric: 'steps', value: 6243,
    unit: '步', source: 'healthkit', confidence: 1, visibility: 'private', metadata: { sourceName: 'Apple Health aggregate' },
  };
  const invalid = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, measurements: [{ ...measurement, source: 'demo' }] }) });
  assert.equal(invalid.status, 400, 'bridge must reject data pretending to be HealthKit');

  const accepted = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, measurements: [measurement] }) });
  assert.equal(accepted.status, 202);
  assert.equal((await accepted.json()).accepted, 1);

  const response = await fetch(`${endpoint}?userId=${encodeURIComponent(base.userId)}&from=2026-09-01&to=2026-09-12`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.measurements.length, 1);
  assert.equal(payload.measurements[0].source, 'healthkit');
  assert.equal(payload.diagnostics.authorizationStatus, 'request-completed');
  console.log('PASS: HealthKit bridge provenance validation, upload and filtered read');
} finally {
  child.kill('SIGTERM');
  await rm(temp, { recursive: true, force: true });
}
