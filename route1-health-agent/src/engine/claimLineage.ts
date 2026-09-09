import type { FamilyHealthEvent } from '../types';
import type { HealthEvent } from '../pipeline/events';

/**
 * Stable local linkage between one elder utterance claim and every event it produces.
 * This is intentionally deterministic so a correction can recompute the same ids.
 */
export function claimIdForMessage(text: string, claimIndex: number): string {
  let hash = 2166136261;
  const input = `${text.trim()}#${claimIndex}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `claim-${(hash >>> 0).toString(16)}`;
}

/** Remove only chat-derived events attached to the corrected claim ids. */
export function removeCorrectedChatEvents(events: HealthEvent[], claimIds: string[]): HealthEvent[] {
  if (claimIds.length === 0) return events;
  const ids = new Set(claimIds);
  return events.filter((event) => {
    if (event.source !== 'chat') return true;
    if (event.type === 'observation') return !ids.has(event.observation.claimId ?? '');
    if (event.type === 'measurement') return !ids.has(event.measurement.claimId ?? '');
    return true;
  });
}

/** Remove only family events attached to the corrected claim ids. */
export function removeCorrectedFamilyEvents(events: FamilyHealthEvent[], claimIds: string[]): FamilyHealthEvent[] {
  if (claimIds.length === 0) return events;
  const ids = new Set(claimIds);
  return events.filter((event) => !ids.has(event.claimId ?? ''));
}
