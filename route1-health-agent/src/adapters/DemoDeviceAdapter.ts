import type { DeviceAdapter } from './DeviceAdapter';
import type { HealthMeasurement } from '../types';
import { METRICS } from '../types';
import { records } from '../data/demo';

/**
 * 模拟真实多设备来源：让 UI 看起来像真接了 iPhone + Apple Watch，
 * 而不是单一模糊的"Demo 源"。真接 HealthKit 时这里换成 sourceId 过滤。
 */
function metaForMetric(metric: HealthMeasurement['metric']): Record<string, string> {
  // 偏好源 = 老人最常戴的那个（Apple Watch）；只有手环类指标走手机
  const watchOnly = new Set(['restingHr', 'spo2', 'walkSpeed']);
  const phoneOnly = new Set(['steps', 'sleepHours', 'nightWakes']);
  if (watchOnly.has(metric))
    return { adapter: 'DemoDeviceAdapter', device: 'Apple Watch Series 9', sourceId: 'apple_watch_series_9' };
  if (phoneOnly.has(metric))
    return { adapter: 'DemoDeviceAdapter', device: 'iPhone 15', sourceId: 'iphone_motion_coprocessor' };
  return { adapter: 'DemoDeviceAdapter', device: 'iPhone 15 + Apple Watch Series 9', sourceId: 'combined' };
}
export const demoDeviceAdapter: DeviceAdapter = {
  source: 'demo',
  async getMeasurements(_userId, from, to): Promise<HealthMeasurement[]> {
    return records
      .filter((record) => record.date >= from && record.date <= to)
      .flatMap((record) =>
        (Object.keys(record.metrics) as HealthMeasurement['metric'][])
          .filter((metric) => metric in METRICS)
          .map((metric) => {
            const value = record.metrics[metric] as number;
            return {
              id: `demo-device-${record.date}-${metric}`,
              timestamp: `${record.date}T12:00:00`,
              metric,
              value,
              unit: METRICS[metric].unit,
              source: 'demo' as const,
              metadata: metaForMetric(metric),
            };
          }),
      );
  },
};
