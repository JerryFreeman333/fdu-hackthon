import type { ClaimStatus, HistoricalHealthEvent, SymptomTag } from '../types';
import { SYMPTOM_LABELS } from '../types';

/**
 * 既往事实的家属可见性：逐条授权 + 脱敏派生视图。
 *
 * 红线：
 * - 不复用 familySharing；没有单独的 HistoricalShareGrant 就什么都不展示。
 * - 原始 HistoricalHealthEvent 永不跨端；只发送这里构造的 SharedHistoricalFact。
 * - summary_only 不含原话、精确日期、来源消息 id、录入时间。
 * - summary_with_text 的原话必须先脱敏、截断。
 * - 派生 id 必须不透明：原始 id 里带 Date.now()，直接透传等于把录入时间
 *   送给家属，和“只到月份”自相矛盾。
 */
export type HistoricalShareScope = 'summary_only' | 'summary_with_text';

export interface HistoricalShareGrant {
  eventId: string;
  publicId: string;
  scope: HistoricalShareScope;
  /** 绑定关系 id；换绑/解绑后旧授权自动失效。 */
  familyLinkId: string;
  createdAt: string;
  /** YYYY-MM-DD，到期当天仍有效，次日失效。 */
  expiresAt: string;
  revokedAt?: string;
  redactions: string[];
}

export interface SharedHistoricalFact {
  /** 对家属只暴露不透明 id，不携带 sourceMessageId。 */
  id: string;
  /** 只到月份；null 表示日期不详。 */
  eventMonth: string | null;
  tags: SymptomTag[];
  status: ClaimStatus;
  scope: HistoricalShareScope;
  /** 仅 summary_with_text 且已脱敏时存在。 */
  text?: string;
  expiresAt: string;
}

export interface SharedHistorySnapshot {
  familyLinkId: string;
  views: SharedHistoricalFact[];
}

export const HISTORY_SHARE_DAYS = 7;
export const HISTORY_GRANTS_STORAGE_KEY = 'ankang-route1-history-grants-v1';
export const SHARED_HISTORY_STORAGE_KEY = 'ankang-route1-shared-history-v1';

const SHARE_SCOPES = new Set<HistoricalShareScope>(['summary_only', 'summary_with_text']);
const CLAIM_STATUSES = new Set<ClaimStatus>(['occurred', 'negated', 'hypothetical', 'uncertain', 'near_miss']);
const MAX_SHARED_FACTS = 100;
const MAX_SHARED_TEXT = 220;

function shiftDate(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) return date;
  return new Date(parsed + days * 86400000).toISOString().slice(0, 10);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeHistoryRedactions(redactions: string[]): string[] {
  return [...new Set(redactions.map((value) => value.trim()).filter((value) => value.length >= 2))]
    .slice(0, 20)
    .map((value) => value.slice(0, 80));
}

export function createHistoryId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

export function createHistoricalShareGrant(
  eventId: string,
  scope: HistoricalShareScope,
  familyLinkId: string,
  today: string,
  now: string,
  redactions: string[] = [],
): HistoricalShareGrant {
  return {
    eventId,
    publicId: `shared-${createHistoryId()}`,
    scope,
    familyLinkId,
    createdAt: now,
    expiresAt: shiftDate(today, HISTORY_SHARE_DAYS - 1),
    redactions: normalizeHistoryRedactions(redactions),
  };
}

export function isHistoricalShareGrantActive(grant: HistoricalShareGrant, today: string): boolean {
  return !grant.revokedAt && isCalendarDate(grant.expiresAt) && grant.expiresAt >= today;
}

/**
 * 脱敏原话。宁可过度遮蔽，也不能把手机号、证件号、住址、机构名或家属姓名
 * 原样送到另一台设备。替换顺序从强标识符到弱标识符，最后才截断。
 */
