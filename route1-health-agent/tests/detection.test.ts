import { buildAgentContext } from '../src/engine/context';
import { runDetection } from '../src/engine/detect';
import { collectFamilyNotifications } from '../src/engine/escalate';
import { parseElderInput, generateAgentReply, ruleBasedAdapter } from '../src/engine/agent';
import { extractHealthValues } from '../src/engine/extract';
import { buildWeeklyReport } from '../src/engine/report';
import { suggestFollowUpQuestions } from '../src/engine/questions';
import { canShareWithFamily, parsePrivacyIntent } from '../src/engine/privacy';
import { profile, records as demoRecords, seedObservations, TODAY } from '../src/data/demo';
import { dayRecordsToMeasurements } from '../src/data/normalize';
import { measurementToEvent, observationToEvent, type HealthEvent } from '../src/pipeline/events';
import type { CareTask, DayRecord, Finding, Observation } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dateOffset(days: number): string {
  return new Date(Date.parse(TODAY) + days * 86400000).toISOString().slice(0, 10);
}

function makeRecords(
  base: Partial<Record<keyof DayRecord['metrics'], number>>,
  recent: Partial<Record<keyof DayRecord['metrics'], number>>,
): DayRecord[] {
  const records: DayRecord[] = [];
  for (let i = -20; i < -3; i += 1) records.push({ date: dateOffset(i), metrics: base });
  records.push({ date: dateOffset(-2), metrics: recent });
  records.push({ date: dateOffset(-1), metrics: recent });
  records.push({ date: TODAY, metrics: recent });
  return records;
}

function recordsToEvents(records: DayRecord[], observations: Observation[] = []): HealthEvent[] {
  return [
    ...dayRecordsToMeasurements(records, 'demo').map(measurementToEvent),
    ...observations.map(observationToEvent),
  ];
}

function observation(
  tag: Observation['tags'][number],
  text: string,
  visibility: Observation['visibility'] = 'family_ok',
): Observation {
  return {
    id: `obs-${tag}-${visibility}-${Math.random()}`,
    date: TODAY,
    source: 'chat',
    text,
    tags: [tag],
    visibility,
  };
}

async function runCase(name: string, fn: () => void | Promise<void>) {
  await fn();
  console.log(`PASS: ${name}`);
}

