import type { ChatMessage, FamilyHealthEvent, SymptomTag } from '../types';
import type { HealthEvent } from '../pipeline/events';

/**
 * 删除被"自我纠正"标记的健康事件。
 *
 * - sourceMessageId 必须：上一条被纠正的老人消息 id。
 * - targetTags 可选：
 *   - 不传或空数组 = 整条删除（旧行为，兜底用）。
 *   - 传了 = 只删与 targetTags 有标签交集的事件。
 *     上一句"我头晕，血压150/90"，用户说"刚才说错了，没有头晕"，
 *     targetTags = ['dizziness']，只删头晕 observation，保留 150/90 测量。
 *     这就是 issue ⑤ 描述的"删错另一条同标签事件"的反向修法：
 *     之前因为没有按标签过滤，会把同 sourceMessageId 的所有事件都抹掉。
 */
export function removeCorrectedChatHealthEvents(
  events: HealthEvent[],
  sourceMessageId?: string,
  targetTags?: SymptomTag[],
): HealthEvent[] {
  if (!sourceMessageId) return events;
  const tagFilter = targetTags && targetTags.length > 0 ? new Set(targetTags) : null;
  return events.filter((event) => {
    if (event.source !== 'chat') return true;
    if (event.type === 'observation') {
      if (event.observation.metadata?.sourceMessageId !== sourceMessageId) return true;
      if (!tagFilter) return false;
      return !event.observation.tags.some((tag) => tagFilter.has(tag));
    }
    if (event.type === 'measurement') {
      if (event.measurement.metadata?.sourceMessageId !== sourceMessageId) return true;
      // 测量值（血压/血糖/心率/血氧）本身没有 tags，靠 metric -> tag 映射判断。
      // 例：targetTags=['bpHigh'] 时，systolic/diastolic 两条 measurement 都会被删。
      if (!tagFilter) return false;
      return !metricMatchesTag(event.measurement.metric, tagFilter);
    }
    return true;
  });
}

const METRIC_TO_TAGS: Record<string, SymptomTag[]> = {
  systolic: ['bpHigh'],
  diastolic: ['bpHigh'],
  bloodGlucose: ['glucoseHigh', 'glucoseLow'],
  restingHr: ['hrHigh', 'hrLow'],
  spo2: ['spo2Low'],
  weight: [],
  steps: [],
  sleepHours: [],
  nightWakes: [],
  walkSpeed: [],
};

function metricMatchesTag(metric: string, tagFilter: Set<SymptomTag>): boolean {
  if (tagFilter.size === 0) return true;
  const expected = METRIC_TO_TAGS[metric] ?? [];
  return expected.some((tag) => tagFilter.has(tag));
}

export function removeCorrectedFamilyEvents(
  events: FamilyHealthEvent[],
  sourceMessageId?: string,
): FamilyHealthEvent[] {
  if (!sourceMessageId) return events;
  return events.filter((event) => event.sourceMessageId !== sourceMessageId);
}

export function findCorrectionTargetMessage(
  messages: ChatMessage[],
  correctionTargetMessageId?: string,
): ChatMessage | null {
  if (!correctionTargetMessageId) return null;
  return messages.find((message) => message.id === correctionTargetMessageId && message.role === 'elder') ?? null;
}
