import type { ChatMessage, FamilyHealthEvent } from '../types';
import type { HealthEvent } from '../pipeline/events';

export function removeCorrectedChatHealthEvents(events: HealthEvent[], sourceMessageId?: string): HealthEvent[] {
  if (!sourceMessageId) return events;
  return events.filter((event) => {
    if (event.source !== 'chat') return true;
    if (event.type === 'observation') return event.observation.metadata?.sourceMessageId !== sourceMessageId;
    if (event.type === 'measurement') return event.measurement.metadata?.sourceMessageId !== sourceMessageId;
    return true;
  });
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
