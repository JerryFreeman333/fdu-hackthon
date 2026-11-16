/**
 * 体温分部位分流阈值（产品安全分流配置，不是诊断标准）。
 *
 * 为什么要分部位：同一时刻的核心体温，用不同部位测量会得到系统性不同的读数。
 * 中国临床常用的发热分度以腋温为基准（低热 37.3–38.0、中等度热 38.1–39.0、
 * 高热 39.1–41.0 ℃）；口温比腋温高约 0.2 ℃，耳温/肛温接近核心温度、比腋温
 * 高约 0.5 ℃。本表按这三条公开的临床惯例把同一套"观察 / 联系医生 / 立即确认"
 * 三档映射到各部位，而不是给每个部位编一套互不相干的数字。
 *
 * 三条硬约束：
 * 1. 本表是**产品分流配置**，不是诊断标准，也不能替代医生判断。上线前必须由
 *    临床负责人逐行签署；改阈值只改这一处，不要在规则里散落魔法数字。
 * 2. `unknown` 不映射到任何已知部位：观察线按最敏感的腋温（37.3）兜底，避免
 *    漏掉"可能是腋温低热"的读数；联系医生/立即确认两档保持 39.0/40.0，
 *    不在缺部位时按某个部位的重症阈值冒充。此时必须提示补记部位并复测。
 * 3. 额温受环境温度、出汗和 device 校准影响最大，只作筛查；文案必须提示用
 *    腋温/口温复测。
 */
import type { HealthMeasurement, TemperatureSite } from '../../types';

export type TemperatureGrade = 'normal' | 'watch' | 'alert' | 'urgent';

export interface TemperatureBand {
  site: TemperatureSite;
  /** 展示名（与 TEMPERATURE_SITE_LABELS 一致，单独列出便于配置自洽） */
  label: string;
  /** 需要记录并复测的下限（该部位的发热起点） */
  watch: number;
  /** 需要当天联系医生的下限 */
  alert: number;
  /** 需要立即联系/按急救路径评估的下限 */
  urgent: number;
}

export const TEMPERATURE_BANDS: Record<TemperatureSite, TemperatureBand> = {
  axillary: { site: 'axillary', label: '腋温', watch: 37.3, alert: 38.1, urgent: 39.1 },
  oral: { site: 'oral', label: '口温', watch: 37.5, alert: 38.3, urgent: 39.3 },
  ear: { site: 'ear', label: '耳温', watch: 37.8, alert: 38.5, urgent: 39.5 },
  rectal: { site: 'rectal', label: '肛温', watch: 37.8, alert: 38.5, urgent: 39.5 },
  forehead: { site: 'forehead', label: '额温', watch: 37.5, alert: 38.3, urgent: 39.3 },
  // 未说明部位：不借用任何部位的"联系医生/立即确认"阈值，但观察线必须压到
  // 37.3——否则"体温37.5"这种可能是腋温低热的读数会被静默当成正常，而它恰恰
  // 是最需要补记部位并复测的一档。watch 不通知家属，只记录并提示补记部位。
  unknown: { site: 'unknown', label: '未分部位', watch: 37.3, alert: 39.0, urgent: 40.0 },
};

const SITE_ALIASES: Record<string, TemperatureSite> = {
  axillary: 'axillary',
  axilla: 'axillary',
  腋温: 'axillary',
  腋下: 'axillary',
  腋窝: 'axillary',
  oral: 'oral',
  口温: 'oral',
  口腔: 'oral',
  舌下: 'oral',
  ear: 'ear',
  耳温: 'ear',
  耳道: 'ear',
  tympanic: 'ear',
  forehead: 'forehead',
  额温: 'forehead',
  额头: 'forehead',
  temporal: 'forehead',
  rectal: 'rectal',
  肛温: 'rectal',
  直肠: 'rectal',
  肛门: 'rectal',
  unknown: 'unknown',
  未分部位: 'unknown',
};

/** 把任意来源（旧数据、metadata、表单输入）的部位值收敛成显式枚举。 */
export function resolveTemperatureSite(raw: unknown): TemperatureSite {
  if (typeof raw !== 'string') return 'unknown';
  const key = raw.trim().toLowerCase();
  if (!key) return 'unknown';
  return SITE_ALIASES[key] ?? SITE_ALIASES[raw.trim()] ?? 'unknown';
}

export function temperatureBand(site: TemperatureSite): TemperatureBand {
  return TEMPERATURE_BANDS[site] ?? TEMPERATURE_BANDS.unknown;
}

/** 单条读数按自己的部位判级；不同部位的读数绝不先混在一起取最大值。 */
export function classifyTemperature(value: number, site: TemperatureSite): TemperatureGrade {
  if (!Number.isFinite(value)) return 'normal';
  const band = temperatureBand(site);
  if (value >= band.urgent) return 'urgent';
  if (value >= band.alert) return 'alert';
  if (value >= band.watch) return 'watch';
  return 'normal';
}

const GRADE_RANK: Record<TemperatureGrade, number> = { normal: 0, watch: 1, alert: 2, urgent: 3 };

export function compareTemperatureGrade(a: TemperatureGrade, b: TemperatureGrade): number {
  return GRADE_RANK[a] - GRADE_RANK[b];
}

/** 从测量记录里取出部位；字段缺失时退回 metadata，再退到 unknown。 */
export function measurementTemperatureSite(measurement: HealthMeasurement): TemperatureSite {
  return resolveTemperatureSite(measurement.temperatureSite ?? measurement.metadata?.temperatureSite);
}

/**
 * 是否达到该部位的发热起点。用于"发烧"标签与值感知回复，
 * 不能让 37.6 ℃ 的腋温因为一条 38.0 的全局阈值被当成正常。
 */
export function isFeverishTemperature(value: number, site: TemperatureSite): boolean {
  return value >= temperatureBand(site).watch;
}
