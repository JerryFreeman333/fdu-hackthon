/**
 * 时钟服务（评审 P1-4）：运行期的"今天"必须可注入、可对时。
 * 核心回归：23:59 发出的消息属于当天，00:01 发出的消息属于新的一天；
 * 旧的模块级 TODAY 常量会把跨午夜后的新消息全部算到昨天。
 */
import { chatClockLabel, formatLocalDate, startClockService, todayNow, type ClockDeps } from '../src/engine/clock';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** 手动驱动的假时钟 deps：tick/wake 由测试显式触发，now 可随时拨动。 */
function manualClockDeps(initial: Date): ClockDeps & { setNow(next: Date): void; tick(): void; wake(): void } {
  let now = initial;
  let tickCb: (() => void) | null = null;
  let wakeCb: (() => void) | null = null;
  return {
    now: () => now,
    scheduleTick: (callback) => {
      tickCb = callback;
      return () => {
        tickCb = null;
      };
    },
    onWake: (callback) => {
      wakeCb = callback;
      return () => {
        wakeCb = null;
      };
    },
    setNow(next) {
      now = next;
    },
    tick() {
      tickCb?.();
    },
    wake() {
      wakeCb?.();
    },
  };
}

// 场景一（评审 P1-4 核心）：23:59 / 00:01 两条消息分属两天。
const deps = manualClockDeps(new Date(2026, 8, 12, 23, 58, 30));
const dateChanges: string[] = [];
const clock = startClockService((today) => dateChanges.push(today), deps);

deps.setNow(new Date(2026, 8, 12, 23, 59, 0));
deps.tick();
assert(dateChanges.join(',') === '', '同一本地日期内的 tick 不应触发日期变更');
const firstMessageLabel = chatClockLabel(clock.today(), new Date(2026, 8, 12, 23, 59, 10));

deps.setNow(new Date(2026, 8, 13, 0, 1, 0));
deps.tick();
assert(
  dateChanges.join(',') === '2026-09-13',
  `跨午夜的 tick 必须回调新日期，实际回调：${dateChanges.join(',') || '（无）'}`,
);
const secondMessageLabel = chatClockLabel(clock.today(), new Date(2026, 8, 13, 0, 1, 10));

assert(firstMessageLabel.startsWith('09-12 23:59'), `第一条消息应属于 09-12，实际：${firstMessageLabel}`);
assert(secondMessageLabel.startsWith('09-13 00:01'), `第二条消息应属于 09-13，实际：${secondMessageLabel}`);
assert(
  firstMessageLabel.slice(0, 5) !== secondMessageLabel.slice(0, 5),
  '注入时钟后 23:59 与 00:01 的两条消息必须分属两天',
);
clock.stop();

// 场景二：页面在后台跨天，恢复可见时必须对时；日期未再变化时不得重复回调。
const deps2 = manualClockDeps(new Date(2026, 8, 12, 22, 0, 0));
const changes2: string[] = [];
const clock2 = startClockService((today) => changes2.push(today), deps2);
deps2.setNow(new Date(2026, 8, 13, 8, 5, 0));
deps2.wake();
assert(changes2.join(',') === '2026-09-13', '从后台恢复必须对时并触发日期变更');
deps2.wake();
assert(changes2.join(',') === '2026-09-13', '日期未再变化时重复 wake 不应重复回调');

// 场景三：stop() 之后 tick/wake 都不再生效。
clock2.stop();
deps2.setNow(new Date(2026, 8, 14, 9, 0, 0));
deps2.tick();
deps2.wake();
assert(changes2.join(',') === '2026-09-13', 'stop() 后不得再触发日期变更回调');

// 场景四：todayNow 与 formatLocalDate(new Date()) 一致（时区安全约定不变）。
assert(todayNow() === formatLocalDate(new Date()), 'todayNow 必须等于当前进程的本地日期');

console.log('PASS: injected clock service rolls the day over at midnight');
