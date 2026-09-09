import { collectFamilyNotifications } from '../src/engine/escalate';
import { familyVisibleFindings, familyVisibleTasks, consumeOneTimeShareIds } from '../src/engine/familyDisclosure';
import { createTaskFromFinding } from '../src/engine/tasks';
import type { CareTask, Finding } from '../src/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCase(name: string, fn: () => void) {
  fn();
  console.log(`PASS: ${name}`);
}

const baseFinding: Finding = {
  id: 'finding-1',
  date: '2026-09-09',
  severity: 'alert',
  title: '近期变化',
  detail: 'detail',
  evidence: ['internal evidence'],
  familyMessage: '请联系老人确认情况。',
  carePath: '先联系老人',
  familyEligible: true,
};

runCase('family disclosure is fail-closed when familyEligible is omitted', () => {
  const finding = { ...baseFinding, familyEligible: undefined };
  assert(familyVisibleFindings([finding]).length === 0, 'undefined family eligibility must stay hidden');
  assert(collectFamilyNotifications([finding], 'granted').length === 0, 'undefined eligibility must never notify family');
});

runCase('watch-level findings remain elder-only', () => {
  const finding = { ...baseFinding, severity: 'watch' as const };
  assert(familyVisibleFindings([finding]).length === 0, 'watch findings must stay elder-only');
});

runCase('only explicitly shareable alert and urgent findings are disclosed', () => {
  const urgent = { ...baseFinding, id: 'urgent', severity: 'urgent' as const };
  const alert = { ...baseFinding, id: 'alert', severity: 'alert' as const };
  const info = { ...baseFinding, id: 'info', severity: 'info' as const };
  assert(familyVisibleFindings([urgent, alert, info]).length === 2, 'only alert and urgent findings should be shared');
});

const visibleFinding: Finding = { ...baseFinding, id: 'visible' };
const privateFinding: Finding = { ...baseFinding, id: 'private', familyEligible: false, severity: 'urgent' };
const unspecifiedFinding: Finding = { ...baseFinding, id: 'unspecified', familyEligible: undefined, severity: 'urgent' };

runCase('non-shareable urgent findings never create family contact tasks', () => {
  const task = createTaskFromFinding(unspecifiedFinding, '2026-09-09');
  assert(task?.kind !== 'contact_family', 'missing family eligibility must not create contact_family');
  assert(task?.sourceFindingId === unspecifiedFinding.id, 'the task may remain elder-side and keep lineage');
  const privateTask = createTaskFromFinding(privateFinding, '2026-09-09');
  assert(privateTask?.kind === 'safety_check', 'private urgent finding should remain an elder safety task');
});

const tasks: CareTask[] = [
  {
    id: 'med',
    title: '确认服药',
    description: '老人侧任务',
    dueDate: '2026-09-09',
    status: 'pending',
    createdAt: '2026-09-09T08:00:00Z',
    kind: 'medication_check',
  },
  {
    id: 'family',
    title: '联系老人',
    description: '家属协同',
    dueDate: '2026-09-09',
    status: 'pending',
    createdAt: '2026-09-09T08:00:00Z',
    kind: 'contact_family',
  },
  {
    id: 'safety',
    title: '确认安全',
    description: '通用安全核实',
    dueDate: '2026-09-09',
    status: 'pending',
    createdAt: '2026-09-09T08:00:00Z',
    kind: 'safety_check',
  },
  {
    id: 'private-safety',
    title: '私密安全任务',
    description: '私密 finding 产生的安全任务',
    dueDate: '2026-09-09',
    status: 'pending',
    createdAt: '2026-09-09T08:00:00Z',
    kind: 'safety_check',
    sourceFindingId: privateFinding.id,
  },
  {
    id: 'private-linked',
    title: '私域任务',
    description: '不应因关联 finding 而暴露',
    dueDate: '2026-09-09',
    status: 'pending',
    createdAt: '2026-09-09T08:00:00Z',
    kind: 'observation',
    sourceFindingId: privateFinding.id,
  },
  {
    id: 'visible-linked',
    title: '跟进变化',
    description: '与可共享发现关联',
    dueDate: '2026-09-09',
    status: 'pending',
    createdAt: '2026-09-09T08:00:00Z',
    kind: 'observation',
    sourceFindingId: visibleFinding.id,
  },
];

runCase('family task disclosure excludes unrelated private tasks', () => {
  const visible = familyVisibleTasks(tasks, [visibleFinding]);
  const ids = visible.map((task) => task.id);
  assert(!ids.includes('med'), 'medication task must remain elder-only');
  assert(ids.includes('family'), 'contact-family task should remain visible');
  assert(ids.includes('safety'), 'generic safety-check task should remain visible');
  assert(ids.includes('visible-linked'), 'task linked to a visible finding should remain visible');
  assert(!ids.includes('private-safety'), 'safety task linked to a private finding must stay hidden');
  assert(!ids.includes('private-linked'), 'task linked to a private finding must stay hidden');
});

runCase('one-time share consumption removes only consumed ids', () => {
  const result = consumeOneTimeShareIds(['a', 'b', 'c'], ['b']);
  assert(result.length === 2 && result[0] === 'a' && result[1] === 'c', 'unrelated share ids must survive consumption');
});

console.log('PASS: family minimum-necessary disclosure boundary');
