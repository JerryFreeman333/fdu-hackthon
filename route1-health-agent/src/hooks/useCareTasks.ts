import { useEffect, useState } from 'react';
import type { CareTask, Finding } from '../types';
import { TODAY } from '../data/demo';
import { buildInitialTasks, createTaskFromFinding, updateTaskStatus } from '../engine/tasks';

const TASK_KEY = 'ankang-route1-tasks-v2';

type StoredTask = CareTask;

function loadTasks(): CareTask[] {
  try {
    const raw = window.localStorage.getItem(TASK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredTask[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // use an empty task list rather than inventing daily work
  }
  return buildInitialTasks(TODAY);
}

interface UseCareTasksOptions {
  findings: Finding[];
}

export function useCareTasks({ findings }: UseCareTasksOptions) {
  const [tasks, setTasks] = useState<CareTask[]>(() => loadTasks());

  useEffect(() => {
    window.localStorage.setItem(TASK_KEY, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    const actionable = findings.filter((finding) => finding.severity === 'alert' || finding.severity === 'urgent');
    if (actionable.length === 0) return;
    setTasks((current) => {
      const next = [...current];
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
    setTasks((current) => {
      if (
        current.some((task) => task.kind === 'medication_check' && task.dueDate === TODAY && task.status === 'pending')
      ) {
        return current;
      }
      return [
        ...current,
        {
          id: `task-medication-${TODAY}`,
          title: '确认今天是否按原来的医生方案服药',
          description: '不要自行加倍或调整药量，只确认并按原方案处理。',
          dueDate: TODAY,
          status: 'pending',
          createdAt,
          kind: 'medication_check',
        },
      ];
    });
  }

  return { tasks, updateStatus, ensureMedicationCheck };
}
