import type { FamilyHealthEvent, FamilySharing, SymptomTag } from '../types';
import { SYMPTOM_LABELS } from '../types';
import { formatLocalDate } from './clock';

/** Family events stay outside the elder HealthEvent stream and are filtered at presentation time. */
export function visibleFamilyEvents(
  events: FamilyHealthEvent[],
  familySharing: FamilySharing,
  sharedFamilyEventIds: string[] = [],
): FamilyHealthEvent[] {
  const oneTimeShared = new Set(sharedFamilyEventIds);
  return events.filter(
    (event) =>
      event.visibility !== 'private' &&
      (event.shareMode === 'persistent'
        ? familySharing === 'granted'
        : event.shareMode === 'one_time' && oneTimeShared.has(event.id)),
  );
}

/**
 * 家属安全通道只读取“家人事实账本”，绝不写入老人本人事件流。
 * 这些标签属于需要家属立即确认的安全信号；near_miss/否定/假设不进入该通道。
 */
export const FAMILY_SAFETY_TAGS = ['syncope', 'chestPain', 'neuroChange', 'fall', 'melena'] as const;
export type FamilySafetyTag = (typeof FAMILY_SAFETY_TAGS)[number];

const FAMILY_SAFETY_TAG_SET = new Set<SymptomTag>(FAMILY_SAFETY_TAGS);

export function isFamilySafetyEvent(event: FamilyHealthEvent): boolean {
  return event.status === 'occurred' && event.tags.some((tag) => FAMILY_SAFETY_TAG_SET.has(tag));
}

/** 已授权、可向家属展示的家人安全事件。 */
export function visibleFamilySafetyEvents(
  events: FamilyHealthEvent[],
  familySharing: FamilySharing,
  sharedFamilyEventIds: string[] = [],
): FamilyHealthEvent[] {
  return visibleFamilyEvents(events, familySharing, sharedFamilyEventIds).filter(isFamilySafetyEvent);
}

/**
 * 事件的发生日期。
 *
 * 新数据用 `eventDate`（日期不详为 null）；旧数据把发生日期写进了 `timestamp`，
 * 读取时按 timestamp 的日期兜底——旧快照里 timestamp 本来就不是录入时间。
 * 新数据的 `timestamp` 是录入时间，因此绝不能用它冒充发生日期。
 */
export function familyEventDate(event: FamilyHealthEvent): string | null {
  if (event.eventDate !== undefined) return event.eventDate;
  return event.timestamp.slice(0, 10);
}

/**
 * "当前急症"窗口：今天与昨天。
 *
 * 没有窗口，一条"上周摔过"的事实会永远挂在紧急卡片上，并在每次派发时被当成
 * 今天的急症反复提醒。窗口之外的事件仍然保留在账本与近况记录里，但不再以
 * "立即确认"的名义推送——历史事件需要的是知晓，不是假装它刚刚发生。
 */
export const FAMILY_SAFETY_ACTIVE_WINDOW_DAYS = 1;

function shiftDate(date: string, days: number): string {
  // 用 UTC 解析/序列化：本地时区偏移会让 `toISOString().slice(0,10)` 漂移一天，
  // 在 UTC+8 下"昨天"会算成"前天"，把历史事件错误地放进当前急症窗口。
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) return date;
  return new Date(parsed + days * 86400000).toISOString().slice(0, 10);
}

export function isActiveFamilySafetyEvent(event: FamilyHealthEvent, today: string): boolean {
  if (!isFamilySafetyEvent(event)) return false;
  const occurredOn = familyEventDate(event);
  if (occurredOn === null) return false;
  const oldest = shiftDate(today, -FAMILY_SAFETY_ACTIVE_WINDOW_DAYS);
  return occurredOn >= oldest && occurredOn <= today;
}

export function activeFamilySafetyEvents(
  events: FamilyHealthEvent[],
  familySharing: FamilySharing,
  sharedFamilyEventIds: string[],
  today: string,
): FamilyHealthEvent[] {
  return visibleFamilySafetyEvents(events, familySharing, sharedFamilyEventIds).filter((event) =>
    isActiveFamilySafetyEvent(event, today),
  );
}

/** 已授权、但已经超出"当前急症"窗口的家人安全事件：只作记录，不推送。 */
export function pastFamilySafetyEvents(
  events: FamilyHealthEvent[],
  familySharing: FamilySharing,
  sharedFamilyEventIds: string[],
  today: string,
): FamilyHealthEvent[] {
  return visibleFamilySafetyEvents(events, familySharing, sharedFamilyEventIds).filter(
    (event) => !isActiveFamilySafetyEvent(event, today),
  );
}

/** 跨端/跨 tab 合并家人事实：按 id 去重，保留录入时间较新的版本。 */
export function mergeFamilyEvents(current: FamilyHealthEvent[], incoming: FamilyHealthEvent[]): FamilyHealthEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    const existing = byId.get(event.id);
    if (!existing || event.timestamp >= existing.timestamp) byId.set(event.id, event);
  }
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

const FAMILY_SUBJECTS = new Set(['spouse', 'father', 'mother', 'family_other']);
const FAMILY_STATUSES = new Set(['occurred', 'negated', 'hypothetical', 'uncertain', 'near_miss']);
const FAMILY_SHARE_MODES = new Set(['private', 'persistent', 'one_time']);
const FAMILY_TIME_SCOPES = new Set(['today', 'yesterday', 'lastNight', 'historical', 'unknown']);
const MAX_INCOMING_FAMILY_EVENTS = 200;

/**
 * 跨端载荷的最小结构校验。
 * PeerJS 对端在握手前是陌生人，计数器与字符串都必须逐字段验证，
 * 不能把 `unknown[]` 直接断言成 FamilyHealthEvent[] 写进账本。
 */
