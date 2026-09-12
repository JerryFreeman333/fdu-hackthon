/**
 * 时钟服务（评审 P1-4：跨天正确性）。
 *
 * 之前运行时的"今天"是 data/demo.ts 里模块加载时定格的常量 TODAY：
 * 页面跨午夜继续开着时，新消息、新任务、新检测会被全部算到昨天。
 * 时钟服务把"今天"变成可注入、可对时的状态：
 * - todayNow()：一次性读当前本地日期；
 * - startClockService(onDateChange, deps)：默认每分钟 tick + 页面重新可见时对时，
 *   本地日期翻转时才回调；deps 全部可注入，单测能模拟 23:59 → 00:01。
 * data/demo.ts 里仍保留一个 TODAY，但只用于锚定"加载那一刻"的演示种子数据，
 * 运行期逻辑一律走本服务注入的 today。
 */

/** 把墙上时间格式化为本地日期 YYYY-MM-DD；不能用 toISOString（UTC+ 时区会退回前一天）。 */
export function formatLocalDate(date: Date): string {
  const pad = (value: number, width = 2): string => `${value}`.padStart(width, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayNow(): string {
  return formatLocalDate(new Date());
}

export interface ClockDeps {
  /** 当前时间（可注入假时钟）。 */
  now?: () => Date;
  /** 周期 tick（默认 window.setInterval 每分钟）。返回取消函数。 */
  scheduleTick?: (callback: () => void, ms: number) => () => void;
  /** 页面从后台恢复时对时（默认 visibilitychange + focus）。 */
  onWake?: (callback: () => void) => () => void;
}

export interface ClockService {
  /** 当前的"今天"（每次现读，不缓存）。 */
  today(): string;
  stop(): void;
}

const MINUTE_MS = 60_000;

export function startClockService(onDateChange: (today: string) => void, deps: ClockDeps = {}): ClockService {
  const now = deps.now ?? (() => new Date());
  let lastDate = formatLocalDate(now());

  function check() {
    const current = formatLocalDate(now());
    if (current === lastDate) return;
    lastDate = current;
    onDateChange(current);
  }

  const cancelTick = (deps.scheduleTick ?? defaultScheduleTick)(check, MINUTE_MS);
  const cancelWake = (deps.onWake ?? defaultOnWake)(check);

  return {
    today: () => formatLocalDate(now()),
    stop: () => {
      cancelTick();
      cancelWake();
    },
  };
}

function defaultScheduleTick(callback: () => void, ms: number): () => void {
  if (typeof window === 'undefined') return () => {};
  const id = window.setInterval(callback, ms);
  return () => window.clearInterval(id);
}

function defaultOnWake(callback: () => void): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const handler = () => {
    if (document.visibilityState === 'visible') callback();
  };
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('focus', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('focus', handler);
  };
}

/** 聊天时间标签：日期部分来自注入的"今天"，时刻部分来自墙上时间（评审 P1-4）。 */
export function chatClockLabel(today: string, now: Date): string {
  const pad = (value: number): string => `${value}`.padStart(2, '0');
  return `${today.slice(5)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
