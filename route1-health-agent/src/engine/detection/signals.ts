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

/**
 * 与 hadTag 等价，但额外要求观察的 status 字段是 'occurred' 或缺失。
 *
 * 老的 hadTag 会被基线偏离规则（multisignal fusion / metric baseline 等）
 * 继续使用，因为这些规则统计的是一段时间里的发生频次，本身就需要把所有
 * 出现过的事件都计入。
 *
 * 但 safety.* 系列规则（红症状 / 跌倒 / SpO2 / 心率 / 血压 / 血糖）
 * 是按"事件真的发生"来升级等级的——一旦用户明确说"没胸痛 / 假设摔倒 /
 * 不确定算不算"，这种话不能被当成真实危险信号推家属。
 *
 * 因此 safety.ts 全部改用这个 helper：
 *   - status 缺失 → 视为 'occurred'（兼容老数据 / 设备导入）
 *   - status === 'occurred' → 命中
 *   - 其它（negated / hypothetical / uncertain / near_miss）→ 跳过
 */
export function hadOccurredObservation(
  observations: Observation[],
  tag: SymptomTag,
  endDate: string,
  days: number,
): Observation | null {
  return (
    observations
      .filter(
        (o) =>
          o.tags.includes(tag) &&
          (o.status === undefined || o.status === 'occurred') &&
          diffDays(o.date, endDate) >= 0 &&
          diffDays(o.date, endDate) < days,
      )
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
