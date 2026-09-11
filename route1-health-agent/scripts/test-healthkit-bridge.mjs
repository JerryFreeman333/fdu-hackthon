import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = String(18000 + Math.floor(Math.random() * 1000));
const token = 'local-test-token';
const temp = await mkdtemp(join(tmpdir(), 'ankang-healthkit-'));
const dataFile = join(temp, 'latest.json');
const endpoint = `http://127.0.0.1:${port}/api/healthkit/measurements`;
const headers = { 'Content-Type': 'application/json', 'X-HealthKit-Bridge-Token': token };
const child = spawn(process.execPath, ['scripts/healthkit-bridge.mjs'], {
  env: {
    ...process.env,
    HEALTHKIT_BRIDGE_PORT: port,
    HEALTHKIT_BRIDGE_HOST: '127.0.0.1',
    HEALTHKIT_BRIDGE_DATA_FILE: dataFile,
    HEALTHKIT_BRIDGE_TOKEN: token,
    HEALTHKIT_MAX_AGE_MINUTES: '30',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const base = {
  userId: '现场测试用户',
  generatedAt: new Date().toISOString(),
  authorizationStatus: 'request-completed',
  deviceName: 'Test iPhone',
};
const measurement = {
  id: 'healthkit-test-1',
  timestamp: '2026-09-12T07:55:00.000Z',
  metric: 'steps',
  value: 6243,
  unit: '步',
  source: 'healthkit',
  confidence: 1,
  visibility: 'private',
  metadata: {
    sourceName: 'Apple Health aggregate',
    deviceName: 'Test Apple Watch',
    aggregation: 'daily cumulativeSum',
  },
};
const secondMeasurement = {
  ...measurement,
  id: 'healthkit-test-2',
  timestamp: '2026-09-10T07:55:00.000Z',
  value: 5000,
};

function post(payload, requestHeaders = headers) {
  return fetch(endpoint, { method: 'POST', headers: requestHeaders, body: JSON.stringify(payload) });
}

function get(query = '', requestHeaders = headers) {
  return fetch(`${endpoint}${query}`, { headers: requestHeaders });
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bridge startup timeout')), 5000);
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('HealthKit bridge listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  const unavailable = await get('?userId=现场测试用户');
  assert.equal(unavailable.status, 503, 'no upload must be unavailable');
  assert.equal((await unavailable.json()).error, 'unavailable');

  const unauthorized = await get('', { 'X-HealthKit-Bridge-Token': 'wrong' });
  assert.equal(unauthorized.status, 401, 'wrong token must be rejected');

  for (const [name, invalidMeasurement] of [
    ['source', { ...measurement, source: 'demo' }],
    ['unit', { ...measurement, unit: 'km' }],
    ['timestamp', { ...measurement, timestamp: 'not-a-date' }],
    ['NaN', { ...measurement, value: Number.NaN }],
    ['Infinity', { ...measurement, value: Number.POSITIVE_INFINITY }],
  ]) {
    const response = await post({ ...base, measurements: [invalidMeasurement] });
    assert.equal(response.status, 400, `${name} must be rejected`);
  }

  const accepted = await post({ ...base, measurements: [measurement, secondMeasurement, measurement] });
  assert.equal(accepted.status, 202);
  const receipt = await accepted.json();
  assert.equal(receipt.accepted, 2, 'duplicate IDs must be stored once');
  assert.equal(receipt.duplicatesRemoved, 1);

  const mismatch = await get('?userId=另一位测试用户');
  assert.equal(mismatch.status, 409, 'wrong user must not look like an empty sample set');
  assert.equal((await mismatch.json()).error, 'user_mismatch');

  const filteredResponse = await get('?userId=现场测试用户&from=2026-09-12&to=2026-09-12');
  assert.equal(filteredResponse.status, 200);
  const filtered = await filteredResponse.json();
  assert.equal(filtered.measurements.length, 1, 'from/to must filter measurements');
  assert.equal(filtered.measurements[0].source, 'healthkit');
  assert.equal(filtered.measurements[0].metadata.deviceName, 'Test Apple Watch');
  assert.equal(filtered.diagnostics.freshness, 'fresh');

  const repeated = await post({ ...base, measurements: [measurement, secondMeasurement] });
  assert.equal(repeated.status, 202);
  assert.equal((await repeated.json()).accepted, 2, 're-uploading the same batch must not multiply stored records');
  const afterRepeat = await get('?userId=现场测试用户&from=2026-09-01&to=2026-09-12');
  assert.equal((await afterRepeat.json()).measurements.length, 2);

  const stored = JSON.parse(await readFile(dataFile, 'utf8'));
  stored.receivedAt = new Date(Date.now() - 31 * 60_000).toISOString();
  await writeFile(dataFile, JSON.stringify(stored), 'utf8');
  const stale = await get('?userId=现场测试用户');
  assert.equal(stale.status, 409, 'old upload must not be returned as current data');
  const stalePayload = await stale.json();
  assert.equal(stalePayload.error, 'stale_data');
  assert.equal(stalePayload.diagnostics.freshness, 'stale');

  console.log('PASS: HealthKit bridge validation, freshness, token, user isolation, filtering and dedup');
} finally {
  child.kill('SIGTERM');
  await rm(temp, { recursive: true, force: true });
}
