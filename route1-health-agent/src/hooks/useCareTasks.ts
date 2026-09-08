import { useEffect, useRef, useState } from 'react';
import type { CareTask, Finding, PrivacyScope } from '../types';
import { TODAY } from '../data/demo';
import { buildInitialTasks, createTaskFromFinding, updateTaskStatus } from '../engine/tasks';

const TASK_KEY = 'ankang-personal-tasks-v1';

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
  onStorageError?: () => void;
}

export function useCareTasks({ findings, onStorageError }: UseCareTasksOptions) {
  const [tasks, setTasks] = useState<CareTask[]>(() => loadTasks());

  const lastSaved = useRef(JSON.stringify(tasks));
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key !== TASK_KEY && event.key !== null) return;
      const next = loadTasks();
      lastSaved.current = JSON.stringify(next);
      setTasks(next);
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    try {
      const serialized = JSON.stringify(tasks);
      if (serialized === lastSaved.current) return;
      window.localStorage.setItem(TASK_KEY, serialized);
      lastSaved.current = serialized;
    } catch {
      onStorageError?.();
    }
  }, [tasks, onStorageError]);

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

  function ensureMedicationCheck(createdAt: string, visibility: PrivacyScope = 'private') {
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
          visibility,
        },
      ];
    });
  }

  return { tasks, updateStatus, ensureMedicationCheck };
}
