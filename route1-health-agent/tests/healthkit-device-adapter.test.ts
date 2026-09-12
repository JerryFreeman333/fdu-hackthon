import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HealthKitAdapterError,
  HealthKitDeviceAdapter,
  type HealthKitBridgeDiagnostics,
} from '../src/adapters/HealthKitDeviceAdapter';
import { measurementToEvent, mergeHealthEvents } from '../src/pipeline/events';
import {
  healthKitRevisionKey,
  shouldPollHealthKit,
  shouldRefreshHealthKit,
} from '../src/healthkit/autoSync';

const validMeasurement = {
  id: 'healthkit-uuid-1',
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
    healthkitUuid: 'uuid-1',
  },
};

const diagnostics: HealthKitBridgeDiagnostics = {
  revision: 1,
  updatedAt: '2026-09-12T08:00:00.000Z',
  authorizationStatus: 'request-completed',
  receivedAt: '2026-09-12T08:00:00.000Z',
  generatedAt: '2026-09-12T07:59:00.000Z',
  sampleCount: 1,
  deviceName: 'Test iPhone',
  freshness: 'fresh',
  ageMinutes: 1,
  maxAgeMinutes: 30,
};

async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function expectCode(action: () => Promise<unknown>, code: HealthKitAdapterError['code']) {
  await assert.rejects(action, (error: unknown) => error instanceof HealthKitAdapterError && error.code === code);
}

test('valid payload preserves provenance and sends optional token', async () => {
  await withFetch(
    async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>)['X-HealthKit-Bridge-Token'], 'secret');
      return jsonResponse({ measurements: [validMeasurement], diagnostics });
    },
    async () => {
      const adapter = new HealthKitDeviceAdapter('http://localhost:8787/api/healthkit/measurements', 'secret');
      const result = await adapter.getMeasurements('现场测试用户', '2026-09-01', '2026-09-30');
      assert.equal(result.length, 1);
      assert.equal(result[0].source, 'healthkit');
      assert.equal(result[0].metadata?.healthkitUuid, 'uuid-1');
      assert.equal(result[0].metadata?.aggregation, 'daily cumulativeSum');
      assert.equal(adapter.lastDiagnostics?.freshness, 'fresh');
    },
  );
});

test('diagnostics polling uses its lightweight endpoint and preserves revision', async () => {
  await withFetch(
    async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('diagnostics'), '1');
      assert.equal(url.searchParams.get('userId'), '现场测试用户');
      assert.equal(url.searchParams.has('from'), false);
      return jsonResponse({ diagnostics });
    },
    async () => {
      const result = await new HealthKitDeviceAdapter('http://localhost/test').getDiagnostics('现场测试用户');
      assert.equal(result.revision, 1);
    },
  );
});

test('auto-sync gate refreshes only for a changed fresh revision marker', () => {
  const firstKey = healthKitRevisionKey(diagnostics);
  assert.equal(shouldRefreshHealthKit(undefined, diagnostics), true, 'first fresh upload triggers synchronization');
  assert.equal(shouldRefreshHealthKit(firstKey, diagnostics), false, 'unchanged revision does not repeat synchronization');
  assert.equal(shouldRefreshHealthKit(firstKey, { ...diagnostics, revision: 2 }), true, 'changed revision triggers');
  assert.equal(
    shouldRefreshHealthKit(firstKey, { ...diagnostics, freshness: 'stale', revision: 2 }),
    false,
    'stale diagnostics never refresh Person Twin',
  );
  assert.equal(shouldPollHealthKit('healthkit'), true);
  assert.equal(shouldPollHealthKit('demo'), false, 'non-healthkit mode does not poll');
});

for (const [name, changed] of [
  ['source', { source: 'demo' }],
  ['unknown metric', { metric: 'unknownMetric' }],
  ['wrong unit', { unit: 'km' }],
] as const) {
  test(`rejects ${name}`, async () => {
    await withFetch(
      async () => jsonResponse({ measurements: [{ ...validMeasurement, ...changed }], diagnostics }),
      async () => {
        const adapter = new HealthKitDeviceAdapter('http://localhost/test');
        await expectCode(() => adapter.getMeasurements('u', '2026-09-01', '2026-09-30'), 'invalid-response');
      },
    );
  });
}

test('rejects missing measurements and malformed JSON', async () => {
  await withFetch(
    async () => jsonResponse({ diagnostics }),
    async () => {
      await expectCode(
        () => new HealthKitDeviceAdapter('http://localhost/test').getMeasurements('u', '2026-09-01', '2026-09-30'),
        'invalid-response',
      );
    },
  );
  await withFetch(
    async () => new Response('{broken', { status: 200 }),
    async () => {
      await expectCode(
        () => new HealthKitDeviceAdapter('http://localhost/test').getMeasurements('u', '2026-09-01', '2026-09-30'),
        'invalid-response',
      );
    },
  );
});

test('maps unavailable, stale, user mismatch and unauthorized responses', async () => {
  for (const [status, body, code] of [
    [503, { error: 'unavailable', message: 'no upload' }, 'unavailable'],
    [409, { error: 'stale_data', message: 'old data', diagnostics: { ...diagnostics, freshness: 'stale' } }, 'stale'],
    [409, { error: 'user_mismatch', message: 'wrong user', diagnostics }, 'user-mismatch'],
    [401, { error: 'unauthorized', message: 'wrong token' }, 'unauthorized'],
  ] as const) {
    await withFetch(
      async () => jsonResponse(body, status),
      async () => {
        const adapter = new HealthKitDeviceAdapter('http://localhost/test');
        await expectCode(() => adapter.getMeasurements('u', '2026-09-01', '2026-09-30'), code);
        if (code === 'stale') assert.equal(adapter.lastDiagnostics?.freshness, 'stale');
      },
    );
  }
});

test('maps network failure and rejects an empty filtered sample set without fallback', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      throw new TypeError('connection refused');
    },
    async () => {
      await expectCode(
        () => new HealthKitDeviceAdapter('http://localhost/test').getMeasurements('u', '2026-09-01', '2026-09-30'),
        'network',
      );
    },
  );
  assert.equal(calls, 1, 'adapter must not make a second Demo fallback request');

  await withFetch(
    async () => jsonResponse({ measurements: [], diagnostics }),
    async () => {
      await expectCode(
        () => new HealthKitDeviceAdapter('http://localhost/test').getMeasurements('u', '2026-09-01', '2026-09-30'),
        'no-samples',
      );
    },
  );
});

test('repeated synchronization keeps one HealthEvent per HealthKit ID', async () => {
  await withFetch(
    async () => jsonResponse({ measurements: [validMeasurement], diagnostics }),
    async () => {
      const adapter = new HealthKitDeviceAdapter('http://localhost/test');
      const first = await adapter.getMeasurements('u', '2026-09-01', '2026-09-30');
      const second = await adapter.getMeasurements('u', '2026-09-01', '2026-09-30');
      const once = mergeHealthEvents([], first.map(measurementToEvent));
      const twice = mergeHealthEvents(once, second.map(measurementToEvent));
      assert.equal(once.length, 1);
      assert.equal(twice.length, 1);
    },
  );
});
