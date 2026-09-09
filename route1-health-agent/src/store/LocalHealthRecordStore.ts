import type { HealthEvent } from '../pipeline/events';
import type { HealthRecordSnapshot, HealthRecordStore } from './HealthRecordStore';

const EMPTY: HealthRecordSnapshot = { events: [], familyEvents: [], chat: [] };

/**
 * Demo-only session store.
 *
 * Route 1 health data is sensitive and must not survive a browser/session boundary.
 * Keeping this store in JS memory means a fresh page load starts from a clean demo
 * account, while an elder/family role switch in the same page still shares the
 * current session's data.
 *
 * Production must replace this with a server-side account-scoped data store and
 * enforce authorization on the server; this in-memory adapter is deliberately not
 * an authentication or persistence mechanism.
 */
export class LocalHealthRecordStore implements HealthRecordStore {
  private snapshot: HealthRecordSnapshot = cloneSnapshot(EMPTY);

  load(): HealthRecordSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  save(snapshot: HealthRecordSnapshot): void {
    this.snapshot = cloneSnapshot(snapshot);
  }

  clear(): void {
    this.snapshot = cloneSnapshot(EMPTY);
  }
}

function cloneSnapshot(snapshot: HealthRecordSnapshot): HealthRecordSnapshot {
  return {
    events: snapshot.events.map(cloneHealthEvent),
    familyEvents: snapshot.familyEvents.map((event) => ({ ...event, tags: [...event.tags] })),
    chat: snapshot.chat.map((message) => ({ ...message })),
  };
}

function cloneHealthEvent(event: HealthEvent): HealthEvent {
  switch (event.type) {
    case 'measurement':
      return {
        ...event,
        measurement: {
          ...event.measurement,
          metadata: event.measurement.metadata ? { ...event.measurement.metadata } : event.measurement.metadata,
        },
      };
    case 'observation':
      return {
        ...event,
        observation: {
          ...event.observation,
          tags: [...event.observation.tags],
          measurements: event.observation.measurements
            ? event.observation.measurements.map((measurement) => ({
                ...measurement,
                metadata: measurement.metadata ? { ...measurement.metadata } : measurement.metadata,
              }))
            : event.observation.measurements,
          labResults: event.observation.labResults?.map((labResult) => ({ ...labResult })),
        },
      };
    case 'labResult':
      return {
        ...event,
        labResult: { ...event.labResult },
      };
  }
}

export const healthRecordStore = new LocalHealthRecordStore();
