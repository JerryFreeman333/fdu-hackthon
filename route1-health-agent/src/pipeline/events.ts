/**
 * 统一健康事件管道。
 * Measurement / Observation / LabResult 都先进入 HealthEvent，再由下游投影成
 * Detection 所需的 DayRecord、Observation[] 等派生视图。
 */
import type { DayRecord, DataSource, HealthMeasurement, LabResult, Observation } from '../types';
import { dayRecordsToMeasurements, measurementsToDayRecords, mergeMeasurements } from '../data/normalize';

export type HealthEventType = 'measurement' | 'observation' | 'labResult';

export interface HealthEventBase {
  id: string;
  type: HealthEventType;
  timestamp: string;
  source: DataSource;
}

export interface MeasurementEvent extends HealthEventBase {
  type: 'measurement';
  measurement: HealthMeasurement;
}

export interface ObservationEvent extends HealthEventBase {
  type: 'observation';
  observation: Observation;
}

export interface LabResultEvent extends HealthEventBase {
  type: 'labResult';
  labResult: LabResult;
}

export type HealthEvent = MeasurementEvent | ObservationEvent | LabResultEvent;

export interface MaterializedHealthData {
  events: HealthEvent[];
  measurements: HealthMeasurement[];
  observations: Observation[];
  labResults: LabResult[];
  records: DayRecord[];
}

export interface LegacyHealthRecordSnapshot {
  records?: DayRecord[];
  observations?: Observation[];
  labResults?: LabResult[];
  measurements?: HealthMeasurement[];
}

export function measurementToEvent(measurement: HealthMeasurement): MeasurementEvent {
  return {
    id: `measurement:${measurement.id}`,
    type: 'measurement',
    timestamp: measurement.timestamp,
    source: measurement.source,
    measurement,
  };
}

export function observationToEvent(observation: Observation): ObservationEvent {
  return {
    id: `observation:${observation.id}`,
    type: 'observation',
    timestamp: `${observation.date}T12:00:00`,
    source: observation.source,
    observation,
  };
}

export function labResultToEvent(labResult: LabResult): LabResultEvent {
  return {
    id: `labResult:${labResult.id}`,
    type: 'labResult',
    timestamp: labResult.timestamp,
    source: labResult.source,
    labResult,
  };
}

function normalizedText(text: string): string {
  return text.trim().replace(/\s+/g, '');
}

/**
 * 判断聊天输入生成的健康事件是否已经记录过。
 * 这里刻意只去重“同来源 + 同事实”，避免老人重复说一句话时不断堆叠相同记录，
 * 同时不把设备/照片/历史导入的数据误删掉。
 */
export function isDuplicateChatHealthEvent(current: HealthEvent, incoming: HealthEvent): boolean {
  if (current.source !== 'chat' || incoming.source !== 'chat' || current.type !== incoming.type) return false;

  if (current.type === 'observation' && incoming.type === 'observation') {
    return (
      current.observation.date === incoming.observation.date &&
      normalizedText(current.observation.text) === normalizedText(incoming.observation.text) &&
      [...current.observation.tags].sort().join('|') === [...incoming.observation.tags].sort().join('|')
    );
  }

  if (current.type === 'measurement' && incoming.type === 'measurement') {
    return (
      current.measurement.timestamp === incoming.measurement.timestamp &&
      current.measurement.metric === incoming.measurement.metric &&
      current.measurement.value === incoming.measurement.value &&
      current.measurement.unit === incoming.measurement.unit
    );
  }

  if (current.type === 'labResult' && incoming.type === 'labResult') {
    return (
      current.labResult.timestamp === incoming.labResult.timestamp &&
      normalizedText(current.labResult.name) === normalizedText(incoming.labResult.name) &&
      current.labResult.value === incoming.labResult.value &&
      current.labResult.unit === incoming.labResult.unit
    );
  }

  return false;
}

export function mergeHealthEvents(...sets: HealthEvent[][]): HealthEvent[] {
  const byId = new Map<string, HealthEvent>();
  for (const set of sets) for (const event of set) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

export function appendHealthEvents(current: HealthEvent[], incoming: HealthEvent[]): HealthEvent[] {
  const acceptedIncoming = incoming.filter(
    (event) => !current.some((existing) => isDuplicateChatHealthEvent(existing, event)),
  );
  return mergeHealthEvents(current, acceptedIncoming);
}

export function legacySnapshotToEvents(snapshot: LegacyHealthRecordSnapshot): HealthEvent[] {
  const measurements = snapshot.measurements?.length
    ? snapshot.measurements
    : dayRecordsToMeasurements(snapshot.records ?? [], 'demo');
  return mergeHealthEvents(
    measurements.map(measurementToEvent),
    (snapshot.observations ?? []).map(observationToEvent),
    (snapshot.labResults ?? []).map(labResultToEvent),
    (snapshot.observations ?? []).flatMap((o) => o.measurements ?? []).map(measurementToEvent),
    (snapshot.observations ?? []).flatMap((o) => o.labResults ?? []).map(labResultToEvent),
  );
}

export function materializeHealthData(events: HealthEvent[]): MaterializedHealthData {
  const sorted = mergeHealthEvents(events);
  const measurements = sorted.filter((e): e is MeasurementEvent => e.type === 'measurement').map((e) => e.measurement);
  const observations = sorted.filter((e): e is ObservationEvent => e.type === 'observation').map((e) => e.observation);
  const labResults = sorted.filter((e): e is LabResultEvent => e.type === 'labResult').map((e) => e.labResult);
  const normalizedMeasurements = mergeMeasurements(measurements);
  return {
    events: sorted,
    measurements: normalizedMeasurements,
    observations,
    labResults,
    records: measurementsToDayRecords(normalizedMeasurements),
  };
}
