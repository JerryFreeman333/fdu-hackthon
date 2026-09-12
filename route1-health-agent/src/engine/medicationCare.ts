/**
 * 子女端"用药与医护"视图模型：只汇总已有数据，不做任何医疗判断。
 * 数据来源仅限 ElderProfile.medications、今日 medication_check 任务、
 * 既有家属通知与 communityDoctorPhone；绝不推断药物用途、副作用或诊断。
 */
import type { CareTask, FamilySharing, TaskStatus } from '../types';
import type { FamilyNotification } from './escalate';

export interface MedicationItem {
  /** 原始字符串，解析失败时整串回退展示 */
  raw: string;
  name: string;
  dose?: string;
  frequency?: string;
}

const DOSE_PATTERN = /^\d+(\.\d+)?(mg|μg|ug|g|ml|iu)$/i;
const FREQUENCY_HEADS = ['每日', '每天', '每晚', '每周', '隔天', '必要时'];
const FREQUENCY_TAILS = ['一次', '两次', '三次'];

function isFrequency(token: string): boolean {
  return FREQUENCY_HEADS.some((head) => token.startsWith(head)) || FREQUENCY_TAILS.some((tail) => token.endsWith(tail));
}

/**
 * 保守拆解"药名 剂量 频次"；任何一段拆不稳定就整串回退，宁缺毋错。
 */
export function parseMedication(raw: string): MedicationItem {
  const trimmed = raw.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { raw: trimmed, name: trimmed };

  let dose: string | undefined;
  let frequency: string | undefined;
  const nameTokens: string[] = [];
  for (const token of tokens) {
    if (!dose && DOSE_PATTERN.test(token)) {
      dose = token;
    } else if (!frequency && isFrequency(token)) {
      frequency = token;
    } else {
      nameTokens.push(token);
    }
  }
  if (!dose && !frequency) return { raw: trimmed, name: trimmed };
  const name = nameTokens.join(' ');
  if (!name) return { raw: trimmed, name: trimmed };
  return { raw: trimmed, name, dose, frequency };
}

const MEDICATION_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待确认',
  in_progress: '进行中',
  completed: '已完成',
  dismissed: '已跳过 / 未确认',
};

export function medicationStatusLabel(status: TaskStatus): string {
  return MEDICATION_STATUS_LABELS[status];
}

export function todayMedicationTasks(tasks: CareTask[], today: string): CareTask[] {
  return tasks.filter((task) => task.kind === 'medication_check' && task.dueDate === today);
}

export interface MedicationCareView {
  authorized: boolean;
  medications: MedicationItem[];
  todayStatuses: { id: string; status: TaskStatus; label: string }[];
  hasTodayRecord: boolean;
  needsAttention: boolean;
  attentionMessage: string;
  showDoctorEntry: boolean;
}

export const MEDICATION_ATTENTION_MESSAGE = '今天的服药还没有确认，建议先联系老人。';

function hasMedicationRelatedNotification(notifications: FamilyNotification[]): boolean {
  return notifications.some((notification) => {
    const text = `${notification.finding.title}${notification.message}`;
    return text.includes('药');
  });
}

/**
 * 子女端"用药与医护"页的唯一数据入口：未授权时 medication 内容为空，
 * 由 UI 层的 fail-closed 隐私卡兜底，这里不再额外放行任何数据。
 */
export function buildMedicationCareView(input: {
  medications: string[];
  tasks: CareTask[];
  today: string;
  familySharing: FamilySharing;
  communityDoctorPhone?: string;
  notifications: FamilyNotification[];
}): MedicationCareView {
  const authorized = input.familySharing === 'granted';
  // 与 familyVisibleTasksForSharing 同一条 fail-closed 边界：未授权时连今日服药状态也不出数据层。
  const medicationTasks = authorized ? todayMedicationTasks(input.tasks, input.today) : [];
  const unconfirmed = medicationTasks.some((task) => task.status !== 'completed');
  const needsAttention = authorized && (unconfirmed || hasMedicationRelatedNotification(input.notifications));
  return {
    authorized,
    medications: authorized ? input.medications.map(parseMedication) : [],
    todayStatuses: medicationTasks.map((task) => ({
      id: task.id,
      status: task.status,
      label: medicationStatusLabel(task.status),
    })),
    hasTodayRecord: medicationTasks.length > 0,
    needsAttention,
    attentionMessage: MEDICATION_ATTENTION_MESSAGE,
    showDoctorEntry: Boolean(input.communityDoctorPhone),
  };
}
