import type { HistoricalHealthEvent, SymptomTag } from '../types';

/**
 * 既往健康事实账本（P2-A）。
 *
 * 这里的记录只用于“既往情况”展示与老人自查，不是今天的 Observation：
 * - 不参与 runDetection，不生成今天的家属通知；
 * - eventDate 为 null 表示日期不详，绝不拿录入日期冒充；
 * - 同一句事实重复说只保留一条（按日期 + 原文 + 标签去重）。
 */
function normalizedHistoryText(text: string): string {
  return text.trim().replace(/\s+/g, '');
}

export function isDuplicateHistoricalHealthEvent(
  current: HistoricalHealthEvent,
  incoming: HistoricalHealthEvent,
): boolean {
  if (current.source !== incoming.source || current.status !== incoming.status) return false;
  return (
    current.eventDate === incoming.eventDate &&
    normalizedHistoryText(current.text) === normalizedHistoryText(incoming.text) &&
    [...current.tags].sort().join('|') === [...incoming.tags].sort().join('|')
  );
}

export function appendHistoricalHealthEvents(
  current: HistoricalHealthEvent[],
  incoming: HistoricalHealthEvent[],
): HistoricalHealthEvent[] {
  const result = [...current];
  for (const event of incoming) {
    if (!result.some((existing) => isDuplicateHistoricalHealthEvent(existing, event))) result.push(event);
  }
  return result.sort(
    (a, b) =>
      (b.eventDate ?? '').localeCompare(a.eventDate ?? '') ||
      b.recordedAt.localeCompare(a.recordedAt) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * 更正时只撤销上一条消息对应的既往事实：
 * - 不传 targetTags / 空数组 = 整条消息的既往事实全部撤销（旧行为兜底）；
 * - 传了 = 只撤销与这些标签有交集的既往事实，保留同一条消息里的其它事实。
 */
export function removeCorrectedHistoricalHealthEvents(
  events: HistoricalHealthEvent[],
  sourceMessageId?: string,
  targetTags?: SymptomTag[],
): HistoricalHealthEvent[] {
  if (!sourceMessageId) return events;
  const tagFilter = targetTags && targetTags.length > 0 ? new Set(targetTags) : null;
  return events.filter((event) => {
    if (event.sourceMessageId !== sourceMessageId) return true;
    if (!tagFilter) return false;
    return !event.tags.some((tag) => tagFilter.has(tag));
  });
}

export interface HistoricalEventSections {
  /** 老人明确说出日期的既往事实，按日期倒序。 */
  dated: HistoricalHealthEvent[];
  /** 日期不详的既往情况，按录入时间倒序。 */
  undated: HistoricalHealthEvent[];
}

export function splitHistoricalHealthEvents(events: HistoricalHealthEvent[]): HistoricalEventSections {
  const sorted = [...events].sort(
    (a, b) =>
      (b.eventDate ?? '').localeCompare(a.eventDate ?? '') ||
      b.recordedAt.localeCompare(a.recordedAt) ||
      a.id.localeCompare(b.id),
  );
  return {
    dated: sorted.filter((event) => event.eventDate !== null),
    undated: sorted.filter((event) => event.eventDate === null),
  };
}
