import type { DataSource, DayRecord, HealthMeasurement, MetricKey } from '../types';
import { METRICS } from '../types';

/**
 * 把已有的按天记录转换成统一的单次测量。
 * 主要用于旧版 localStorage 迁移；新的运行时数据应优先来自 Adapter。
 */
export function dayRecordsToMeasurements(records: DayRecord[], source: DataSource = 'demo'): HealthMeasurement[] {
  return records.flatMap((record) =>
    Object.entries(record.metrics).flatMap(([metric, value]) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [];
      const key = metric as MetricKey;
      return [
        {
          id: `normalized-${source}-${record.date}-${metric}`,
          timestamp: `${record.date}T12:00:00`,
          metric: key,
          value,
          unit: METRICS[key].unit,
          source,
          confidence: 1,
          metadata: { normalizedFrom: 'DayRecord' },
        },
      ];
    }),
  );
}

/** 合并多个数据源并按稳定 ID 去重。后出现的数据会覆盖同 ID 的旧数据。 */
export function mergeMeasurements(...sets: HealthMeasurement[][]): HealthMeasurement[] {
  const byId = new Map<string, HealthMeasurement>();
  for (const set of sets) {
    for (const measurement of set) {
      if (Number.isFinite(measurement.value)) byId.set(measurement.id, measurement);
    }
  }
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

function dateOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * 将统一测量重新聚合成当前 UI/Detection 所需的 DayRecord 派生视图。
 * 同一天同一指标出现多次时，采用时间最新的一次作为当天代表值，同时保留当日全部 measurement。
 */
export function measurementsToDayRecords(measurements: HealthMeasurement[]): DayRecord[] {
  const byDate = new Map<string, HealthMeasurement[]>();
  for (const measurement of measurements) {
    if (!Number.isFinite(measurement.value) || !METRICS[measurement.metric]) continue;
    const date = dateOf(measurement.timestamp);
    const bucket = byDate.get(date) ?? [];
    bucket.push(measurement);
    byDate.set(date, bucket);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => {
      const sorted = [...bucket].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
      const latestByMetric = new Map<MetricKey, HealthMeasurement>();
      for (const measurement of sorted) latestByMetric.set(measurement.metric, measurement);
      const metrics: Partial<Record<MetricKey, number>> = {};
      for (const [metric, measurement] of latestByMetric.entries()) metrics[metric] = measurement.value;
      return { date, metrics, measurements: sorted };
    });
}
