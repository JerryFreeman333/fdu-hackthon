/** 路线一领域模型：老人、健康事件、家庭事件、发现与 Agent。 */

export type DataSource = 'demo' | 'device' | 'photo' | 'manual' | 'import' | 'chat';
export type UserRole = 'elder' | 'family';
export type FamilySharing = 'granted' | 'ask' | 'denied';
export type NightVisionStatus = 'normal' | 'reduced' | 'unknown';
export type CognitionStatus = 'stable' | 'mild_change' | 'unknown';
export type MobilityStatus = 'independent' | 'uses_cane' | 'needs_support' | 'unknown';
export type PrivacyScope = 'private' | 'family_ok';
export type FamilyShareMode = 'private' | 'persistent' | 'one_time';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';
export type ElderSubject = 'self' | 'spouse' | 'father' | 'mother' | 'family_other' | 'unknown';
export type ClaimStatus = 'occurred' | 'negated' | 'hypothetical' | 'uncertain' | 'near_miss';

export interface FamilyLink {
  id: string;
  relation: string;
  displayName: string;
  maskedContact: string;
  inviteCode: string;
  status: 'active' | 'pending';
}

export interface CareTask {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  status: TaskStatus;
  createdAt: string;
  sourceFindingId?: string;
  kind: 'medication_check' | 'safety_check' | 'contact_family' | 'observation';
  completionNote?: string;
}

export interface ConsentState {
  familySharing: FamilySharing;
  familyLink: FamilyLink | null;
  updatedAt: string;
}

export type MetricKey =
  | 'steps'
  | 'walkSpeed'
  | 'sleepHours'
  | 'nightWakes'
  | 'restingHr'
  | 'weight'
  | 'spo2'
  | 'systolic'
  | 'diastolic'
  | 'bloodGlucose';

export interface MetricMeta {
  key: MetricKey;
  label: string;
  unit: string;
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
  bloodGlucose: { key: 'bloodGlucose', label: '血糖', unit: 'mmol/L', higherIsBad: true, decimals: 1 },
};

export interface HealthMeasurement {
  id: string;
  timestamp: string;
  metric: MetricKey;
  value: number;
  unit: string;
  source: DataSource;
  confidence?: number;
  visibility?: PrivacyScope;
  metadata?: Record<string, string | number | boolean>;
}

export interface DayRecord {
  date: string;
  metrics: Partial<Record<MetricKey, number>>;
  measurements?: HealthMeasurement[];
}

export interface LabResult {
  id: string;
  timestamp: string;
  name: string;
  value: number;
  unit: string;
  source: DataSource;
  confidence?: number;
  visibility?: PrivacyScope;
  referenceRange?: { low?: number; high?: number };
}

export type SymptomTag =
  | 'fatigue'
  | 'dyspnea'
  | 'poorSleep'
  | 'edema'
  | 'dizziness'
  | 'medicationMissed'
  | 'pain'
  | 'moodLow'
  | 'fall'
  | 'bpHigh'
  | 'spo2Low'
  | 'hrHigh'
  | 'hrLow'
  | 'glucoseHigh'
  | 'glucoseLow'
  | 'chestPain'
  | 'neuroChange';

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
  chestPain: '胸痛',
  neuroChange: '突发神经系统异常',
  spo2Low: '血氧偏低',
  hrHigh: '心率偏快',
  hrLow: '心率偏慢',
  glucoseHigh: '血糖偏高',
  glucoseLow: '血糖偏低',
};

export interface Observation {
  id: string;
  date: string;
  source: DataSource;
  text: string;
  tags: SymptomTag[];
  visibility?: PrivacyScope;
  measurements?: HealthMeasurement[];
  labResults?: LabResult[];
  metadata?: Record<string, string | number | boolean>;
}

/** 家庭成员事实账本：独立于老人的 HealthEvent，不参与老人基线/检测。 */
export interface FamilyHealthEvent {
  id: string;
  timestamp: string;
  source: DataSource;
  subject: Exclude<ElderSubject, 'self' | 'unknown'>;
  text: string;
  tags: SymptomTag[];
  hasHealthValue: boolean;
  status: ClaimStatus;
  visibility: PrivacyScope;
  shareMode: FamilyShareMode;
  sourceMessageId?: string;
}

export type Severity = 'info' | 'watch' | 'alert' | 'urgent';

export interface Finding {
  id: string;
  date: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: string[];
  familyMessage?: string;
  carePath?: string;
  ruleId?: string;
  score?: number;
  signalKeys?: string[];
  familyEligible?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'elder' | 'agent';
  text: string;
  time: string;
  persisted?: boolean;
}

export interface ElderProfile {
  name: string;
  age: number;
  conditions: string[];
  medications: string[];
  familyContact: string;
  mobility: MobilityStatus;
  usesCane: boolean;
  nightVision: NightVisionStatus;
  cognition: CognitionStatus;
  familySharing: FamilySharing;
}
