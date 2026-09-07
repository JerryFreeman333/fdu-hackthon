import { records as demoRecords, seedObservations, TODAY, profile } from '../src/data/demo';
import type { DayRecord, Finding, HealthMeasurement, Observation } from '../src/types';
import { dayRecordsToMeasurements, measurementsToDayRecords } from '../src/data/normalize';
import { mergeHealthEvents, measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import { runDetection } from '../src/engine/detect';
import { buildAgentContext } from '../src/engine/context';
import { createHttpLlmAdapter, generateAgentReply, isSafeAgentReply, type LlmAdapter } from '../src/engine/agent';
import { createTaskFromFinding } from '../src/engine/tasks';
import { collectFamilyNotifications } from '../src/engine/escalate';
import { extractHealthValues } from '../src/engine/extract';
import { canShareWithFamily, parsePrivacyIntent } from '../src/engine/privacy';
import { buildWeeklyReport } from '../src/engine/report';
import { demoImageHealthParser } from '../src/adapters/DemoImageHealthParser';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dateFromToday(offset: number): string {
  return new Date(Date.parse(TODAY) + offset * 86400000).toISOString().slice(0, 10);
}

function makeStableRecords(metric: keyof DayRecord['metrics'], value: number): DayRecord[] {
  return Array.from({ length: 18 }, (_, index) => ({
    date: dateFromToday(index - 18),
    metrics: { [metric]: value },
  }));
}

function observation(
  tag: Observation['tags'][number],
  text: string,
  visibility: Observation['visibility'],
): Observation {
  return { id: `hardening-${tag}-${visibility}`, date: TODAY, source: 'chat', text, tags: [tag], visibility };
}

function eventsFrom(records: DayRecord[], observations: Observation[] = []): HealthEvent[] {
  return mergeHealthEvents(
    dayRecordsToMeasurements(records, 'demo').map(measurementToEvent),
    observations.map(observationToEvent),
  );
}

async function main(): Promise<void> {
  console.log(`PASS: demo TODAY is generated at runtime (${TODAY})`);
  assert(!Number.isNaN(Date.parse(TODAY)), 'TODAY must be an ISO date');

  const privateMeasurement: HealthMeasurement = {
    id: 'private-steps',
    timestamp: `${TODAY}T09:00:00`,
    metric: 'steps',
    value: 3200,
    unit: '步',
    source: 'chat',
    visibility: 'private',
  };
  const sharedMeasurement: HealthMeasurement = {
    ...privateMeasurement,
    id: 'shared-steps',
    value: 7200,
    visibility: 'family_ok',
  };
  const sharedOnlyRecords = measurementsToDayRecords([sharedMeasurement]);
  const familyRecords = measurementsToDayRecords([privateMeasurement, sharedMeasurement]);
  assert(sharedOnlyRecords[0]?.metrics.steps === 7200, 'shared measurement should be representable');
  assert(
    familyRecords[0]?.measurements?.some((measurement) => measurement.visibility === 'private'),
    'materialization should preserve private measurement metadata for local-only views',
  );

  assert(parsePrivacyIntent('这次数值不要告诉孩子') === 'private', 'private intent should be conservative');
  assert(parsePrivacyIntent('这次告诉女儿') === 'share_family', 'single-share intent should be recognized');
  assert(
    canShareWithFamily('denied', 'share_family'),
    'an explicit one-time share may override the persistent default',
  );
  assert(!canShareWithFamily('ask', 'none'), 'ask must not silently become shared');

  const oneTimeFinding: Finding = {
    id: 'finding-one-time-share',
    date: TODAY,
    severity: 'alert',
    title: '需要关注的变化',
    detail: 'demo',
    evidence: ['demo'],
    familyMessage: '请联系老人确认情况',
    carePath: '联系老人',
    familyEligible: true,
  };
  assert(
    collectFamilyNotifications([oneTimeFinding], 'ask', ['finding-one-time-share']).length === 1,
    'explicitly shared finding should notify family once even while persistent sharing remains ask',
  );
  assert(collectFamilyNotifications([oneTimeFinding], 'ask').length === 0, 'ask still blocks unshared findings');

  const privateBpEvents: HealthEvent[] = [
    measurementToEvent({
      id: 'private-sys',
      timestamp: `${TODAY}T09:00:00`,
      metric: 'systolic',
      value: 185,
      unit: 'mmHg',
      source: 'chat',
      visibility: 'private',
    }),
    measurementToEvent({
      id: 'private-dia',
      timestamp: `${TODAY}T09:00:00`,
      metric: 'diastolic',
      value: 121,
      unit: 'mmHg',
      source: 'chat',
      visibility: 'private',
    }),
  ];
  const privateBpFindings = runDetection(privateBpEvents, TODAY);
  const privateBpFinding = privateBpFindings.find(
    (finding) => finding.ruleId === 'safety.blood_pressure.severe_reading',
  );
  assert(privateBpFinding?.severity === 'alert', 'private severe BP should still alert the elder locally');
  assert(privateBpFinding?.familyEligible === false, 'private BP should not become a family notification');
  assert(
    collectFamilyNotifications(privateBpFindings, 'granted').length === 0,
    'private BP must not reach family notifications',
  );

  const zeroVariance = makeStableRecords('spo2', 96);
  const changed = [
    ...zeroVariance.slice(0, 15),
    { date: dateFromToday(-3), metrics: { spo2: 94 } },
    { date: dateFromToday(-2), metrics: { spo2: 94 } },
    { date: dateFromToday(-1), metrics: { spo2: 94 } },
    { date: TODAY, metrics: { spo2: 94 } },
  ];
  const zeroVarianceFindings = runDetection(eventsFrom(changed), TODAY);
  assert(
    zeroVarianceFindings.some((finding) => finding.ruleId === 'metric.spo2.baseline_shift'),
    'a stable baseline should still detect a meaningful absolute change',
  );

  const fusionRecords = (() => {
    const result: DayRecord[] = [];
    for (let i = -16; i <= -3; i += 1) {
      result.push({ date: dateFromToday(i), metrics: { steps: 10000, sleepHours: 7 } });
    }
    result.push({ date: dateFromToday(-2), metrics: { steps: 7000, sleepHours: 5.8 } });
    result.push({ date: dateFromToday(-1), metrics: { steps: 7000, sleepHours: 5.8 } });
    result.push({ date: TODAY, metrics: { steps: 7000, sleepHours: 5.8 } });
    return result;
  })();
  const fusionFindings = runDetection(
    eventsFrom(fusionRecords, [
      observation('dizziness', '最近头晕', 'family_ok'),
      observation('poorSleep', '最近睡不好', 'family_ok'),
    ]),
    TODAY,
  );
  const fusion = fusionFindings.find((finding) => finding.ruleId === 'fusion.multisignal_deterioration');
  assert(fusion, 'activity + poor sleep/dizziness should participate in fusion');
  assert((fusion.signalKeys ?? []).includes('dizziness'), 'fusion evidence should preserve dizziness');
  assert((fusion.signalKeys ?? []).includes('poorSleep'), 'fusion evidence should preserve poor sleep');

  const sameFinding = { ...fusion, ruleId: 'fusion.multisignal_deterioration', id: 'fusion-a' };
  const taskA = createTaskFromFinding(sameFinding, TODAY);
  const taskB = createTaskFromFinding({ ...sameFinding, id: 'fusion-b', date: dateFromToday(1) }, dateFromToday(1));
  assert(taskA?.id === taskB?.id, 'the same rule should map to one stable task across days');

  const numericCases = [
    ['血压 150/95', ['systolic', 'diastolic']],
    ['体重 63.4 公斤', ['weight']],
    ['昨晚睡了五个小时', ['sleepHours']],
    ['刚才心率九十次每分钟', ['restingHr']],
  ] as const;
  for (const [text, metrics] of numericCases) {
    const values = extractHealthValues(text);
    assert(
      metrics.every((metric) => values.some((value) => value.metric === metric)),
      `${text} should extract ${metrics.join(', ')}`,
    );
  }
  assert(extractHealthValues('今天走了很多步').length === 0, 'vague quantities must not be guessed');

  const unsafeAdapter: LlmAdapter = {
    async complete() {
      return { text: '您可能患有心衰，请立即加倍服药。', tags: [] };
    },
  };
  assert(!isSafeAgentReply('您可能患有心衰。'), 'diagnostic phrasing must be rejected');
  assert(!isSafeAgentReply('您现在的情况就是心衰。'), 'diagnostic conclusions inside a sentence must be rejected');
  const safeFallback = await generateAgentReply('最近有点累', ['fatigue'], [], false, undefined, unsafeAdapter);
  assert(!safeFallback.includes('可能患有'), 'unsafe LLM output must fall back to a rule-based reply');

  const privateContext = buildAgentContext(
    profile,
    eventsFrom(
      [{ date: TODAY, metrics: { steps: 6500, systolic: 185, diastolic: 121 } }],
      [observation('fatigue', '这段不要告诉孩子：最近很累', 'private')],
    ),
    TODAY,
    [
      {
        id: 'private-finding',
        date: TODAY,
        severity: 'urgent',
        title: '私密紧急发现',
        detail: '私密详情',
        evidence: ['私密证据'],
        familyEligible: false,
      },
    ],
  );
  let capturedBody = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ text: '收到', tags: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await createHttpLlmAdapter('https://example.invalid/agent').complete('系统提示', '我头晕', privateContext);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const payload = JSON.parse(capturedBody) as {
    context?: {
      observations?: Array<{ text: string; visibility?: string }>;
      metrics?: Array<{ metric: string; latestValue: number; visibility?: string }>;
      priorityFindings?: Array<{ title: string; familyEligible?: boolean }>;
      safetyLevel?: string;
    };
  };
  const safeObservations = payload.context?.observations ?? [];
  const safeMetrics = payload.context?.metrics ?? [];
  const safeFindings = payload.context?.priorityFindings ?? [];
  assert(
    !safeObservations.some((item) => item.text.includes('不要告诉孩子')),
    'private observation must stay out of external context',
  );
  assert(
    !safeMetrics.some((item) => item.latestValue === 185 || item.latestValue === 121),
    'private vitals must stay out of external context',
  );
  assert(
    !safeFindings.some((item) => item.title === '私密紧急发现'),
    'private findings must stay out of external context',
  );
  assert(
    payload.context?.safetyLevel !== 'urgent',
    'external safety level must not inherit a private-only urgent finding',
  );

  const context = buildAgentContext(profile, eventsFrom(demoRecords, seedObservations), TODAY, []);
  assert(context.personTwin.asOf === TODAY, 'Person Twin should use the runtime demo date');

  const photo = await demoImageHealthParser.parse(new Blob(['demo']), {
    userId: 'demo-elder-route1',
    capturedAt: `${TODAY}T09:00:00`,
    kind: 'bloodPressure',
  });
  assert(photo.measurements.length === 2, 'demo photo parser should produce the selected blood pressure sample');
  assert(
    photo.measurements.every((measurement) => measurement.confidence === 0.6),
    'demo photo values must expose demo confidence',
  );

  const report = buildWeeklyReport(
    demoRecords,
    seedObservations,
    [
      {
        id: 'report-finding',
        date: TODAY,
        severity: 'alert',
        title: '变化',
        detail: 'demo',
        evidence: ['demo'],
        familyEligible: true,
      },
    ],
    TODAY,
    [
      {
        id: 'task-report',
        title: '联系老人',
        description: '确认状态',
        dueDate: TODAY,
        status: 'completed',
        createdAt: `${TODAY}T09:00:00`,
        kind: 'contact_family',
        completionNote: '已联系',
      },
    ],
  );
  assert(
    report.sections.some((section) => section.title === '这周处理过的事情'),
    'weekly report should include task closure',
  );
  console.log('PASS: Phase 1 hardening regression suite');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
