import type { DeviceAdapter } from './DeviceAdapter';
import type { HealthMeasurement } from '../types';
import { METRICS } from '../types';
import { records } from '../data/demo';

/** 把现有 21 天模拟数据伪装成设备 Adapter，验证未来硬件接入边界。 */
export const demoDeviceAdapter: DeviceAdapter = {
  source: 'demo',
  async getMeasurements(_userId, from, to): Promise<HealthMeasurement[]> {
    return records
      .filter((record) => record.date >= from && record.date <= to)
      .flatMap((record) =>
        Object.entries(record.metrics).map(([metric, value]) => {
          const key = metric as HealthMeasurement['metric'];
          return {
            id: `demo-device-${record.date}-${metric}`,
            timestamp: `${record.date}T12:00:00`,
            metric: key,
            value: value as number,
            unit: METRICS[key].unit,
            source: 'demo' as const,
            metadata: { adapter: 'DemoDeviceAdapter' },
          };
        }),
      );
  },
};
