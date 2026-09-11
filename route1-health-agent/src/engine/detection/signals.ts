import type { DayRecord, MetricKey, Observation, SymptomTag } from '../../types';
import { METRICS } from '../../types';
import { computeBaseline, deviationSigma, diffDays, recentMean } from '../baseline';
import type { DetectionConfig, MetricSignal } from './types';

export function hadTag(
  observations: Observation[],
  tag: SymptomTag,
  endDate: string,
  days: number,
): Observation | null {
  return (
    observations
      .filter((o) => o.tags.includes(tag) && diffDays(o.date, endDate) >= 0 && diffDays(o.date, endDate) < days)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  );
}

export function countRecentPoints(records: DayRecord[], metric: MetricKey, endDate: string, days: number): number {
  return records.filter(
    (r) => r.metrics[metric] !== undefined && diffDays(r.date, endDate) >= 0 && diffDays(r.date, endDate) < days,
  ).length;
}

export function getMetricSignal(
  records: DayRecord[],
  metric: MetricKey,
  today: string,
  config: DetectionConfig,
): MetricSignal | null {
  const baseline = computeBaseline(records, metric, {
    endDate: today,
    excludeDays: config.recentDays,
    windowDays: config.baselineDays,
    minPoints: config.minBaselinePoints,
  });
  const recentN = countRecentPoints(records, metric, today, config.recentDays);
  if (recentN < config.minRecentPoints) return null;

  const recent = recentMean(records, metric, today, config.recentDays);
  if (!baseline || recent === null || Math.abs(baseline.mean) < 1e-9) return null;

  const badDelta = METRICS[metric].higherIsBad ? recent - baseline.mean : baseline.mean - recent;
  return {
    metric,
    recentMean: recent,
    recentN,
    baselineMean: baseline.mean,
    baselineSd: baseline.sd,
    baselineN: baseline.n,
    badRatio: badDelta / Math.abs(baseline.mean),
    sigma: deviationSigma(recent, baseline, METRICS[metric].higherIsBad, metric),
  };
}

export function fmt(metric: MetricKey, value: number): string {
  const meta = METRICS[metric];
  return `${value.toFixed(meta.decimals)} ${meta.unit}`;
}
