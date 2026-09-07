import type { DataSource, HealthMeasurement } from '../types';

/**
 * 硬件/健康平台统一接口。
 * 当前先使用 DemoDeviceAdapter；未来接 HealthKit、Health Connect、厂商 SDK 或蓝牙设备时，
 * 只替换 Adapter，不修改 Baseline/Detection/Agent。
 */
export interface DeviceAdapter {
  readonly source: DataSource;
  getMeasurements(userId: string, from: string, to: string): Promise<HealthMeasurement[]>;
}
