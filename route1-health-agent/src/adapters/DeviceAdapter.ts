import type { DataSource, HealthMeasurement } from '../types';

/**
 * 硬件/健康平台统一接口。
 * Demo 与 HealthKit 使用相同接口；切换 Adapter 不修改 Baseline/Detection/Agent。
 */
export interface DeviceAdapter {
  readonly source: DataSource;
  getMeasurements(userId: string, from: string, to: string): Promise<HealthMeasurement[]>;
}
