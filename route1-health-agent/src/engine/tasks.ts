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
  return {
    id: `task-finding-${finding.id}`,
    title: finding.severity === 'urgent' ? '立即确认当前安全情况' : '今天确认一次当前状态',
    description: finding.carePath,
    dueDate: today,
    status: 'pending',
    createdAt: `${today}T12:00:00`,
    sourceFindingId: finding.id,
    kind: finding.severity === 'urgent' ? 'safety_check' : 'observation',
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
