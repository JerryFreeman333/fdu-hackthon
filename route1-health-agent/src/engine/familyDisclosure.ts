import type { CareTask, Finding } from '../types';

const FAMILY_FINDING_LEVELS = new Set<Finding['severity']>(['alert', 'urgent']);

/** 家属端最小必要披露：只有明确允许共享且确有需要介入的发现才进入共享视图。 */
export function familyVisibleFindings(findings: Finding[]): Finding[] {
  return findings.filter((finding) => finding.familyEligible === true && FAMILY_FINDING_LEVELS.has(finding.severity));
}

/**
 * 家属任务也必须通过同一条披露边界。
 * 与私密 finding 关联的 safety_check 不能仅凭任务类型被家属看到；
 * 无 sourceFindingId 的 safety_check 才可作为不泄露具体病情的通用安全协同任务展示。
 */
export function familyVisibleTasks(tasks: CareTask[], visibleFindings: Finding[]): CareTask[] {
  const visibleFindingIds = new Set(visibleFindings.map((finding) => finding.id));
  return tasks.filter((task) => {
    if (task.status === 'completed' || task.status === 'dismissed') return false;
    if (task.kind === 'contact_family') return true;
    if (typeof task.sourceFindingId === 'string') return visibleFindingIds.has(task.sourceFindingId);
    return task.kind === 'safety_check';
  });
}

/** Consuming a one-time grant is idempotent and leaves unrelated grants untouched. */
export function consumeOneTimeShareIds(currentIds: string[], consumedIds: string[]): string[] {
  if (consumedIds.length === 0) return currentIds;
  const consumed = new Set(consumedIds);
  return currentIds.filter((id) => !consumed.has(id));
}
