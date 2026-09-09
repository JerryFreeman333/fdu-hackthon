import type { ChatMessage, FamilyHealthEvent } from '../types';
import type { HealthRecordSnapshot, HealthRecordStore } from './HealthRecordStore';
import type { HealthEvent } from '../pipeline/events';

const EMPTY: HealthRecordSnapshot = { events: [], familyEvents: [], chat: [] };

let sessionSnapshot: HealthRecordSnapshot = EMPTY;

function cloneSnapshot(snapshot: HealthRecordSnapshot): HealthRecordSnapshot {
  return {
    events: snapshot.events.map((event) => ({ ...event }) as HealthEvent),
    familyEvents: snapshot.familyEvents.map((event) => ({ ...event }) as FamilyHealthEvent),
    chat: snapshot.chat.map((message) => ({ ...message }) as ChatMessage),
  };
}

/**
 * Demo-only health store.
 * Health data lives only in the current JavaScript session and is never written to browser persistence.
 * A real product should replace this with an authenticated remote store with an explicit retention policy.
 */
export class LocalHealthRecordStore implements HealthRecordStore {
  load(): HealthRecordSnapshot {
    return cloneSnapshot(sessionSnapshot);
  }

  save(snapshot: HealthRecordSnapshot): void {
    sessionSnapshot = cloneSnapshot(snapshot);
  }

  clear(): void {
    sessionSnapshot = EMPTY;
  }
}

export const healthRecordStore = new LocalHealthRecordStore();