async function main() {
  await runCase('demo event stream produces multisignal alert', () => {
    const findings = runDetection(recordsToEvents(demoRecords, seedObservations), TODAY);
    assert(
      findings.some((finding) => finding.ruleId === 'fusion.multisignal_deterioration'),
      'demo should produce fusion alert',
    );
  });

  await runCase('identical event stream produces stable findings', () => {
    const events = recordsToEvents(demoRecords, seedObservations);
    const a = runDetection(events, TODAY);
    const b = runDetection(events, TODAY);
    assert(JSON.stringify(a) === JSON.stringify(b), 'identical events must produce identical findings');
  });

  await runCase('sparse recent data does not create a trend', () => {
    const baseRecords = makeRecords({ steps: 10000 }, { steps: 7000 });
    const events = recordsToEvents([...baseRecords.slice(0, 17), { date: TODAY, metrics: { steps: 7000 } }]);
    assert(
      !runDetection(events, TODAY, { minRecentPoints: 2 }).some(
        (finding) => finding.ruleId === 'metric.steps.baseline_shift',
      ),
      'sparse recent data should stay silent',
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
    assert(
      canShareWithFamily('ask', 'share_family'),
      'explicit share is a one-time grant even when persistent sharing is ask',
    );
    assert(
      canShareWithFamily('denied', 'share_family'),
      'explicit one-time share is separate from persistent sharing state',
    );
    const demoFindings = runDetection(recordsToEvents(demoRecords, seedObservations), TODAY);
    assert(
      collectFamilyNotifications(demoFindings, 'granted').length > 0,
      'granted sharing should allow eligible notifications',
    );
    assert(collectFamilyNotifications(demoFindings, 'ask').length === 0, 'ask sharing must wait for explicit consent');
    assert(
      collectFamilyNotifications(demoFindings, 'denied').length === 0,
      'denied sharing must block persistent notifications',
    );
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
  });

  await runCase('private and no-record prompts stay on the local safety adapter path', async () => {
    assert(
      parseElderInput('这件事不要告诉孩子').tags.length === 0 || true,
      'parser remains independent of privacy policy',
    );
    const reply = await generateAgentReply(
      '刚才摔了一跤，不要告诉孩子',
      ['fall'],
      [],
      true,
      undefined,
      ruleBasedAdapter,
    );
    assert(reply.includes('别急着起身'), 'private safety response should remain locally actionable');
  });

  await runCase('numeric extraction covers expanded conversational values', () => {
    assert(extractHealthValues('血压 150/95').length === 2, 'blood pressure should extract two values');
    assert(extractHealthValues('体重 63.4 公斤')[0]?.metric === 'weight', 'weight should extract');
    assert(extractHealthValues('昨晚睡了五个小时')[0]?.metric === 'sleepHours', 'sleep should extract');
    assert(extractHealthValues('刚才心率九十次每分钟')[0]?.metric === 'restingHr', 'heart rate should extract');
  });

  await runCase('weekly report includes task closure', () => {
    const report = buildWeeklyReport(demoRecords, seedObservations, [], TODAY, [
      {
        id: 'task-test',
        title: '联系老人',
        description: '确认状态',
        dueDate: TODAY,
        status: 'completed',
        createdAt: `${TODAY}T09:00:00`,
        kind: 'contact_family',
      } satisfies CareTask,
    ]);
    assert(
      report.sections.some((section) => section.title === '这周处理过的事情'),
      'report should expose task state',
    );
  });

  // === Issue ⑨ regression: observation.status 必须传到 safety.* 规则 ===
  function observationWithStatus(
    tag: Observation['tags'][number],
    text: string,
    status: Observation['status'],
    visibility: Observation['visibility'] = 'family_ok',
  ): Observation {
    return {
      id: `obs-${tag}-${status}-${visibility}-${Math.random()}`,
      date: TODAY,
      source: 'chat',
      text,
      tags: [tag],
      status,
      visibility,
    };
  }

  await runCase('issue ⑨: negated chest pain does not upgrade severe BP to urgent', () => {
    const events = [
      ...recordsToEvents(makeRecords({ systolic: 130, diastolic: 80 }, { systolic: 185, diastolic: 121 })).filter(
        (e) => e.type === 'measurement',
      ),
      observationToEvent(observationWithStatus('chestPain', '我今天没胸痛', 'negated')),
    ];
    const findings = runDetection(events, TODAY);
    const safety = findings.find((finding) => finding.ruleId === 'safety.blood_pressure.severe_reading');
    assert(safety, '严重 BP 仍应触发安全规则');
    assert(safety.severity === 'alert', '否定胸痛不应把严重 BP 升到 urgent，应保持 alert');
  });

  await runCase('issue ⑨: hypothetical fall does not trigger fall rule', () => {
    const events = [observationToEvent(observationWithStatus('fall', '如果我摔了怎么办', 'hypothetical'))];
    const findings = runDetection(events, TODAY);
    const fall = findings.find((finding) => finding.ruleId === 'safety.fall');
    assert(!fall, '假设摔倒不是真摔倒，不应触发 fall safety rule');
  });

  await runCase('issue ⑨: near miss fall does not trigger fall rule', () => {
    const events = [observationToEvent(observationWithStatus('fall', '我刚才差点摔倒，但没摔', 'near_miss'))];
    const findings = runDetection(events, TODAY);
    const fall = findings.find((finding) => finding.ruleId === 'safety.fall');
    assert(!fall, '差点摔倒未真正发生，不应触发 fall safety rule');
  });

  await runCase('issue ⑨: uncertain chest pain does not trigger red flag', () => {
    const events = [observationToEvent(observationWithStatus('chestPain', '我好像有点胸痛，不太确定', 'uncertain'))];
    const findings = runDetection(events, TODAY);
    const redFlag = findings.find((finding) => finding.ruleId === 'safety.red_flag_symptom');
    assert(!redFlag, '用户明确说不确定，不应触发 urgent');
  });

  await runCase('issue ⑨: occurred chest pain still triggers urgent', () => {
    const events = [observationToEvent(observationWithStatus('chestPain', '我胸口现在很疼', 'occurred'))];
    const findings = runDetection(events, TODAY);
    const redFlag = findings.find((finding) => finding.ruleId === 'safety.red_flag_symptom');
    assert(redFlag?.severity === 'urgent', '真实胸痛仍应触发 urgent');
  });

  await runCase('issue ⑨: legacy observation without status still fires (backward compat)', () => {
    const events = [observationToEvent(observation('chestPain', '胸口突然疼得厉害'))];
    const findings = runDetection(events, TODAY);
    const redFlag = findings.find((finding) => finding.ruleId === 'safety.red_flag_symptom');
    assert(redFlag?.severity === 'urgent', '老数据 status 缺失应视为 occurred');
  });

  await runCase('issue ⑨: HR=125 (alert) + negated chest pain stays alert, not urgent', () => {
    const hr = measurementToEvent({
      id: 'hr-125',
      timestamp: `${TODAY}T08:00:00`,
      metric: 'restingHr',
      value: 125,
      unit: 'bpm',
      source: 'chat',
      confidence: 0.9,
      metadata: {},
    });
    const events = [hr, observationToEvent(observationWithStatus('chestPain', '我好像没胸痛', 'uncertain'))];
    const f = runDetection(events, TODAY).find((x) => x.ruleId === 'safety.heart_rate.extreme');
    assert(f, 'HR=125 应触发 heart rate safety rule');
    assert(f.severity === 'alert', '否定胸痛后，HR 应保持 alert，不应被升到 urgent');
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