export function sanitizeFamilyEventsPayload(raw: unknown): FamilyHealthEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is FamilyHealthEvent => {
    if (raw.length > MAX_INCOMING_FAMILY_EVENTS || !item || typeof item !== 'object') return false;
    const event = item as Partial<FamilyHealthEvent>;
    if (
      typeof event.id !== 'string' ||
      event.id.length > 120 ||
      typeof event.timestamp !== 'string' ||
      typeof event.text !== 'string' ||
      // 结构校验之外还要限长：绑定后的对端仍可能发来超大文本，不能让它进账本/渲染。
      event.text.length > 2000 ||
      typeof event.hasHealthValue !== 'boolean' ||
      !Array.isArray(event.tags) ||
      event.tags.length > 20 ||
      !event.tags.every((tag) => typeof tag === 'string') ||
      !event.subject ||
      !FAMILY_SUBJECTS.has(event.subject) ||
      !event.status ||
      !FAMILY_STATUSES.has(event.status) ||
      (event.visibility !== 'private' && event.visibility !== 'family_ok') ||
      !event.shareMode ||
      !FAMILY_SHARE_MODES.has(event.shareMode)
    ) {
      return false;
    }
    if (event.eventDate !== undefined && event.eventDate !== null && typeof event.eventDate !== 'string') return false;
    if (
      event.timeScope !== undefined &&
      (typeof event.timeScope !== 'string' || !FAMILY_TIME_SCOPES.has(event.timeScope))
    )
      return false;
    // 授权门控在渲染层还会再跑一次；这里先拒绝明显不该跨端的私密事件。
    return event.visibility === 'family_ok' && event.shareMode !== 'private';
  });
}

/**
 * 被隐私或授权门控挡住的家人安全事件。只允许上层显示数量，
 * 不得把事件文本、症状或主体暴露给未授权家属。
 */
export function gatedFamilySafetyEvents(
  events: FamilyHealthEvent[],
  familySharing: FamilySharing,
  sharedFamilyEventIds: string[] = [],
): FamilyHealthEvent[] {
  const visibleIds = new Set(visibleFamilyEvents(events, familySharing, sharedFamilyEventIds).map((event) => event.id));
  return events.filter((event) => isFamilySafetyEvent(event) && !visibleIds.has(event.id));
}

export interface FamilySafetyItem {
  id: string;
  subject: FamilyHealthEvent['subject'];
  subjectLabel: string;
  /** 事件发生日期，用于向家属说明“什么时候发生”。 */
  date: string;
  /** 事件进入系统的日期，用于判断“这次是不是新报告”；不能拿发生日期代替。 */
  reportedDate: string;
  tags: SymptomTag[];
  title: string;
  message: string;
  /** 已授权的原话；只能在 visibleFamilySafetyEvents 的结果上使用。 */
  text: string;
}

const FAMILY_SAFETY_GUIDANCE: Partial<Record<FamilySafetyTag, string>> = {
  syncope: '请立即联系确认意识、呼吸和是否受伤，不要让其独自站起；未完全恢复或反复晕厥时立即寻求急救。',
  chestPain: '请立即联系确认胸痛是否持续、是否伴喘或出汗；明显或持续胸痛时立即寻求急救。',
  neuroChange: '请立即联系确认说话、面部和肢体活动情况；突然出现的异常不适合在家继续观察。',
  fall: '请立即联系确认是否受伤、能否站起和有无意识异常；无法站起或明显受伤时立即寻求急救。',
  melena: '请立即联系确认黑便/便血的次数和颜色，并尽快联系医生；伴头晕、心慌、冷汗或晕厥时立即就医。',
};

function safetyGuidance(tags: SymptomTag[]): string {
  const matched = FAMILY_SAFETY_TAGS.filter((tag) => tags.includes(tag));
  const guidance = matched.map((tag) => FAMILY_SAFETY_GUIDANCE[tag]).filter((text): text is string => Boolean(text));
  return guidance.length > 0 ? guidance.join(' ') : '请尽快联系家人确认当前情况。';
}

function localReportDate(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp.slice(0, 10) : formatLocalDate(parsed);
}

/** 构建家属安全条目；主体标签与事件原文只来自已授权事件。 */
export function buildFamilySafetyItem(event: FamilyHealthEvent): FamilySafetyItem {
  const subjectLabel = familySubjectLabel(event.subject);
  const tags = event.tags.filter((tag) => FAMILY_SAFETY_TAG_SET.has(tag));
  const tagLabels = tags.map((tag) => SYMPTOM_LABELS[tag]);
  return {
    id: event.id,
    subject: event.subject,
    subjectLabel,
    date: familyEventDate(event) ?? '',
    // timestamp 是 UTC ISO：直接切前 10 位在 UTC+8 的深夜会落到下一天。
    reportedDate: localReportDate(event.timestamp),
    tags,
    // 收件人是家属，"父亲"在对方手机上会被读成"我的父亲"。必须写明是老人转述的家人。
    title: `老人转述：其${subjectLabel}出现${tagLabels.join('、')}，需要立即确认`,
    message: `${safetyGuidance(tags)}这不是诊断。`,
    text: event.text,
  };
}

export function familySubjectLabel(subject: FamilyHealthEvent['subject']): string {
  switch (subject) {
    case 'spouse':
      return '配偶';
    case 'father':
      return '父亲';
    case 'mother':
      return '母亲';
    default:
      return '家人';
  }
}

export function familyStatusLabel(status: FamilyHealthEvent['status']): string {
  switch (status) {
    case 'occurred':
      return '已发生';
    case 'negated':
      return '未发现';
    case 'uncertain':
      return '待确认';
    default:
      return '仅作参考';
  }
}
