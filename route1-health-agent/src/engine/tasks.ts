import type { CareTask, Finding, TaskStatus } from '../types';

/**
 * Phase 1 的任务不是固定待办清单。
 * 只有老人主动提出需要帮助，或检测到值得行动的变化，才生成任务。
 */
export function buildInitialTasks(_today: string): CareTask[] {
  return [];
}

export function createTaskFromFinding(finding: Finding, today: string): CareTask | null {
  if (!finding.carePath) return null;
  const stableKey = finding.ruleId ?? finding.id;
  const shouldContactFamily = finding.familyEligible !== false && Boolean(finding.familyMessage);
  const kind: CareTask['kind'] = shouldContactFamily
    ? 'contact_family'
    : finding.severity === 'urgent'
      ? 'safety_check'
      : 'observation';

  return {
    id: `task-finding-${stableKey}`,
    title: shouldContactFamily
      ? finding.severity === 'urgent'
        ? '立即联系家属确认安全'
        : '今天和家属同步这项变化'
      : finding.severity === 'urgent'
        ? '立即确认当前安全情况'
        : '今天确认一次当前状态',
    description: shouldContactFamily ? (finding.familyMessage ?? finding.carePath) : finding.carePath,
    dueDate: today,
    status: 'pending',
    createdAt: `${today}T12:00:00`,
    sourceFindingId: finding.id,
    kind,
  };
}

/**
 * Medication checks are keyed by calendar day, not by each utterance.
 * Once a task for the same day exists, repeated mentions must never create a
 * second object with the same React key. This remains true even after the task
 * is completed: a later reminder reuses the existing task rather than cloning it.
 */
export function ensureMedicationCheckTask(tasks: CareTask[], today: string, createdAt: string): CareTask[] {
  const taskId = `task-medication-${today}`;
  if (tasks.some((task) => task.id === taskId)) return tasks;
  if (tasks.some((task) => task.kind === 'medication_check' && task.dueDate === today && task.status === 'pending')) {
    return tasks;
  }

  return [
    ...tasks,
    {
      id: taskId,
      title: '确认今天是否按原来的医生方案服药',
      description: '不要自行加倍或调整药量，只确认并按原方案处理。',
      dueDate: today,
      status: 'pending',
      createdAt,
      kind: 'medication_check',
    },
  ];
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
