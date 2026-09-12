import { createTaskFromFinding } from '../src/engine/tasks';
import { demoImageHealthParser } from '../src/adapters/DemoImageHealthParser';
import type { Finding } from '../src/types';

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
  // 评审 P0-3：老人端任务不得复用写给家属的文案（第三人称），且必须带可执行动作。
  assert(
    familyTask.description !== sharedAlert.familyMessage && familyTask.description !== sharedAlert.carePath,
    'elder task description must not reuse family-facing copy (familyMessage/carePath)',
  );
  assert(
    (familyTask.actions?.length ?? 0) >= 1,
    'contact_family tasks must carry at least one executable action (no dead-end tasks)',
  );
  assert(
    familyTask.actions?.includes('call_family') && familyTask.actions?.includes('request_share'),
    'contact_family tasks must offer call + share actions',
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
  assert(safetyTask.actions?.includes('call_family'), 'urgent safety tasks must offer a call action');
  assert(
    safetyTask.description !== privateUrgent.carePath,
    'elder safety task description must be elder-directed, not the family carePath',
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

  console.log('PASS: contact_family task path and photo privacy regression coverage');
}

void main();
