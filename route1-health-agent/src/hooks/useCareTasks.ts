import { useEffect, useState } from 'react';
import type { CareTask, Finding } from '../types';
import { buildInitialTasks, createTaskFromFinding, updateTaskStatus } from '../engine/tasks';

const LEGACY_TASK_KEY = 'ankang-route1-tasks-v2';
let sessionTasks: CareTask[] | null = null;

function cloneTasks(tasks: CareTask[]): CareTask[] {
  return tasks.map((task) => ({ ...task }));
}

function loadTasks(today: string): CareTask[] {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LEGACY_TASK_KEY);
  }
  if (sessionTasks) return cloneTasks(sessionTasks);
  sessionTasks = buildInitialTasks(today);
  return cloneTasks(sessionTasks);
}

function saveTasks(tasks: CareTask[]): void {
  sessionTasks = cloneTasks(tasks);
}

interface UseCareTasksOptions {
  findings: Finding[];
  /** 注入的"今天"（评审 P1-4）：跨午夜后新任务归到新的一天，不再用模块加载时定格的常量。 */
  today: string;
}

export function useCareTasks({ findings, today }: UseCareTasksOptions) {
  const [tasks, setTasks] = useState<CareTask[]>(() => loadTasks(today));

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    const actionable = findings.filter((finding) => finding.severity === 'alert' || finding.severity === 'urgent');
    const currentFindingIds = new Set(findings.map((finding) => finding.id));
    setTasks((current) => {
      const reconciled = current.filter(
        (task) => !task.sourceFindingId || currentFindingIds.has(task.sourceFindingId) || task.status === 'completed',
      );
      const next = [...reconciled];
      for (const finding of actionable.slice(0, 2)) {
        const task = createTaskFromFinding(finding, today);
        if (task && !next.some((item) => item.id === task.id)) next.push(task);
      }
      return next;
    });
  }, [findings, today]);

  function updateStatus(taskId: string, status: CareTask['status']) {
    setTasks((current) => current.map((task) => (task.id === taskId ? updateTaskStatus(task, status) : task)));
  }

  function ensureMedicationCheck(medications: string[], createdAt?: string) {
    setTasks((current) => {
      if (
        current.some((task) => task.kind === 'medication_check' && task.dueDate === today && task.status === 'pending')
      ) {
        return current;
      }
      const medList = medications.length ? medications.map((m) => `• ${m}`).join('\n') : '• （暂无录入的药物）';
      return [
        ...current,
        {
          id: `task-medication-${today}`,
          title: '💊 今天的药',
          description: `${medList}\n\n按原来的医生方案服用；不要自行加倍或调整药量。`,
          dueDate: today,
          status: 'pending',
          createdAt: createdAt ?? `${today}T08:00:00`,
          kind: 'medication_check',
        },
      ];
    });
  }

  return { tasks, updateStatus, ensureMedicationCheck };
}