export function deidentifyHistoricalText(text: string, knownNames: string[] = []): string {
  let next = text.trim();
  const names = [...new Set(knownNames.map((name) => name.trim()).filter((name) => name.length >= 2))].sort(
    (a, b) => b.length - a.length,
  );
  for (const name of names) {
    next = next.split(name).join('家人');
  }
  next = next
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[邮箱已隐藏]')
    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/g, '[手机号已隐藏]')
    .replace(/\b\d{17}[\dXx]\b/g, '[证件号已隐藏]')
    .replace(/\b\d{16,19}\b/g, '[卡号已隐藏]')
    // 精确到日的日期降为年月：授权界面承诺“只给到月份”，不能靠原话绕过去。
    .replace(/((?:19|20)\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*[日号]?/g, '$1年$2月')
    .replace(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]/g, (_match, year: string | undefined, month: string) =>
      year ? `${year}年${month}月` : `${month}月`,
    )
    .replace(/(?:住在|家住|搬到|地址(?:是|在)?)[^，。；\n]{2,40}/g, '[住址已隐藏]')
    .replace(/\d+(?:号楼|栋|单元|层|室|号院|弄)/g, '[门牌已隐藏]')
    .replace(/(在|去|到|住进|住过|就诊于)[\u4e00-\u9fa5]{2,24}(?:医院|卫生院|诊所)/g, '$1[医疗机构已隐藏]')
    .replace(/(?:在|去|到|住进|就诊于)?[\u4e00-\u9fa5]{2,12}(?:医院|卫生院|诊所)/g, '[医疗机构已隐藏]');
  return next.length > 200 ? `${next.slice(0, 200)}（原话已截断）` : next;
}

function latestGrantsByEvent(grants: HistoricalShareGrant[]): Map<string, HistoricalShareGrant> {
  const latest = new Map<string, HistoricalShareGrant>();
  for (const grant of grants) {
    const current = latest.get(grant.eventId);
    if (!current || grant.createdAt >= current.createdAt) latest.set(grant.eventId, grant);
  }
  return latest;
}

export function buildSharedHistoricalFacts(
  events: HistoricalHealthEvent[],
  grants: HistoricalShareGrant[],
  familyLinkId: string,
  today: string,
  knownNames: string[] = [],
): SharedHistoricalFact[] {
  if (!familyLinkId) return [];
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const facts: SharedHistoricalFact[] = [];
  for (const grant of latestGrantsByEvent(grants).values()) {
    if (grant.familyLinkId !== familyLinkId || !isHistoricalShareGrantActive(grant, today)) continue;
    const event = eventsById.get(grant.eventId);
    if (!event) continue;
    const tags = event.tags.filter((tag): tag is SymptomTag =>
      Object.prototype.hasOwnProperty.call(SYMPTOM_LABELS, tag),
    );
    const fact: SharedHistoricalFact = {
      id: grant.publicId,
      eventMonth: event.eventDate ? event.eventDate.slice(0, 7) : null,
      tags,
      status: event.status,
      scope: grant.scope,
      expiresAt: grant.expiresAt,
    };
    if (grant.scope === 'summary_with_text') {
      fact.text = deidentifyHistoricalText(event.text, [...knownNames, ...grant.redactions]).slice(0, MAX_SHARED_TEXT);
    }
    facts.push(fact);
  }
  return facts
    .sort((a, b) => (b.eventMonth ?? '').localeCompare(a.eventMonth ?? '') || a.id.localeCompare(b.id))
    .slice(0, MAX_SHARED_FACTS);
}

