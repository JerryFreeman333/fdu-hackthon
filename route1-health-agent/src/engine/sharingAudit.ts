import type { FamilyShareMode } from '../types';

export type SharingAuditScope = 'self' | 'family';
export type SharingRecipient = 'daughter' | 'son' | 'family';

export interface SharingAuditEntry {
  id: string;
  createdAt: string;
  scope: SharingAuditScope;
  recipient: SharingRecipient;
  shareMode: FamilyShareMode;
  content: string;
}

export type SharingAuditCandidate = Omit<SharingAuditEntry, 'shareMode'> & {
  shareMode: string;
};

const LEGACY_SHARING_AUDIT_KEY = 'ankang-route1-sharing-audit-v1';
const DEFAULT_LIMIT = 100;
let sessionAudit: SharingAuditEntry[] = [];

function isFamilyShareMode(value: string): value is FamilyShareMode {
  return value === 'private' || value === 'persistent' || value === 'one_time';
}

export function inferSharingRecipient(text: string): SharingRecipient {
  if (/女儿/.test(text)) return 'daughter';
  if (/儿子/.test(text)) return 'son';
  return 'family';
}

export function appendSharingAudit(
  entries: SharingAuditEntry[],
  next: SharingAuditCandidate[],
  limit = DEFAULT_LIMIT,
): SharingAuditEntry[] {
  const validNext = next.filter((entry): entry is SharingAuditEntry => isFamilyShareMode(entry.shareMode));
  if (validNext.length === 0) return entries.slice(-limit);
  return [...entries, ...validNext].slice(-limit);
}

function cloneEntries(entries: SharingAuditEntry[]): SharingAuditEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

/** Session-only audit. Sensitive sharing content is never restored from browser persistence. */
export function loadSharingAudit(): SharingAuditEntry[] {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LEGACY_SHARING_AUDIT_KEY);
  }
  return cloneEntries(sessionAudit);
}

export function saveSharingAudit(entries: SharingAuditEntry[]): void {
  sessionAudit = cloneEntries(entries.slice(-DEFAULT_LIMIT));
}

export function clearSharingAudit(): void {
  sessionAudit = [];
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LEGACY_SHARING_AUDIT_KEY);
  }
}

export function recordSharingAudit(next: SharingAuditCandidate[]): void {
  if (next.length === 0) return;
  saveSharingAudit(appendSharingAudit(sessionAudit, next));
}

export function historicalSharesForRecipient(
  entries: SharingAuditEntry[],
  recipient?: SharingRecipient,
): SharingAuditEntry[] {
  return entries.filter((entry) => !recipient || entry.recipient === recipient);
}

export function buildHistoricalSharingAnswer(entries: SharingAuditEntry[], recipient?: SharingRecipient): string {
  const matches = historicalSharesForRecipient(entries, recipient);
  if (matches.length === 0) return '我没有找到可靠的历史共享记录，所以不会猜测您之前有没有告诉家属。';

  const latest = matches.slice(-5).reverse();
  const lines = latest.map((entry) => {
    const target = entry.recipient === 'daughter' ? '女儿' : entry.recipient === 'son' ? '儿子' : '家属';
    const mode = entry.shareMode === 'one_time' ? '一次性' : entry.shareMode === 'persistent' ? '按长期授权' : '仅本人';
    return `${entry.createdAt.slice(0, 16).replace('T', ' ')}，${mode}告诉${target}：${entry.content}`;
  });
  return `我能确认的历史共享记录有：\n${lines.join('\n')}`;
}
