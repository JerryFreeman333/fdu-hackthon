/** 领域模型与类型定义 —— 路线一：老年健康 Agent */

/** 可观测指标（来自手表/手机/拍照录入） */
export type MetricKey =
  | 'steps'
  | 'walkSpeed'
  | 'sleepHours'
  | 'nightWakes'
  | 'restingHr'
  | 'weight'
  | 'spo2'
  | 'systolic'
  | 'diastolic';

export interface MetricMeta {
  key: MetricKey;
  label: string;
  unit: string;
  /** 该指标升高是否代表变差（steps 升高是好事，restingHr 升高是坏事） */
  higherIsBad: boolean;
  decimals: number;
}

export const METRICS: Record<MetricKey, MetricMeta> = {
  steps: { key: 'steps', label: '活动步数', unit: '步', higherIsBad: false, decimals: 0 },
  walkSpeed: { key: 'walkSpeed', label: '步行速度', unit: 'm/s', higherIsBad: false, decimals: 2 },
  sleepHours: { key: 'sleepHours', label: '睡眠时长', unit: '小时', higherIsBad: false, decimals: 1 },
  nightWakes: { key: 'nightWakes', label: '夜间醒来', unit: '次', higherIsBad: true, decimals: 0 },
  restingHr: { key: 'restingHr', label: '静息心率', unit: 'bpm', higherIsBad: true, decimals: 0 },
  weight: { key: 'weight', label: '体重', unit: 'kg', higherIsBad: true, decimals: 1 },
  spo2: { key: 'spo2', label: '血氧', unit: '%', higherIsBad: false, decimals: 0 },
  systolic: { key: 'systolic', label: '收缩压', unit: 'mmHg', higherIsBad: true, decimals: 0 },
  diastolic: { key: 'diastolic', label: '舒张压', unit: 'mmHg', higherIsBad: true, decimals: 0 },
};

/** 某一天的整体记录（设备同步 + 拍照录入合并而成） */
export interface DayRecord {
  date: string; // YYYY-MM-DD
  metrics: Partial<Record<MetricKey, number>>;
}

/** 主观症状标签（从聊天里识别出来） */
export type SymptomTag =
  | 'fatigue' // 乏力/累
  | 'dyspnea' // 气喘/气短
  | 'poorSleep' // 睡不好
  | 'edema' // 水肿
  | 'dizziness' // 头晕
  | 'medicationMissed' // 漏服药
  | 'pain' // 疼痛
  | 'moodLow' // 情绪低落
  | 'fall' // 跌倒
  | 'bpHigh'; // 血压偏高

export const SYMPTOM_LABELS: Record<SymptomTag, string> = {
  fatigue: '疲劳乏力',
  dyspnea: '活动后气喘',
  poorSleep: '睡眠变差',
  edema: '水肿',
  dizziness: '头晕',
  medicationMissed: '漏服药物',
  pain: '疼痛',
  moodLow: '情绪低落',
  fall: '跌倒',
  bpHigh: '血压偏高',
};

/** 一次主观/客观观察（聊天、拍照、设备摘要） */
export interface Observation {
  id: string;
  date: string;
  source: 'chat' | 'photo' | 'device';
  text: string;
  tags: SymptomTag[];
}

/** 发现的严重程度 —— 决定通知谁 */
export type Severity = 'info' | 'watch' | 'alert' | 'urgent';

export interface Finding {
  id: string;
  date: string;
  severity: Severity;
  title: string;
  /** 面向老人的白话解释 */
  detail: string;
  /** 证据链：具体数字对比 */
  evidence: string[];
  /** 面向家属的推送文案（alert/urgent 时有值） */
  familyMessage?: string;
  /** 就医/联系路径建议（urgent 时有值） */
  carePath?: string;
}

export interface ChatMessage {
  id: string;
  role: 'elder' | 'agent';
  text: string;
  time: string;
}

/** 老人档案 */
export interface ElderProfile {
  name: string;
  age: number;
  conditions: string[];
  medications: string[];
  familyContact: string;
}
