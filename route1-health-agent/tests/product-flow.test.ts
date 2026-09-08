import assert from 'node:assert/strict';
import { localDate } from '../src/engine/date';
import { emptyProfile, validateProfile } from '../src/engine/profile';
import { buildAgentContext } from '../src/engine/context';
import { familyEvents, familyTasks, shareObservation } from '../src/engine/familyAccess';
import { buildWeeklyReport } from '../src/engine/report';
import { updateTaskStatus } from '../src/engine/tasks';
import type { CareTask, FamilyLink, Finding } from '../src/types';
import type { HealthEvent } from '../src/pipeline/events';

const today = '2026-09-08';
assert.equal(localDate(new Date(2026, 8, 8, 0, 1)), today, 'local midnight must not shift to the previous UTC day');
const profile = validateProfile({
  ...emptyProfile,
  name: '测试阿姨',
  age: 72,
  conditions: ['高血压'],
  mobility: 'uses_cane',
  usesCane: true,
  usualNightWakes: 2,
  profileUpdatedAt: `${today}T10:00:00`,
});
assert.equal(validateProfile(emptyProfile).age, null, 'skipped age is unknown, not a demo value');
assert.throws(() => validateProfile({ ...emptyProfile, age: -2 }));
assert.throws(() => validateProfile({ ...emptyProfile, usualNightWakes: 1.5 }));
const context = buildAgentContext(profile, [], today, []);
assert.equal(context.personTwin.functionalProfile.usesCane, true);
assert.deepEqual(context.personTwin.background.conditions, ['高血压']);
assert.equal(context.personTwin.background.usualNightWakes, 2);
assert.equal(context.metrics.length, 0, 'background answers must not become new health events');

const link: FamilyLink = {
  id: 'test',
  relation: '家属',
  displayName: '测试家属',
  maskedContact: '',
  inviteCode: 'TEST',
  status: 'active',
};
const events: HealthEvent[] = ['private', 'family_ok'].map((visibility, index) => ({
  id: `${index}`,
  type: 'observation',
  source: 'chat',
  timestamp: `${today}T10:00:00`,
  observation: {
    id: `${index}`,
    date: today,
    source: 'chat',
    text: visibility === 'private' ? '私密内容' : '公开记录',
    tags: [],
    visibility: visibility as 'private' | 'family_ok',
  },
}));
const task: CareTask = {
  id: 'task',
  title: '待办',
  description: '状态确认',
  dueDate: today,
  status: 'pending',
  createdAt: `${today}T09:00:00`,
  kind: 'observation',
  visibility: 'family_ok',
};
assert.deepEqual(
  familyEvents(events, 'granted', link).map((event) => event.id),
  ['1'],
);
assert.equal(familyEvents(events, 'granted', null).length, 0);
assert.equal(familyTasks([task, { ...task, id: 'private', visibility: 'private' }], [], 'granted', link).length, 1);
for (const permission of ['denied', 'ask'] as const) {
  assert.equal(familyEvents(events, permission, link).length, 0, 'revocation hides report data');
  assert.equal(familyTasks([task], [], permission, link).length, 0, 'revocation hides tasks');
}
const privateFinding: Finding = {
  id: 'finding',
  date: today,
  severity: 'alert',
  title: '私密变化',
  detail: '',
  evidence: [],
  familyEligible: false,
};
assert.equal(familyTasks([{ ...task, sourceFindingId: 'finding' }], [privateFinding], 'granted', link).length, 0);

const completed = updateTaskStatus(task, 'completed', undefined, `${today}T10:00:00`);
assert.equal(completed.completedAt, `${today}T10:00:00`);
assert.equal(updateTaskStatus(completed, 'pending').completedAt, undefined);
const report = buildWeeklyReport([], [], [], today, [
  completed,
  { ...completed, id: 'old', title: '上个月完成', completedAt: '2026-08-01T10:00:00' },
  { ...completed, id: 'legacy', title: '历史时间不详', completedAt: undefined },
]);
const reportText = JSON.stringify(report);
assert.match(reportText, /已完成 1 项/);
assert.doesNotMatch(reportText, /上个月完成|历史时间不详/);
assert.match(report.forElder, /暂无足够记录/);
assert.doesNotMatch(report.forFamily, /正常|整体平稳/);
const privateObs = events[0].type === 'observation' ? [events[0].observation] : [];
assert.match(JSON.stringify(buildWeeklyReport([], privateObs, [], today, [], 'elder')), /私密内容/);
assert.doesNotMatch(JSON.stringify(buildWeeklyReport([], privateObs, [], today, [], 'family')), /私密内容/);
console.log('PASS: profile validation, context, bound-only sharing, revocation, private tasks and report dates');

const onceEvents = shareObservation(events, '0', 'denied', link);
assert.deepEqual(
  familyEvents(onceEvents, 'denied', link).map((e) => e.id),
  ['0'],
  'one record can be shared without ongoing consent',
);
assert.equal(familyEvents(onceEvents, 'denied', null).length, 0, 'binding remains required');
assert.equal(familyEvents(events, 'denied', link).length, 0, 'sharing does not mutate historical records');
