import { useEffect, useState } from 'react';
import type { CareTask, Finding } from '../types';
import { TODAY } from '../data/demo';
import { buildInitialTasks, createTaskFromFinding, ensureMedicationCheckTask, updateTaskStatus } from '../engine/tasks';

/**
 * Route 1 Demo 任务状态只存在当前页面会话。
 * 任务标题/描述可能暴露健康风险，因此不能跨浏览器会话持久化到 localStorage。
 */
interface UseCareTasksOptions {
  findings: Finding[];
}

export function useCareTasks({ findings }: UseCareTasksOptions) {
  const [tasks, setTasks] = useState<CareTask[]>(() => buildInitialTasks(TODAY));

  useEffect(() => {
    const actionable = findings.filter((finding) => finding.severity === 'alert' || finding.severity === 'urgent');
    const currentFindingIds = new Set(findings.map((finding) => finding.id));
    setTasks((current) => {
      const reconciled = current.filter(
        (task) => !task.sourceFindingId || currentFindingIds.has(task.sourceFindingId) || task.status === 'completed',
      );
      const next = [...reconciled];
      for (const finding of actionable.slice(0, 2)) {
        const task = createTaskFromFinding(finding, TODAY);
        if (task && !next.some((item) => item.id === task.id)) next.push(task);
      }
      return next;
    });
  }, [findings]);

  function updateStatus(taskId: string, status: CareTask['status']) {
    setTasks((current) => current.map((task) => (task.id === taskId ? updateTaskStatus(task, status) : task)));
  }

  function ensureMedicationCheck(createdAt: string) {
    setTasks((current) => ensureMedicationCheckTask(current, TODAY, createdAt));
  }

  return { tasks, updateStatus, ensureMedicationCheck };
}
