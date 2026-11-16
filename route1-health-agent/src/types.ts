/** 路线一领域模型：老人、健康事件、家庭事件、发现与 Agent。 */

export type DataSource = 'demo' | 'device' | 'photo' | 'manual' | 'import' | 'chat' | 'healthkit';
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

/** 老人端任务卡上可直接执行的动作（评审 P0-3：不允许出现"死胡同任务"）。 */
export type CareTaskAction = 'call_family' | 'request_share';

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
  /** 可直接执行的动作；contact_family 任务必须至少携带一个（不变量测试锁定）。 */
  actions?: CareTaskAction[];
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
  | 'bloodGlucose'
  | 'temperature';

/**
 * 体温测量部位。
 *
 * 体温不是一个"换不换单位"的问题：同一具身体在不同部位测出的读数系统性不同，
 * 用一套阈值套所有读数，等于把腋温的正常值当成耳温的低烧。部位必须随读数一起
 * 落库，否则下游只能靠猜。
 *
 * `unknown` 是显式状态，不允许被默认成 `axillary`：把"没说部位"悄悄当成腋温，
 * 会让耳温读数被系统性低估、漏掉该复测的人。
 */
export type TemperatureSite = 'axillary' | 'oral' | 'ear' | 'forehead' | 'rectal' | 'unknown';

export const TEMPERATURE_SITE_LABELS: Record<TemperatureSite, string> = {
  axillary: '腋温',
  oral: '口温',
  ear: '耳温',
  forehead: '额温',
  rectal: '肛温',
  unknown: '未说明测量部位',
};

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
  temperature: { key: 'temperature', label: '体温', unit: '℃', higherIsBad: true, decimals: 1 },
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
  /**
   * 仅体温使用：测量部位。旧数据 / 拍照 OCR / 设备导入可能缺失，
   * 下游必须按 `unknown` 处理，绝不默认成某个部位。
   */
  temperatureSite?: TemperatureSite;
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
  | 'neuroChange'
  | 'syncope'
  | 'bpLow'
  | 'fever'
  | 'melena'
  | 'palpitations'
  | 'weightLoss';

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
  bpLow: '血压偏低',
  chestPain: '胸痛',
  syncope: '晕厥/意识丧失',
  neuroChange: '突发神经系统异常',
  spo2Low: '血氧偏低',
  hrHigh: '心率偏快',
  hrLow: '心率偏慢',
  glucoseHigh: '血糖偏高',
  glucoseLow: '血糖偏低',
  fever: '发热',
  melena: '黑便/便血',
  palpitations: '心慌心悸',
  weightLoss: '体重下降',
};

export interface Observation {
  id: string;
  date: string;
  source: DataSource;
  text: string;
  tags: SymptomTag[];
  /**
   * 用户原话对应的语义状态（与 understanding.ts 的 ClaimStatus 对齐）。
   * 缺失时按 'occurred' 处理（兼容老数据 / 设备导入 / 拍照 OCR 等非聊天来源）。
   * 聊天产生的 Observation 必须显式写入，否则走不了下游安全规则的过滤。
   */
  status?: ClaimStatus;
  visibility?: PrivacyScope;
  measurements?: HealthMeasurement[];
  labResults?: LabResult[];
  metadata?: Record<string, string | number | boolean>;
}

/**
 * 老人本人的既往健康事实账本（P2-A）。
 *
 * 与 `HealthEvent` 严格隔离：既往事实不写入 `Observation.date`、不进入本人检测，
 * 也不用于今天的安全判断。`eventDate` 只在老人明确说出日期时填写（如“前天”），
 * 日期不详时必须为 null，绝不拿录入当天冒充发生日期。
 */
export interface HistoricalHealthEvent {
  id: string;
  /** 发生日期 YYYY-MM-DD；日期不详为 null。 */
  eventDate: string | null;
  /** 录入时间（本地 ISO 时间戳），仅用于排序/审计。 */
  recordedAt: string;
  source: DataSource;
  text: string;
  tags: SymptomTag[];
  hasHealthValue: boolean;
  status: ClaimStatus;
  visibility: PrivacyScope;
  sourceMessageId?: string;
}

/** 家庭成员事实账本：独立于老人的 HealthEvent，不参与老人基线/检测。 */
export interface FamilyHealthEvent {
  id: string;
  /** 老人提到这件事的录入时间，不是事件发生时间。 */
  timestamp: string;
  /**
   * 事件发生日期（YYYY-MM-DD）；日期不详为 null。
   * 旧数据没有这个字段，读取时用 timestamp 的日期兜底（旧实现把发生日期写进了 timestamp）。
   */
  eventDate?: string | null;
  /** 相对时间语义；用于判断这是不是"当前急症"，而不是用录入时间冒充发生时间。 */
  timeScope?: 'today' | 'yesterday' | 'lastNight' | 'historical' | 'unknown';
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

/**
 * 回复分块（评审 P1-5）：一条回复拆成主气泡、小字回执与独立隐私行，
 * 不再把安全指导、记录回执、隐私声明全部挤进一个气泡。
 */
export interface ChatMessageBlock {
  /** main：直接回答/安全指导（TTS 只读这块）；receipt：记录/复测等小字回执；privacy：这条内容去哪、谁能看。 */
  kind: 'main' | 'receipt' | 'privacy';
  text: string;
}

export interface ChatMessage {
  id: string;
  role: 'elder' | 'agent';
  text: string;
  time: string;
  persisted?: boolean;
  /**
   * 该条回复下方需要渲染紧急联系行动条（呼叫 120 / 家属 / 社区医生）。
   * 评审反馈：说"立即寻求急救"的同一个界面里必须出现可按的电话按钮。
   */
  safetyAction?: boolean;
  /**
   * 结构化分块（评审 P1-5）。缺省时按 text 单气泡渲染（种子数据与历史消息）。
   * text 始终保留全量拼接文本，供 toast、检索与既有断言使用。
   */
  blocks?: ChatMessageBlock[];
  /**
   * 占位回复（P0-3/P1-4）：回复尚在生成时的"正在听你说…"气泡。
   * 永不持久化（persisted=false），就绪后由 useElderChat 原地替换为正式回复。
   */
  pending?: boolean;
  /** Agent 工具返回的可执行目标；例如打开路线二定位到某个药品。 */
  toolTarget?: { url: string; label: string; source: 'route2-home-twin' };
}

export interface MedicationRecord {
  id: string;
  name: string;
  dose: string;
  purpose: string;
  times: string;
  status: 'active' | 'stopped';
}

export interface ElderProfile {
  sex?: 'male' | 'female' | 'unspecified';
  medicationRecords?: MedicationRecord[];
  name: string;
  age: number;
  conditions: string[];
  medications: string[];
  familyContact: string;
  familyPhone: string;
  /**
   * 老人自己的电话（P1 修复，评审"联系老人拨的是家属自己号码"）：
   * 家属端"联系老人"必须拨它。缺省时按钮如实提示补填，不再假装拨号。
   */
  elderPhone?: string;
  communityDoctorPhone?: string;
  mobility: MobilityStatus;
  usesCane: boolean;
  nightVision: NightVisionStatus;
  cognition: CognitionStatus;
  familySharing: FamilySharing;
}
