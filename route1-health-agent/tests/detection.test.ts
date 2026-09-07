import { records as demoRecords, seedObservations, TODAY, profile } from '../src/data/demo';
import type { DayRecord, Finding, Observation } from '../src/types';
import { dayRecordsToMeasurements } from '../src/data/normalize';
import {
  mergeHealthEvents,
  materializeHealthData,
  measurementToEvent,
  observationToEvent,
  labResultToEvent,
  type HealthEvent,
} from '../src/pipeline/events';
import { runDetection } from '../src/engine/detect';
import { buildAgentContext, serializeAgentContext } from '../src/engine/context';
import { createHttpLlmAdapter, generateAgentReply, type LlmAdapter } from '../src/engine/agent';
import { extractHealthValues } from '../src/engine/extract';
import { suggestFollowUpQuestions } from '../src/engine/questions';
import { buildInitialTasks, createTaskFromFinding, updateTaskStatus } from '../src/engine/tasks';
import { canShareWithFamily, parsePrivacyIntent } from '../src/engine/privacy';
import { collectFamilyNotifications } from '../src/engine/escalate';
import { buildWeeklyReport } from '../src/engine/report';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function dateFromToday(offset: number): string {
  return new Date(Date.parse(TODAY) + offset * 86400000).toISOString().slice(0, 10);
}
function makeRecords(
  metrics: Partial<DayRecord['metrics']>,
  recentValues?: Partial<DayRecord['metrics']>,
): DayRecord[] {
  const result: DayRecord[] = [];
  for (let i = -16; i <= -3; i += 1) result.push({ date: dateFromToday(i), metrics: { ...metrics } });
  result.push(
    { date: dateFromToday(-2), metrics: { ...metrics, ...recentValues } },
    { date: dateFromToday(-1), metrics: { ...metrics, ...recentValues } },
    { date: TODAY, metrics: { ...metrics, ...recentValues } },
  );
  return result;
}
function makeSparseRecords(
  metrics: Partial<DayRecord['metrics']>,
  recentValues: Partial<DayRecord['metrics']>,
): DayRecord[] {
  const result: DayRecord[] = [];
  for (let i = -16; i <= -3; i += 1) result.push({ date: dateFromToday(i), metrics: { ...metrics } });
  result.push({ date: TODAY, metrics: { ...metrics, ...recentValues } });
  return result;
}
function recordsToEvents(records: DayRecord[], observations: Observation[] = []): HealthEvent[] {
  return mergeHealthEvents(
    dayRecordsToMeasurements(records, 'demo').map(measurementToEvent),
    observations.map(observationToEvent),
  );
}
function observation(
  tag: Observation['tags'][number],
  text: string,
  visibility?: Observation['visibility'],
): Observation {
  return { id: `test-${tag}`, date: TODAY, source: 'chat', text, tags: [tag], visibility };
}
async function runCase(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  console.log(`PASS: ${name}`);
}

