import { records as demoRecords, seedObservations, TODAY, profile } from '../src/data/demo';
import type { DayRecord, Finding, Observation } from '../src/types';
import { dayRecordsToMeasurements } from '../src/data/normalize';
import { mergeHealthEvents, materializeHealthData, measurementToEvent, observationToEvent, labResultToEvent, type HealthEvent } from '../src/pipeline/events';
import { runDetection } from '../src/engine/detect';
import { buildAgentContext, serializeAgentContext } from '../src/engine/context';
import { generateAgentReply, ruleBasedAdapter } from '../src/engine/agent';
import { suggestFollowUpQuestions } from '../src/engine/questions';
import { buildInitialTasks, createTaskFromFinding, updateTaskStatus } from '../src/engine/tasks';
import { canShareWithFamily, parsePrivacyIntent } from '../src/engine/privacy';
import { collectFamilyNotifications } from '../src/engine/escalate';
import { extractHealthValues } from '../src/engine/extract';
import { buildWeeklyReport } from '../src/engine/report';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dateFromToday(offset: number): string {
  return new Date(Date.parse(TODAY) + offset * 86400000).toISOString().slice(0, 10);
}

function makeRecords(metrics: Partial<DayRecord['metrics']>, recentValues?: Partial<DayRecord['metrics']>): DayRecord[] {
  const result: DayRecord[] = [];
  for (let i = -16; i <= -3; i += 1) result.push({ date: dateFromToday(i), metrics: { ...metrics } });
  result.push(
    { date: dateFromToday(-2), metrics: { ...metrics, ...recentValues } },
    { date: dateFromToday(-1), metrics: { ...metrics, ...recentValues } },
    { date: TODAY, metrics: { ...metrics, ...recentValues } },
  );
  return result;
}

function makeSparseRecords(metrics: Partial<DayRecord['metrics']>, recentValues: Partial<DayRecord['metrics']>): DayRecord[] {
  const result: DayRecord[] = [];
  for (let i = -16; i <= -3; i += 1) result.push({ date: dateFromToday(i), metrics: { ...metrics } });
  result.push({ date: TODAY, metrics: { ...metrics, ...recentValues } });
  return result;
}

function recordsToEvents(records: DayRecord[], observations: Observation[] = []): HealthEvent[] {
  return mergeHealthEvents(dayRecordsToMeasurements(records, 'demo').map(measurementToEvent), observations.map(observationToEvent));
}

