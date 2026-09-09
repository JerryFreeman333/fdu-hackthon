import type { CareTask, Finding } from '../types';

const FAMILY_FINDING_LEVELS = new Set<Finding['severity']>(['alert', 'urgent']);

/** 家属端最小必要披露：只有明确允许共享且确有需要介入的发现才进入共享视图。 */
export function familyVisibleFindings(findings: Finding[]): Finding[] {
  return findings.filter(
    (finding) => finding.familyEligible === true && FAMILY_FINDING_LEVELS.has(finding.severity),
  );
}

/** 家属只处理与可共享安全发现直接相关的任务，避免把老人私域任务变成家属待办。 */
export function familyVisibleTasks(tasks: CareTask[], visibleFindings: Finding[]): CareTask[] {
  const visibleFindingIds = new Set(visibleFindings.map((finding) => finding.id));
  return tasks.filter(
    (task) =>
      task.status !== 'completed' &&
      task.status !== 'dismissed' &&
      (task.kind === 'contact_family' ||
        task.kind === 'safety_check' ||
        (typeof task.sourceFindingId === 'string' && visibleFindingIds.has(task.sourceFindingId))),
  );
}
