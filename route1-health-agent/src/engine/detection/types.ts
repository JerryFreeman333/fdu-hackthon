import type { DayRecord, Finding, HealthMeasurement, LabResult, MetricKey, Observation } from '../../types';
import type { HealthEvent } from '../../pipeline/events';

export interface DetectionConfig {
  recentDays: number;
  baselineDays: number;
  minBaselinePoints: number;
  minRecentPoints: number;
}

export interface MetricSignal {
  metric: MetricKey;
  recentMean: number;
  recentN: number;
  baselineMean: number;
  baselineSd: number;
  baselineN: number;
  badRatio: number;
  sigma: number | null;
}

export interface DetectionContext {
  /** Detection 的唯一输入口。下方数组全部由事件流派生。 */
  events: HealthEvent[];
  records: DayRecord[];
  observations: Observation[];
  labResults: LabResult[];
  measurements: HealthMeasurement[];
  today: string;
  config: DetectionConfig;
  signals: Map<MetricKey, MetricSignal>;
  findings: Finding[];
}

export interface DetectionRule {
  readonly id: string;
  evaluate(context: DetectionContext): Finding | Finding[] | null;
}