function observation(tag: Observation['tags'][number], text: string, visibility?: Observation['visibility']): Observation {
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
    assert(JSON.stringify(runDetection(events, TODAY)) === JSON.stringify(runDetection(events, TODAY)), 'identical input must produce identical findings');
  });

  await runCase('sparse recent data does not create a trend', () => {
    const findings = runDetection(recordsToEvents(makeSparseRecords({ steps: 10000 }, { steps: 6000 })), TODAY, { minRecentPoints: 2 });
    assert(!findings.some((finding) => finding.ruleId === 'metric.steps.baseline_shift'), 'one recent point must not create a trend finding');
  });

  await runCase('single weak metric stays at watch', () => {
    const finding = runDetection(recordsToEvents(makeRecords({ steps: 10000 }, { steps: 7000 })), TODAY).find((item) => item.ruleId === 'metric.steps.baseline_shift');
    assert(finding, 'step reduction should produce a metric finding');
    assert(finding.severity === 'watch', 'single metric change should remain watch');
    assert(!finding.familyMessage, 'watch findings should not directly notify family');
  });

  await runCase('severe blood pressure without red flags stays alert', () => {
    const findings = runDetection(recordsToEvents(makeRecords({ systolic: 130, diastolic: 80 }, { systolic: 185, diastolic: 121 })), TODAY);
    const safety = findings.find((finding) => finding.ruleId === 'safety.blood_pressure.severe_reading');
    assert(safety, 'severe blood pressure should create a safety finding');
    assert(safety.severity === 'alert', 'severe blood pressure without red-flag symptoms should be alert');
    assert(safety.familyEligible === true, 'objective safety finding remains family eligible');
  });

  await runCase('severe blood pressure plus chest pain upgrades to urgent', () => {
    const events = recordsToEvents(makeRecords({ systolic: 130, diastolic: 80 }, { systolic: 185, diastolic: 121 }), [observation('chestPain', '胸口突然疼得厉害')]);
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
    const events = recordsToEvents(makeRecords({ steps: 10000, weight: 60, restingHr: 65 }, { steps: 7000, weight: 61.5, restingHr: 72 }), [observation('fatigue', '最近很累', 'private')]);
    const findings = runDetection(events, TODAY);
    const fusion = findings.find((finding) => finding.ruleId === 'fusion.multisignal_deterioration');
    assert(fusion, 'three objective/symptom dimensions should still produce a fusion finding');
    assert(fusion.familyEligible === false, 'private symptom used by fusion must block family escalation');
    assert(!fusion.familyMessage, 'private-based fusion must not contain a family message');
  });

  await runCase('private red-flag symptom remains urgent but is not copied to family', () => {
    const events = recordsToEvents(makeRecords({ steps: 7000 }, { steps: 7000 }), [observation('chestPain', '这个不要告诉孩子，我胸口现在很痛', 'private')]);
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
    assert(collectFamilyNotifications(demoFindings, 'granted').length > 0, 'granted sharing should allow eligible notifications');
    assert(collectFamilyNotifications(demoFindings, 'ask').length === 0, 'ask sharing must wait for explicit consent');
    assert(collectFamilyNotifications(demoFindings, 'denied').length === 0, 'denied sharing must block notifications');
  });

  await runCase('chat numeric extraction reaches structured metrics', () => {
    const night = extractHealthValues('我昨晚起夜三四次');
    assert(night[0]?.metric === 'nightWakes', 'night waking phrase should map to nightWakes');
    assert(night[0]?.value === 3.5, '三四次 should become a midpoint numeric value');
    const steps = extractHealthValues('今天走了六千步');
    assert(steps[0]?.metric === 'steps', 'walking phrase should map to steps');
    assert(steps[0]?.value === 6000, '六千步 should become 6000');
  });

  await runCase('justified follow-up question is driven by context and used by Agent adapter', async () => {
    const events = recordsToEvents(makeRecords({ steps: 9000, walkSpeed: 1.0 }, { steps: 6000, walkSpeed: 0.8 }), [observation('fatigue', '最近腿有点没劲')]);
    const findings = runDetection(events, TODAY);
    const context = buildAgentContext(profile, events, TODAY, findings);
    const questions = suggestFollowUpQuestions(['fatigue'], context);
    assert(questions.length > 0, 'declining activity plus fatigue should trigger a justified question');
    assert(questions[0].reason.length > 0, 'follow-up question should preserve its reason');
    const reply = await generateAgentReply('最近腿有点没劲', ['fatigue'], findings, false, context, ruleBasedAdapter);
    assert(reply.includes(questions[0].question), 'Agent adapter reply should use the justified question policy');
  });

  await runCase('care tasks are contextual rather than daily noise', () => {
    assert(buildInitialTasks(TODAY).length === 0, 'stable days should not create arbitrary daily tasks');
    const watchFinding = runDetection(recordsToEvents(makeRecords({ steps: 10000 }, { steps: 6500 })), TODAY).find((item) => item.ruleId === 'metric.steps.baseline_shift');
    assert(watchFinding, 'a meaningful metric finding should exist for the task eligibility check');
    assert(!createTaskFromFinding(watchFinding, TODAY), 'watch findings should not create action tasks');
    const findings = runDetection(recordsToEvents(makeRecords({ steps: 10000, weight: 60, restingHr: 65 }, { steps: 7000, weight: 61.5, restingHr: 72 })), TODAY);
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
    const labResult = { id: 'lab-1', timestamp: `${TODAY}T09:00:00`, name: 'NT-proBNP', value: 320, unit: 'pg/ml', source: 'photo' as const };
    const obs = observation('fatigue', '今天有点累');
    const data = materializeHealthData(mergeHealthEvents([measurementToEvent(measurement), observationToEvent(obs), labResultToEvent(labResult)]));
    assert(data.measurements.length === 1, 'measurement event should materialize');
    assert(data.observations.length === 1, 'observation event should materialize');
    assert(data.labResults.length === 1, 'lab result event should materialize');
    assert(data.records[0]?.metrics.steps === 7200, 'measurement event should project into DayRecord');
  });

  await runCase('weekly report excludes private observation text', () => {
    const findings: Finding[] = [{
      id: 'finding-1', date: TODAY, severity: 'alert', title: '活动量持续下降', detail: 'demo', evidence: ['活动步数明显下降'],
      carePath: '确认老人近期状态', familyMessage: '请联系老人', familyEligible: true,
    }];
    const report = buildWeeklyReport(
      makeRecords({ steps: 10000 }, { steps: 7000 }),
      [observation('fatigue', '普通可共享主诉'), observation('dizziness', '私密主诉', 'private')],
      findings,
      TODAY,
    );
    const section = report.sections.find((item) => item.title === '您自己说过的');
    assert(section?.lines.some((line) => line.includes('普通可共享主诉')), 'shared observation should be present');
    assert(section?.lines.every((line) => !line.includes('私密主诉')), 'private observation should not be exposed by report input');
  });

  await runCase('agent context is bounded and carries Person Twin evidence', () => {
    const events = recordsToEvents(demoRecords, seedObservations);
    const findings = runDetection(events, TODAY);
    const context = buildAgentContext(profile, events, TODAY, findings);
    const text = serializeAgentContext(context);
    assert(context.observations.length <= 8, 'agent context should bound observations');
    assert(context.priorityFindings.length <= 6, 'agent context should bound findings');
    assert(text.includes('当前安全等级：'), 'serialized context should include safety level');
    assert(text.includes('Person Twin：'), 'serialized context should include Person Twin');
    assert(text.includes('功能画像：'), 'serialized context should include functional profile');
  });
}

main().catch((error) => {
  console.error(error);
  throw error;
});
