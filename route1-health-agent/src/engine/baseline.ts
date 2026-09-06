/** 个人基线计算 —— 核心理念：不和统一阈值比，只和"这个老人自己平时"比 */
import type { DayRecord, MetricKey } from '../types';

export interface Baseline {
  mean: number;
  sd: number;
  n: number;
}

export interface BaselineOptions {
  /** 基线窗口天数（往前数多少天） */
  windowDays?: number;
  /** 基线截止日期 YYYY-MM-DD（默认取 records 里最大日期） */
  endDate?: string;
  /** 截止日往前排除多少天（比如最近 3 天正在恶化，就别让它们污染基线） */
  excludeDays?: number;
  /** 最少需要多少个数据点才给出基线 */
  minPoints?: number;
}

/** 两个日期相差天数（a - b） */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/**
 * 计算某个指标的滚动基线（均值 + 标准差）。
 * 数据点不足时返回 null，调用方应当"沉默"而不是用全局阈值硬凑。
 */
export function computeBaseline(
  records: DayRecord[],
  metric: MetricKey,
  options: BaselineOptions = {},
): Baseline | null {
  const { windowDays = 14, endDate, excludeDays = 0, minPoints = 5 } = options;

  const dated = records
    .filter((r) => r.metrics[metric] !== undefined)
    .map((r) => ({ date: r.date, value: r.metrics[metric] as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length === 0) return null;

  const cutoff = endDate ?? dated[dated.length - 1].date;

  const values = dated
    .filter((d) => {
      const delta = diffDays(d.date, cutoff); // cutoff - d.date
      return delta >= excludeDays && delta < excludeDays + windowDays;
    })
    .map((d) => d.value);

  if (values.length < minPoints) return null;

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance), n: values.length };
}

/** 最近 n 天（含 endDate）某指标的平均值 */
export function recentMean(
  records: DayRecord[],
  metric: MetricKey,
  endDate: string,
  days: number,
): number | null {
  const values = records
    .filter((r) => r.metrics[metric] !== undefined)
    .filter((r) => {
      const delta = diffDays(r.date, endDate);
      return delta >= 0 && delta < days;
    })
    .map((r) => r.metrics[metric] as number);
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * 变差方向上的偏离程度，单位：基线标准差的倍数。
 * 返回正数表示"变差了"，越大越反常；null 表示没有可用基线。
 */
export function deviationSigma(value: number, baseline: Baseline, higherIsBad: boolean): number | null {
  if (baseline.sd < 1e-9) return null;
  const raw = (value - baseline.mean) / baseline.sd;
  return higherIsBad ? raw : -raw;
}
