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

type SharingAuditCandidate = Omit<SharingAuditEntry, 'shareMode'> & {
  shareMode: string;
};

const SHARING_AUDIT_KEY = 'ankang-route1-sharing-audit-v1';
const DEFAULT_LIMIT = 100;

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

export function loadSharingAudit(): SharingAuditEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SHARING_AUDIT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SharingAuditEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Record<string, unknown>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.createdAt === 'string' &&
        (candidate.scope === 'self' || candidate.scope === 'family') &&
        (candidate.recipient === 'daughter' || candidate.recipient === 'son' || candidate.recipient === 'family') &&
        (candidate.shareMode === 'private' ||
          candidate.shareMode === 'persistent' ||
          candidate.shareMode === 'one_time') &&
        typeof candidate.content === 'string'
      );
    });
  } catch {
    return [];
  }
}

export function saveSharingAudit(entries: SharingAuditEntry[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SHARING_AUDIT_KEY, JSON.stringify(entries.slice(-DEFAULT_LIMIT)));
}

export function recordSharingAudit(next: SharingAuditCandidate[]): void {
  if (next.length === 0) return;
  saveSharingAudit(appendSharingAudit(loadSharingAudit(), next));
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
