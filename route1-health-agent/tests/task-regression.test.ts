import { createTaskFromFinding, ensureMedicationCheckTask } from '../src/engine/tasks';
import { demoImageHealthParser } from '../src/adapters/DemoImageHealthParser';
import type { CareTask, Finding } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const sharedAlert: Finding = {
    id: 'finding-shared-alert',
    date: '2026-09-07',
    severity: 'alert',
    title: '最近活动量下降',
    detail: '需要留意近期变化。',
    evidence: ['最近 3 天比平时低'],
    familyMessage: '【请关注】近期活动量比平时明显下降，请和老人聊聊。',
    carePath: '今天确认一下当前状态。',
    ruleId: 'metric.steps.drop',
    familyEligible: true,
  };
  const familyTask = createTaskFromFinding(sharedAlert, '2026-09-07');
  assert(
    familyTask?.kind === 'contact_family',
    'family-eligible findings with a family message must create contact_family tasks',
  );

  const unspecifiedFamilyEligibility: Finding = {
    ...sharedAlert,
    id: 'finding-unspecified-family-eligibility',
    familyEligible: undefined,
  };
  const unspecifiedTask = createTaskFromFinding(unspecifiedFamilyEligibility, '2026-09-07');
  assert(
    unspecifiedTask?.kind !== 'contact_family',
    'a finding without explicit family eligibility must never create a contact_family task',
  );

  const privateUrgent: Finding = {
    ...sharedAlert,
    id: 'finding-private-urgent',
    severity: 'urgent',
    familyMessage: undefined,
    familyEligible: false,
  };
  const safetyTask = createTaskFromFinding(privateUrgent, '2026-09-07');
  assert(
    safetyTask?.kind === 'safety_check',
    'urgent findings without shareable family context must remain safety_check tasks',
  );

  const parsed = await demoImageHealthParser.parse(new Blob(['demo']), {
    userId: 'demo-elder-route1',
    capturedAt: '2026-09-07T09:00:00.000Z',
    kind: 'bloodPressure',
  });
  assert(
    parsed.measurements.every((measurement) => measurement.visibility === undefined),
    'the image parser must remain privacy-neutral and let the caller assign visibility',
  );

  const completedMedicationTask: CareTask = {
    id: 'task-medication-2026-09-08',
    title: '确认今天是否按原来的医生方案服药',
    description: '不要自行加倍或调整药量，只确认并按原方案处理。',
    dueDate: '2026-09-08',
    status: 'completed',
    createdAt: '2026-09-08T09:00:00',
    kind: 'medication_check',
    completionNote: '已完成',
  };
  const afterRepeat = ensureMedicationCheckTask([completedMedicationTask], '2026-09-08', '2026-09-08T12:00:00');
  assert(afterRepeat.length === 1, 'a completed medication check must not be duplicated later the same day');
  assert(afterRepeat[0]?.id === 'task-medication-2026-09-08', 'medication task id must remain stable for the day');

  const withPending = ensureMedicationCheckTask([], '2026-09-08', '2026-09-08T09:00:00');
  const withRepeat = ensureMedicationCheckTask(withPending, '2026-09-08', '2026-09-08T10:00:00');
  assert(withRepeat.length === 1, 'repeated medication reminders must be idempotent');

  console.log('PASS: family-task eligibility, contact_family path, photo privacy, and medication-task idempotency regressions');
}

void main();
