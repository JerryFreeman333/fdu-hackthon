import type { ChatMessage, DayRecord, HealthMeasurement, LabResult, Observation } from '../types';
import { legacySnapshotToEvents, type HealthEvent } from '../pipeline/events';
import type { HealthRecordSnapshot, HealthRecordStore } from './HealthRecordStore';

const STORAGE_KEY = 'ankang-route1-health-records-v2';
const LEGACY_STORAGE_KEY = 'ankang-route1-health-records-v1';

const EMPTY: HealthRecordSnapshot = { events: [], chat: [] };

interface PersistedHealthData {
  events?: unknown;
  chat?: unknown;
  records?: unknown;
  observations?: unknown;
  labResults?: unknown;
  measurements?: unknown;
}

export class LocalHealthRecordStore implements HealthRecordStore {
  private loadFailed = false;
  constructor(private readonly storageKey = STORAGE_KEY) {}
  load(): HealthRecordSnapshot {
    try {
      const raw =
        window.localStorage.getItem(this.storageKey) ??
        (this.storageKey === STORAGE_KEY ? window.localStorage.getItem(LEGACY_STORAGE_KEY) : null);
      if (!raw) return EMPTY;
      const parsed = JSON.parse(raw) as PersistedHealthData;
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid saved record');
      if (this.storageKey !== STORAGE_KEY && (!Array.isArray(parsed.events) || !Array.isArray(parsed.chat)))
        throw new Error('Invalid personal record');
      const chat = Array.isArray(parsed.chat) ? (parsed.chat as ChatMessage[]) : [];

      if (Array.isArray(parsed.events)) return { events: parsed.events as HealthEvent[], chat };

      return {
        events: legacySnapshotToEvents({
          records: Array.isArray(parsed.records) ? (parsed.records as DayRecord[]) : [],
          observations: Array.isArray(parsed.observations) ? (parsed.observations as Observation[]) : [],
          labResults: Array.isArray(parsed.labResults) ? (parsed.labResults as LabResult[]) : [],
          measurements: Array.isArray(parsed.measurements) ? (parsed.measurements as HealthMeasurement[]) : [],
        }),
        chat,
      };
    } catch {
      this.loadFailed = true;
      return EMPTY;
    }
  }

  save(snapshot: HealthRecordSnapshot): void {
    if (this.loadFailed) throw new Error('Existing records could not be read; refusing to overwrite them.');
    window.localStorage.setItem(this.storageKey, JSON.stringify(snapshot));
  }

  clear(): void {
    window.localStorage.removeItem(this.storageKey);
    if (this.storageKey === STORAGE_KEY) window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    this.loadFailed = false;
  }
}

export const healthRecordStore = new LocalHealthRecordStore();

export const personalHealthRecordStore = new LocalHealthRecordStore('ankang-personal-records-v1');
