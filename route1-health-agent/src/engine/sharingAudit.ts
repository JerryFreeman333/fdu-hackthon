import type { FamilyShareMode } from './userFacing';

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

export function inferSharingRecipient(text: string): SharingRecipient {
  if (/女儿/.test(text)) return 'daughter';
  if (/儿子/.test(text)) return 'son';
  return 'family';
}

export function appendSharingAudit(
  entries: SharingAuditEntry[],
  next: SharingAuditEntry[],
  limit = 100,
): SharingAuditEntry[] {
  if (next.length === 0) return entries.slice(-limit);
  return [...entries, ...next].slice(-limit);
}

export function historicalSharesForRecipient(
  entries: SharingAuditEntry[],
  recipient?: SharingRecipient,
): SharingAuditEntry[] {
  return entries.filter((entry) => !recipient || entry.recipient === recipient);
}

export function buildHistoricalSharingAnswer(
  entries: SharingAuditEntry[],
  recipient?: SharingRecipient,
): string {
  const matches = historicalSharesForRecipient(entries, recipient);
  if (matches.length === 0) return '我没有找到可靠的历史共享记录，所以不会猜测您之前有没有告诉家属。';

  const latest = matches.slice(-5).reverse();
  const lines = latest.map((entry) => {
    const target = entry.recipient === 'daughter' ? '女儿' : entry.recipient === 'son' ? '儿子' : '家属';
    const mode = entry.shareMode === 'one_time' ? '一次性' : '按长期授权';
    return `${entry.createdAt.slice(0, 16).replace('T', ' ')}，${mode}告诉${target}：${entry.content}`;
  });
  return `我能确认的历史共享记录有：\n${lines.join('\n')}`;
}
