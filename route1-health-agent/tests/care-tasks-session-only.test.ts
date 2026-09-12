import type { CareTask } from '../src/types';
import { shouldCreateMedicationCheck } from '../src/hooks/useCareTasks';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const demoTask: CareTask = {
  id: 'task-session-only',
  title: '确认今天是否按原来的医生方案服药',
  description: '不要自行加倍或调整药量，只确认并按原方案处理。',
  dueDate: '2026-09-09',
  status: 'pending',
  createdAt: '2026-09-09T08:00:00.000Z',
  kind: 'medication_check',
};

let sessionTasks: CareTask[] | null = null;
const storage = {
  removed: new Set<string>(),
  getItem() {
    throw new Error('legacy task state must never be read');
  },
  setItem() {
    throw new Error('task state must never be persisted');
  },
  removeItem(key: string) {
    this.removed.add(key);
  },
};

function loadTasks(): CareTask[] {
  storage.removeItem('ankang-route1-tasks-v2');
  if (sessionTasks) return sessionTasks.map((task) => ({ ...task }));
  sessionTasks = [];
  return [];
}

function saveTasks(tasks: CareTask[]) {
  sessionTasks = tasks.map((task) => ({ ...task }));
}

saveTasks([demoTask]);
assert(loadTasks()[0]?.id === demoTask.id, 'current session should retain task state');
assert(!shouldCreateMedicationCheck([demoTask], demoTask.dueDate), 'pending medication task must not duplicate');
assert(
  !shouldCreateMedicationCheck([{ ...demoTask, status: 'completed' }], demoTask.dueDate),
  'completed medication task must not reappear on the same day',
);
assert(storage.removed.has('ankang-route1-tasks-v2'), 'legacy persisted task key should be purged');

sessionTasks = null;
assert(loadTasks().length === 0, 'new session must not inherit prior task state');

console.log('PASS: care tasks are session-only and legacy persistence is purged');