function isSharedHistoricalFact(value: unknown): value is SharedHistoricalFact {
  if (!value || typeof value !== 'object') return false;
  const fact = value as Partial<SharedHistoricalFact>;
  return (
    typeof fact.id === 'string' &&
    fact.id.length > 0 &&
    fact.id.length <= 160 &&
    (fact.eventMonth === null || (typeof fact.eventMonth === 'string' && isCalendarDate(`${fact.eventMonth}-01`))) &&
    Array.isArray(fact.tags) &&
    fact.tags.length <= 20 &&
    fact.tags.every((tag) => typeof tag === 'string') &&
    typeof fact.status === 'string' &&
    CLAIM_STATUSES.has(fact.status as ClaimStatus) &&
    typeof fact.scope === 'string' &&
    SHARE_SCOPES.has(fact.scope as HistoricalShareScope) &&
    isCalendarDate(fact.expiresAt) &&
    (fact.text === undefined || (typeof fact.text === 'string' && fact.text.length <= MAX_SHARED_TEXT))
  );
}

/**
 * 跨端载荷校验。即使发送端是已绑定设备，也不能把任意对象写进家属视图。
 * summary_only 即使携带 text 也丢掉；text 再跑一次脱敏，防止旧版本或恶意对端。
 */
export function sanitizeSharedHistoryPayload(raw: unknown): SharedHistoricalFact[] {
  if (!Array.isArray(raw) || raw.length > MAX_SHARED_FACTS) return [];
  return raw.filter(isSharedHistoricalFact).map((fact) => ({
    id: fact.id,
    eventMonth: fact.eventMonth,
    tags: fact.tags.filter((tag): tag is SymptomTag => Object.prototype.hasOwnProperty.call(SYMPTOM_LABELS, tag)),
    status: fact.status,
    scope: fact.scope,
    expiresAt: fact.expiresAt,
    ...(fact.scope === 'summary_with_text' && fact.text
      ? { text: deidentifyHistoricalText(fact.text).slice(0, MAX_SHARED_TEXT) }
      : {}),
  }));
}

function readJson(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式/配额满：退化为会话内状态，不影响功能。
  }
}

export function loadHistoricalShareGrants(): HistoricalShareGrant[] {
  const raw = readJson(HISTORY_GRANTS_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is HistoricalShareGrant => {
    if (!value || typeof value !== 'object') return false;
    const grant = value as Partial<HistoricalShareGrant>;
    return (
      typeof grant.eventId === 'string' &&
      grant.eventId.length > 0 &&
      grant.eventId.length <= 160 &&
      typeof grant.publicId === 'string' &&
      /^shared-(?:[0-9a-f]{32}|[0-9a-f-]{36})$/.test(grant.publicId) &&
      typeof grant.familyLinkId === 'string' &&
      typeof grant.createdAt === 'string' &&
      isCalendarDate(grant.expiresAt) &&
      Array.isArray(grant.redactions) &&
      grant.redactions.length <= 20 &&
      grant.redactions.every((value) => typeof value === 'string' && value.length <= 80) &&
      typeof grant.scope === 'string' &&
      SHARE_SCOPES.has(grant.scope as HistoricalShareScope) &&
      (grant.revokedAt === undefined || typeof grant.revokedAt === 'string')
    );
  });
}

export function saveHistoricalShareGrants(grants: HistoricalShareGrant[]): void {
  writeJson(HISTORY_GRANTS_STORAGE_KEY, grants);
}

export function loadSharedHistoricalFacts(): SharedHistorySnapshot | null {
  const raw = readJson(SHARED_HISTORY_STORAGE_KEY) as Partial<SharedHistorySnapshot> | null;
  if (!raw || typeof raw.familyLinkId !== 'string' || !Array.isArray(raw.views)) return null;
  return { familyLinkId: raw.familyLinkId, views: sanitizeSharedHistoryPayload(raw.views) };
}

export function saveSharedHistoricalFacts(snapshot: SharedHistorySnapshot | null): void {
  writeJson(SHARED_HISTORY_STORAGE_KEY, snapshot);
}

export function historyStatusLabel(status: ClaimStatus): string {
  switch (status) {
    case 'occurred':
      return '已发生';
    case 'negated':
      return '当时未发生';
    case 'hypothetical':
      return '当时只是假设';
    case 'near_miss':
      return '接近发生但未发生';
    default:
      return '当时不确定';
  }
}
