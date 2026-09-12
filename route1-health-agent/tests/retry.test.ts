/**
 * 重试助手（评审 P2：跨设备首连重试）回归：
 * 首连失败后按可注入的间隔重试，全部失败才抛最后一次的真实错误。
 */
import { runWithRetry } from '../src/engine/retry';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const noDelay = async () => {};

async function main() {
  // 场景一：前两次失败、第三次成功——onRetry 记录每次失败，最终返回成功值。
  const failures: number[] = [];
  const result = await runWithRetry(
    async (attempt) => {
      if (attempt < 3) {
        failures.push(attempt);
        throw new Error(`attempt ${attempt} failed`);
      }
      return 'connected';
    },
    { attempts: 3, delayMs: 0, sleep: noDelay },
  );
  assert(result === 'connected', '第三次尝试应当成功');
  assert(JSON.stringify(failures) === '[1,2]', `onRetry 应收到前两次失败，实际：${failures.join(',')}`);

  // 场景二：全部失败——抛最后一次的真实错误，不吞不包装。
  let attempts = 0;
  const retryErrors: string[] = [];
  try {
    await runWithRetry(
      async () => {
        attempts += 1;
        throw new Error(`signaling down #${attempts}`);
      },
      {
        attempts: 3,
        delayMs: 0,
        sleep: noDelay,
        onRetry: (_attempt, error) => {
          retryErrors.push(error.message);
        },
      },
    );
    assert(false, '全部失败时必须抛错');
  } catch (error) {
    assert(error instanceof Error && error.message === 'signaling down #3', `应抛最后一次错误，实际：${String(error)}`);
  }
  assert(attempts === 3, `应尝试满 3 次，实际 ${attempts} 次`);
  assert(
    JSON.stringify(retryErrors) === JSON.stringify(['signaling down #1', 'signaling down #2']),
    `onRetry 只回调前 N-1 次失败，实际：${retryErrors.join(',')}`,
  );

  // 场景三：首次即成功时不等待、不回调。
  let waited = 0;
  let retries = 0;
  const immediate = await runWithRetry(async () => 'ok', {
    attempts: 3,
    delayMs: 5,
    sleep: async (ms) => {
      waited += ms;
    },
    onRetry: () => {
      retries += 1;
    },
  });
  assert(immediate === 'ok' && waited === 0 && retries === 0, '首次成功不应重试或等待');

  console.log('PASS: first-connect retry exhausts attempts and surfaces the last real error');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
