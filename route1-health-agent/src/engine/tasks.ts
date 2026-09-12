import type { CareTask, CareTaskAction, Finding, TaskStatus } from '../types';

/**
 * Phase 1 的任务不是固定待办清单。
 * 只有老人主动提出需要帮助，或检测到值得行动的变化，才生成任务。
 *
 * 文案边界（评审 P0-3）：familyMessage / carePath 都是写给家属的文案
 * （"建议今天联系老人确认状态"），对老人本人是第三人称。老人端任务的
 * description 一律使用老人视角的自有文案，绝不复用这两者。
 */
export function buildInitialTasks(_today: string): CareTask[] {
  return [];
}

export function createTaskFromFinding(finding: Finding, today: string): CareTask | null {
  if (!finding.carePath) return null;
  const stableKey = finding.ruleId ?? finding.id;
  const shouldContactFamily = finding.familyEligible === true && Boolean(finding.familyMessage);
  const kind: CareTask['kind'] = shouldContactFamily
    ? 'contact_family'
    : finding.severity === 'urgent'
      ? 'safety_check'
      : 'observation';

  const description = shouldContactFamily
    ? '这件事值得让家里人知道。按下面的按钮就能联系；也可以先跟我说说现在的情况。'
    : finding.severity === 'urgent'
      ? '先确认自己现在是否安全：能不能站稳、有没有明显疼痛或头晕。需要帮助就直接按下面的电话。'
      : '回头感受一下今天的状态，有变化随时告诉我。';

  const actions: CareTaskAction[] | undefined = shouldContactFamily
    ? ['call_family', 'request_share']
    : finding.severity === 'urgent'
      ? ['call_family']
      : undefined;

  return {
    id: `task-finding-${stableKey}`,
    title: shouldContactFamily
      ? finding.severity === 'urgent'
        ? '立即让家里人知道'
        : '今天让家里人知道这件事'
      : finding.severity === 'urgent'
        ? '立即确认当前安全情况'
        : '今天确认一次当前状态',
    description,
    dueDate: today,
    status: 'pending',
    createdAt: `${today}T12:00:00`,
    sourceFindingId: finding.id,
    kind,
    ...(actions ? { actions } : {}),
  };
}

export function updateTaskStatus(task: CareTask, status: TaskStatus, completionNote?: string): CareTask {
  const next: CareTask = { ...task, status };
  if (status === 'completed') next.completionNote = completionNote ?? '已完成';
  if (status !== 'completed') delete next.completionNote;
  return next;
}

export function taskSummary(tasks: CareTask[]): { pending: number; inProgress: number; completed: number } {
  return tasks.reduce(
    (summary, task) => {
      if (task.status === 'pending') summary.pending += 1;
      if (task.status === 'in_progress') summary.inProgress += 1;
      if (task.status === 'completed') summary.completed += 1;
      return summary;
    },
    { pending: 0, inProgress: 0, completed: 0 },
  );
}
