import {
  MEDICATION_ATTENTION_MESSAGE,
  buildMedicationCareView,
  medicationStatusLabel,
  parseMedication,
  todayMedicationTasks,
} from '../src/engine/medicationCare';
import type { CareTask, Finding, TaskStatus } from '../src/types';
import type { FamilyNotification } from '../src/engine/escalate';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

const TODAY = '2026-09-11';

function medicationTask(status: TaskStatus, overrides: Partial<CareTask> = {}): CareTask {
  return {
    id: 'task-medication-2026-09-11',
    title: '💊 今天的药',
    description: '• 氨氯地平 5mg 每日一次',
    dueDate: TODAY,
    status,
    createdAt: `${TODAY}T08:00:00`,
    kind: 'medication_check',
    ...overrides,
  };
}

function notification(title: string, message: string): FamilyNotification {
  const finding: Finding = {
    id: 'finding-1',
    date: TODAY,
    severity: 'alert',
    title,
    detail: 'detail',
    evidence: [],
    familyEligible: true,
  };
  return { finding, message, reason: 'test', oneTime: false };
}

const baseInput = {
  medications: ['氨氯地平 5mg 每日一次', '美托洛尔 23.75mg 每日一次'],
  tasks: [] as CareTask[],
  today: TODAY,
  familySharing: 'granted' as const,
  communityDoctorPhone: '021-55661234' as string | undefined,
  notifications: [] as FamilyNotification[],
};

runCase('parseMedication splits name, dose and frequency from a regular string', () => {
  const parsed = parseMedication('氨氯地平 5mg 每日一次');
  assert(parsed.name === '氨氯地平', `name should be 氨氯地平, got ${parsed.name}`);
  assert(parsed.dose === '5mg', `dose should be 5mg, got ${parsed.dose}`);
  assert(parsed.frequency === '每日一次', `frequency should be 每日一次, got ${parsed.frequency}`);
});

runCase('parseMedication falls back to the raw string when parts cannot be split', () => {
  for (const raw of ['中药调理', '氨氯地平5mg每日一次', '未知药物 未知剂量']) {
    const parsed = parseMedication(raw);
    assert(parsed.name === raw.trim(), `unparseable medication "${raw}" must keep the raw string`);
    if (raw === '中药调理') {
      assert(parsed.dose === undefined && parsed.frequency === undefined, 'fallback must not invent dose or frequency');
    }
  }
});

runCase('medication status labels map all four TaskStatus values', () => {
  assert(medicationStatusLabel('pending') === '待确认', 'pending must display 待确认');
  assert(medicationStatusLabel('in_progress') === '进行中', 'in_progress must display 进行中');
  assert(medicationStatusLabel('completed') === '已完成', 'completed must display 已完成');
  assert(medicationStatusLabel('dismissed') === '已跳过 / 未确认', 'dismissed must display 已跳过 / 未确认');
});

runCase('todayMedicationTasks keeps only today medication_check tasks', () => {
  const tasks = [
    medicationTask('pending'),
    medicationTask('pending', { id: 'task-medication-yesterday', dueDate: '2026-09-10' }),
    medicationTask('pending', { id: 'task-safety', kind: 'safety_check', title: '安全检查' }),
  ];
  const todayTasks = todayMedicationTasks(tasks, TODAY);
  assert(todayTasks.length === 1, `expected 1 today task, got ${todayTasks.length}`);
  assert(todayTasks[0].id === 'task-medication-2026-09-11', 'must keep the today medication_check task');
});

runCase('granted family sees medications and doctor entry', () => {
  const view = buildMedicationCareView(baseInput);
  assert(view.authorized, 'granted family must be authorized');
  assert(view.medications.length === 2, 'granted family must see the medication list');
  assert(view.medications[0].name === '氨氯地平', 'parsed medication name must be visible');
  assert(view.showDoctorEntry, 'community doctor entry must show when the phone exists');
});

runCase('unauthorized family sees no medication data at all', () => {
  for (const familySharing of ['denied', 'ask'] as const) {
    const view = buildMedicationCareView({ ...baseInput, familySharing });
    assert(!view.authorized, `${familySharing} must not be authorized`);
    assert(view.medications.length === 0, `${familySharing} must not see medications`);
    assert(view.todayStatuses.length === 0, `${familySharing} must not see today medication status`);
    assert(!view.hasTodayRecord, `${familySharing} must not expose today medication record`);
    assert(!view.needsAttention, `${familySharing} must not raise family attention`);
  }
});

runCase('no medication task today renders the honest empty state', () => {
  const view = buildMedicationCareView(baseInput);
  assert(!view.hasTodayRecord, 'empty task list must not claim a record exists');
  assert(view.todayStatuses.length === 0, 'empty task list must produce no status entries');
});

runCase('unconfirmed statuses raise family attention, completed does not', () => {
  for (const status of ['pending', 'in_progress', 'dismissed'] as const) {
    const view = buildMedicationCareView({ ...baseInput, tasks: [medicationTask(status)] });
    assert(view.needsAttention, `${status} medication must ask the family to reach out`);
    assert(view.attentionMessage === MEDICATION_ATTENTION_MESSAGE, 'attention message must stay the documented copy');
  }
  const done = buildMedicationCareView({ ...baseInput, tasks: [medicationTask('completed')] });
  assert(!done.needsAttention, 'completed medication must not raise family attention');
});

runCase('medication-related notifications raise family attention', () => {
  const view = buildMedicationCareView({
    ...baseInput,
    tasks: [medicationTask('completed')],
    notifications: [notification('漏服药物提醒', '老人今天提到忘记吃药，请跟进确认。')],
  });
  assert(view.needsAttention, 'medication-related notification must raise family attention');
});

runCase('doctor entry hides when communityDoctorPhone is missing', () => {
  const view = buildMedicationCareView({ ...baseInput, communityDoctorPhone: undefined });
  assert(!view.showDoctorEntry, 'doctor entry must hide when no phone is configured');
});