async function main(): Promise<void> {
  await runCase('demo event stream produces multisignal alert', () => {
    const findings = runDetection(recordsToEvents(demoRecords, seedObservations), TODAY);
    const fusion = findings.find((finding) => finding.ruleId === 'fusion.multisignal_deterioration');
    assert(fusion, 'demo event stream should produce the multi-signal fusion finding');
    assert(fusion.severity === 'alert', 'multi-signal deterioration should be alert');
    assert((fusion.signalKeys?.length ?? 0) >= 3, 'fusion finding should preserve multiple signal keys');
    assert(fusion.familyEligible === true, 'shareable demo observations should permit family escalation');
  });

  await runCase('identical event stream produces stable findings', () => {
    const events = recordsToEvents(makeRecords({ steps: 10000 }, { steps: 6500 }));
    assert(
      JSON.stringify(runDetection(events, TODAY)) === JSON.stringify(runDetection(events, TODAY)),
      'identical input must produce identical findings',
    );
  });

  await runCase('sparse recent data does not create a trend', () => {
    const findings = runDetection(recordsToEvents(makeSparseRecords({ steps: 10000 }, { steps: 6000 })), TODAY, {
      minRecentPoints: 2,
    });
    assert(
      !findings.some((finding) => finding.ruleId === 'metric.steps.baseline_shift'),
      'one recent point must not create a trend finding',
    );
  });

  await runCase('single weak metric stays at watch', () => {
    const finding = runDetection(recordsToEvents(makeRecords({ steps: 10000 }, { steps: 7000 })), TODAY).find(
      (item) => item.ruleId === 'metric.steps.baseline_shift',
    );
    assert(finding, 'step reduction should produce a metric finding');
    assert(finding.severity === 'watch', 'single metric change should remain watch');
    assert(!finding.familyMessage, 'watch findings should not directly notify family');
  });

  await runCase('severe blood pressure without red flags stays alert', () => {
    const findings = runDetection(
      recordsToEvents(makeRecords({ systolic: 130, diastolic: 80 }, { systolic: 185, diastolic: 121 })),
      TODAY,
    );
    const safety = findings.find((finding) => finding.ruleId === 'safety.blood_pressure.severe_reading');
    assert(safety, 'severe blood pressure should create a safety finding');
    assert(safety.severity === 'alert', 'severe blood pressure without red-flag symptoms should be alert');
    assert(safety.familyEligible === true, 'objective safety finding remains family eligible');
  });

  await runCase('severe blood pressure plus chest pain upgrades to urgent', () => {
    const events = recordsToEvents(makeRecords({ systolic: 130, diastolic: 80 }, { systolic: 185, diastolic: 121 }), [
      observation('chestPain', '胸口突然疼得厉害'),
    ]);
    const findings = runDetection(events, TODAY);
    const safety = findings.find((finding) => finding.ruleId === 'safety.blood_pressure.severe_reading');
    assert(safety, 'combined severe BP safety finding should exist');
    assert(safety.severity === 'urgent', 'dangerous symptom should upgrade severe BP to urgent');
    assert(safety.signalKeys?.includes('chestPain'), 'urgent finding should identify the chest pain signal');
  });

  await runCase('fall directly routes to urgent', () => {
    const findings = runDetection(recordsToEvents([], [observation('fall', '刚才摔了一跤')]), TODAY);
    const fall = findings.find((finding) => finding.ruleId === 'safety.fall');
    assert(fall, 'fall should create a safety finding');
    assert(fall.severity === 'urgent', 'fall should be urgent');
    assert(fall.familyMessage, 'shareable urgent fall should contain a family message');
  });

  await runCase('private observation prevents family escalation without hiding it from the elder', () => {
    const events = recordsToEvents(
      makeRecords({ steps: 10000, weight: 60, restingHr: 65 }, { steps: 7000, weight: 61.5, restingHr: 72 }),
      [observation('fatigue', '最近很累', 'private')],
    );
    const findings = runDetection(events, TODAY);
    const fusion = findings.find((finding) => finding.ruleId === 'fusion.multisignal_deterioration');
    assert(fusion, 'three objective/symptom dimensions should still produce a fusion finding');
    assert(fusion.familyEligible === false, 'private symptom used by fusion must block family escalation');
    assert(!fusion.familyMessage, 'private-based fusion must not contain a family message');
  });

  await runCase('private red-flag symptom remains urgent but is not copied to family', () => {
    const events = recordsToEvents(makeRecords({ steps: 7000 }, { steps: 7000 }), [
      observation('chestPain', '这个不要告诉孩子，我胸口现在很痛', 'private'),
    ]);
    const findings = runDetection(events, TODAY);
    const redFlag = findings.find((finding) => finding.ruleId === 'safety.red_flag_symptom');
    assert(redFlag?.severity === 'urgent', 'private chest pain should still be handled as urgent for the elder');
    assert(redFlag?.familyEligible === false, 'private chest pain must not escalate to family');
    assert(!redFlag?.familyMessage, 'private chest pain must not generate a family message');
  });

  await runCase('privacy intent is explicit and conservative', () => {
    assert(parsePrivacyIntent('这个不要告诉孩子') === 'private', 'privacy phrase should be recognized');
    assert(parsePrivacyIntent('这个不要记录') === 'no_record', 'no-record phrase should be recognized');
    assert(canShareWithFamily('ask', 'share_family'), 'explicit share request should be allowed when not denied');
    assert(!canShareWithFamily('denied', 'share_family'), 'denied family sharing must remain denied');
    const demoFindings = runDetection(recordsToEvents(demoRecords, seedObservations), TODAY);
    assert(
      collectFamilyNotifications(demoFindings, 'granted').length > 0,
      'granted sharing should allow eligible notifications',
    );
    assert(collectFamilyNotifications(demoFindings, 'ask').length === 0, 'ask sharing must wait for explicit consent');
    assert(collectFamilyNotifications(demoFindings, 'denied').length === 0, 'denied sharing must block notifications');
  });

  await runCase('justified follow-up question is driven by context', async () => {
    const events = recordsToEvents(makeRecords({ steps: 9000, walkSpeed: 1.0 }, { steps: 6000, walkSpeed: 0.8 }), [
      observation('fatigue', '最近腿有点没劲'),
    ]);
    const findings = runDetection(events, TODAY);
    const context = buildAgentContext(profile, events, TODAY, findings);
    const questions = suggestFollowUpQuestions(['fatigue'], context);
    assert(questions.length > 0, 'declining activity plus fatigue should trigger a justified question');
    assert(questions[0].reason.length > 0, 'follow-up question should preserve its reason');
    const fallbackAdapter: LlmAdapter = {
      async complete() {
        return { text: '', tags: [] };
      },
    };
    const reply = await generateAgentReply('最近腿有点没劲', ['fatigue'], findings, false, context, fallbackAdapter);
    assert(reply.includes(questions[0].question), 'Agent fallback should use the justified question policy');
  });

  await runCase('agent adapter is the real reply extension point', async () => {
    const calls: string[] = [];
    const adapter: LlmAdapter = {
      async complete(systemPrompt, userText) {
        calls.push(systemPrompt, userText);
        return { text: '我收到啦，我们慢慢看看。', tags: ['fatigue'] };
      },
    };
    const reply = await generateAgentReply('最近有点累', ['fatigue'], [], false, undefined, adapter);
    assert(reply === '我收到啦，我们慢慢看看。', 'custom adapter reply should be returned');
    assert(calls[0]?.includes('安全等级'), 'adapter should receive safety instructions');
    assert(calls[1] === '最近有点累', 'adapter should receive the original elder text');
  });

  await runCase('http adapter strips private observations before external request', async () => {
    const events = recordsToEvents(
      [],
      [
        observation('fatigue', '这是只有老人自己能看到的内容', 'private'),
        observation('dizziness', '普通可共享内容', 'family_ok'),
      ],
    );
    const findings = runDetection(events, TODAY);
    const context = buildAgentContext(profile, events, TODAY, findings);
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
      await createHttpLlmAdapter('https://example.invalid/agent').complete('系统提示', '我头晕', context);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const payload = JSON.parse(capturedBody) as {
      context?: { observations?: Array<{ text: string; visibility?: string }> };
    };
    const sentObservations = payload.context?.observations ?? [];
    assert(
      sentObservations.some((item) => item.text === '普通可共享内容'),
      'shared observation should be sent',
    );
    assert(
      !sentObservations.some((item) => item.text === '这是只有老人自己能看到的内容'),
      'private observation must not be sent to external LLM',
    );
  });

  await runCase('natural language numeric extraction feeds both core metrics', () => {
    const nightWakes = extractHealthValues('我昨晚起夜三四次');
    assert(nightWakes.length === 1, 'night wake count should be extracted from conversational Chinese');
    assert(nightWakes[0].metric === 'nightWakes', 'night wake extraction should map to the correct metric');
    assert(nightWakes[0].value === 3.5, '三四次 should normalize to the midpoint 3.5');
    const steps = extractHealthValues('今天走了六千步');
    assert(steps[0]?.metric === 'steps', 'step count should be extracted from conversational Chinese');
    assert(steps[0]?.value === 6000, '六千步 should normalize to 6000');
  });

  await runCase('care tasks are contextual rather than daily noise', () => {
    assert(buildInitialTasks(TODAY).length === 0, 'stable days should not create arbitrary daily tasks');
    const watchFinding = runDetection(recordsToEvents(makeRecords({ steps: 10000 }, { steps: 6500 })), TODAY).find(
      (item) => item.ruleId === 'metric.steps.baseline_shift',
    );
    assert(watchFinding, 'a meaningful metric finding should exist for the task eligibility check');
    assert(!createTaskFromFinding(watchFinding, TODAY), 'watch findings should not create action tasks');

    const findings = runDetection(
      recordsToEvents(
        makeRecords({ steps: 10000, weight: 60, restingHr: 65 }, { steps: 7000, weight: 61.5, restingHr: 72 }),
      ),
      TODAY,
    );
    const actionable = findings.find((item) => item.ruleId === 'fusion.multisignal_deterioration');
    assert(actionable?.severity === 'alert', 'multi-signal deterioration should be actionable');
    const task = actionable ? createTaskFromFinding(actionable, TODAY) : null;
    assert(task, 'actionable finding should create a task');
    assert(task.status === 'pending', 'new task should be pending');
    const completed = updateTaskStatus(task, 'completed');
    assert(task.status === 'pending', 'updates must not mutate the previous task');
    assert(completed.status === 'completed', 'task should enter completed state');
  });

  await runCase('all three health input types materialize from one stream', () => {
    const measurement = dayRecordsToMeasurements([{ date: TODAY, metrics: { steps: 7200 } }], 'device')[0];
    const labResult = {
      id: 'lab-1',
      timestamp: `${TODAY}T09:00:00`,
      name: 'NT-proBNP',
      value: 320,
      unit: 'pg/ml',
      source: 'photo' as const,
    };
    const obs = observation('fatigue', '今天有点累');
    const data = materializeHealthData(
      mergeHealthEvents([measurementToEvent(measurement), observationToEvent(obs), labResultToEvent(labResult)]),
    );
    assert(data.measurements.length === 1, 'measurement event should materialize');
    assert(data.observations.length === 1, 'observation event should materialize');
    assert(data.labResults.length === 1, 'lab result event should materialize');
    assert(data.records[0]?.metrics.steps === 7200, 'measurement event should project into DayRecord');
  });

  await runCase('weekly report excludes private observation text', () => {
    const findings: Finding[] = [
      {
        id: 'finding-1',
        date: TODAY,
        severity: 'alert',
        title: '活动量持续下降',
        detail: 'demo',
        evidence: ['活动步数明显下降'],
        carePath: '确认老人近期状态',
        familyMessage: '请联系老人',
        familyEligible: true,
      },
    ];
    const events = recordsToEvents([], [observation('fatigue', '这是只有老人自己能看到的内容', 'private')]);
    const report = buildWeeklyReport(profile, events, findings, TODAY);
    assert(
      !report.some((section) => section.includes('只有老人自己能看到的内容')),
      'private observation text should never appear in weekly report',
    );
  });

  await runCase('agent context is bounded and carries Person Twin evidence', () => {
    const events = recordsToEvents(demoRecords, seedObservations);
    const findings = runDetection(events, TODAY);
    const context = buildAgentContext(profile, events, TODAY, findings);
    const serialized = serializeAgentContext(context);
    assert(serialized.length < 12000, 'serialized context should stay bounded');
    assert(serialized.includes('活动量下降'), 'Person Twin evidence should survive serialization');
    assert(
      !('name' in (context.personTwin as unknown as Record<string, unknown>)),
      'Person Twin should not expose direct identity',
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
