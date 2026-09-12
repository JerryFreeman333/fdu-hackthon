import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(root, '.env.local'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const port = Number.parseInt(process.env.HEALTHKIT_BRIDGE_PORT ?? '8787', 10);
const host = process.env.HEALTHKIT_BRIDGE_HOST ?? '0.0.0.0';
const bridgeToken = process.env.HEALTHKIT_BRIDGE_TOKEN?.trim() ?? '';
const maxAgeMinutes = Number(process.env.HEALTHKIT_MAX_AGE_MINUTES ?? '30');
if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) {
  throw new Error('HEALTHKIT_MAX_AGE_MINUTES 必须是大于 0 的分钟数');
}
const dataFile = process.env.HEALTHKIT_BRIDGE_DATA_FILE
  ? resolve(process.env.HEALTHKIT_BRIDGE_DATA_FILE)
  : resolve(root, '.healthkit-data', 'latest.json');
const metrics = new Set(['steps', 'restingHr', 'sleepHours', 'walkSpeed', 'spo2', 'weight', 'systolic', 'diastolic']);
const units = {
  steps: '步',
  restingHr: 'bpm',
  sleepHours: '小时',
  walkSpeed: 'm/s',
  spo2: '%',
  weight: 'kg',
  systolic: 'mmHg',
  diastolic: 'mmHg',
};

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-HealthKit-Bridge-Token',
    'Cache-Control': 'no-store',
  });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 5_000_000) throw new Error('请求体超过 5MB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validMeasurement(item) {
  return (
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    typeof item.timestamp === 'string' &&
    !Number.isNaN(Date.parse(item.timestamp)) &&
    metrics.has(item.metric) &&
    typeof item.value === 'number' &&
    Number.isFinite(item.value) &&
    item.unit === units[item.metric] &&
    item.source === 'healthkit'
  );
}

function dedupeMeasurements(measurements) {
  const byId = new Map();
  for (const measurement of measurements) byId.set(measurement.id, measurement);
  return [...byId.values()];
}

function diagnosticsFor(stored, now = Date.now()) {
  const receivedTime = Date.parse(stored.receivedAt);
  const ageMinutes = Number.isFinite(receivedTime)
    ? Math.max(0, (now - receivedTime) / 60_000)
    : Number.POSITIVE_INFINITY;
  return {
    revision: Number.isSafeInteger(stored.revision) && stored.revision >= 0 ? stored.revision : 0,
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : stored.receivedAt,
    authorizationStatus: stored.authorizationStatus,
    receivedAt: stored.receivedAt,
    generatedAt: stored.generatedAt,
    sampleCount: stored.measurements.length,
    deviceName: stored.deviceName,
    freshness: ageMinutes <= maxAgeMinutes ? 'fresh' : 'stale',
    ageMinutes: Number.isFinite(ageMinutes) ? Math.round(ageMinutes * 10) / 10 : null,
    maxAgeMinutes,
  };
}

function hasValidToken(request) {
  return !bridgeToken || request.headers['x-healthkit-bridge-token'] === bridgeToken;
}

async function loadPayload() {
  try {
    return JSON.parse(await readFile(dataFile, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {});
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/health') return send(response, 200, { ok: true, service: 'healthkit-bridge' });
  if (url.pathname !== '/api/healthkit/measurements') return send(response, 404, { error: 'not_found' });
  if (!hasValidToken(request))
    return send(response, 401, { error: 'unauthorized', message: 'HealthKit bridge token 错误或缺失' });

  try {
    if (request.method === 'POST') {
      const payload = await readBody(request);
      if (!payload || typeof payload.userId !== 'string' || !Array.isArray(payload.measurements)) {
        return send(response, 400, { error: 'payload 必须包含 userId 和 measurements[]' });
      }
      if (!payload.userId.trim()) return send(response, 400, { error: 'userId 不能为空' });
      if (typeof payload.generatedAt !== 'string' || Number.isNaN(Date.parse(payload.generatedAt))) {
        return send(response, 400, { error: 'generatedAt 必须是有效时间戳' });
      }
      if (!payload.measurements.every(validMeasurement)) {
        return send(response, 400, { error: '存在无效测量：必须是 source=healthkit、标准单位、有效时间戳和有限数值' });
      }
      const measurements = dedupeMeasurements(payload.measurements);
      const previous = await loadPayload();
      const previousRevision =
        Number.isSafeInteger(previous?.revision) && previous.revision >= 0 ? previous.revision : 0;
      const receivedAt = new Date().toISOString();
      const stored = {
        schemaVersion: 1,
        revision: previousRevision + 1,
        userId: payload.userId,
        generatedAt: payload.generatedAt,
        authorizationStatus: ['not-requested', 'request-completed', 'limited-or-no-data'].includes(
          payload.authorizationStatus,
        )
          ? payload.authorizationStatus
          : 'unknown',
        deviceName: typeof payload.deviceName === 'string' ? payload.deviceName : undefined,
        receivedAt,
        updatedAt: receivedAt,
        measurements,
      };
      await mkdir(dirname(dataFile), { recursive: true });
      await writeFile(dataFile, JSON.stringify(stored, null, 2), 'utf8');
      return send(response, 202, {
        accepted: stored.measurements.length,
        receivedAt: stored.receivedAt,
        updatedAt: stored.updatedAt,
        revision: stored.revision,
        duplicatesRemoved: payload.measurements.length - measurements.length,
      });
    }

    if (request.method === 'GET') {
      const stored = await loadPayload();
      if (!stored)
        return send(response, 503, { error: 'unavailable', message: '尚未收到 iPhone 上传的 HealthKit 数据' });
      const diagnostics = diagnosticsFor(stored);
      const userId = url.searchParams.get('userId');
      if (userId && userId !== stored.userId) {
        return send(response, 409, {
          error: 'user_mismatch',
          message: '当前桥接数据属于另一测试用户，请重新上传或检查测试用户 ID。',
          diagnostics,
        });
      }
      if (diagnostics.freshness === 'stale') {
        return send(response, 409, {
          error: 'stale_data',
          message: `HealthKit 数据已过期，上次上传时间为 ${stored.receivedAt}，请重新从 iPhone 同步。`,
          diagnostics,
        });
      }
      if (url.searchParams.get('diagnostics') === '1') {
        return send(response, 200, { diagnostics });
      }
      const from = url.searchParams.get('from') ?? '0000-01-01';
      const to = url.searchParams.get('to') ?? '9999-12-31';
      const filtered = stored.measurements.filter((item) => {
        const date = item.timestamp.slice(0, 10);
        return date >= from && date <= to;
      });
      return send(response, 200, {
        measurements: filtered,
        diagnostics: { ...diagnostics, sampleCount: filtered.length },
      });
    }
    return send(response, 405, { error: 'method_not_allowed' });
  } catch (error) {
    return send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`HealthKit bridge listening on http://${host}:${port}\n`);
  process.stdout.write(`Freshness limit: ${maxAgeMinutes} minutes\n`);
  if (!bridgeToken) {
    process.stdout.write(
      'WARNING: HealthKit bridge is running without authentication. Use only on a trusted local network.\n',
    );
  } else {
    process.stdout.write('HealthKit bridge token protection is enabled.\n');
  }
  process.stdout.write(`iPhone upload URL: http://<电脑局域网IP>:${port}/api/healthkit/measurements\n`);
});
