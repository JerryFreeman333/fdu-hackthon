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

export function mergeHealthEvents(...sets: HealthEvent[][]): HealthEvent[] {
  const byId = new Map<string, HealthEvent>();
  for (const set of sets) for (const event of set) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

export function appendHealthEvents(current: HealthEvent[], incoming: HealthEvent[]): HealthEvent[] {
  return mergeHealthEvents(current, incoming);
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
