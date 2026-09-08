import type { ChatMessage, DayRecord, FamilyHealthEvent, HealthMeasurement, LabResult, Observation } from '../types';
import { legacySnapshotToEvents, type HealthEvent } from '../pipeline/events';
import type { HealthRecordSnapshot, HealthRecordStore } from './HealthRecordStore';

const STORAGE_KEY = 'ankang-route1-health-records-v2';
const LEGACY_STORAGE_KEY = 'ankang-route1-health-records-v1';

const EMPTY: HealthRecordSnapshot = { events: [], familyEvents: [], chat: [] };

interface PersistedHealthData {
  events?: unknown;
  familyEvents?: unknown;
  chat?: unknown;
  records?: unknown;
  observations?: unknown;
  labResults?: unknown;
  measurements?: unknown;
}

export class LocalHealthRecordStore implements HealthRecordStore {
  load(): HealthRecordSnapshot {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return EMPTY;
      const parsed = JSON.parse(raw) as PersistedHealthData;
      const chat = Array.isArray(parsed.chat) ? (parsed.chat as ChatMessage[]) : [];
      const familyEvents = Array.isArray(parsed.familyEvents) ? (parsed.familyEvents as FamilyHealthEvent[]) : [];

      if (Array.isArray(parsed.events)) return { events: parsed.events as HealthEvent[], familyEvents, chat };

      return {
        events: legacySnapshotToEvents({
          records: Array.isArray(parsed.records) ? (parsed.records as DayRecord[]) : [],
          observations: Array.isArray(parsed.observations) ? (parsed.observations as Observation[]) : [],
          labResults: Array.isArray(parsed.labResults) ? (parsed.labResults as LabResult[]) : [],
          measurements: Array.isArray(parsed.measurements) ? (parsed.measurements as HealthMeasurement[]) : [],
        }),
        familyEvents,
        chat,
      };
    } catch {
      return EMPTY;
    }
  }

  save(snapshot: HealthRecordSnapshot): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  clear(): void {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

export const healthRecordStore = new LocalHealthRecordStore();
