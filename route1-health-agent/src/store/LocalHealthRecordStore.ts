import type { HealthRecordSnapshot, HealthRecordStore } from './HealthRecordStore';

const EMPTY: HealthRecordSnapshot = { events: [], familyEvents: [], chat: [] };

let sessionSnapshot: HealthRecordSnapshot = EMPTY;

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

function cloneSnapshot(snapshot: HealthRecordSnapshot): HealthRecordSnapshot {
  return {
    events: snapshot.events.map((event) => structuredClone(event)),
    familyEvents: snapshot.familyEvents.map((event) => ({ ...event, tags: [...event.tags] })),
    chat: snapshot.chat.map((message) => ({
      ...message,
      ...(message.claimIds ? { claimIds: [...message.claimIds] } : {}),
    })),
  };
}

export const healthRecordStore = new LocalHealthRecordStore();
