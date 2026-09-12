/**
 * 通用重试助手（评审 P2：跨设备首连重试）。
 *
 * 家属端第一次连接老人端时，信令握手可能因为公网信令抖动 / 老人端 peer
 * 尚未完成注册而失败。之前一次失败就把状态打成"暂时没连上"，实际网络
 * 正常时再试一次往往就能成功。重试次数与间隔全部可注入，单测不真等。
 */

export interface RetryOptions {
  /** 总尝试次数（含第一次），最小 1。 */
  attempts: number;
  /** 每次失败后的等待间隔（毫秒）。 */
  delayMs: number;
  /** 等待函数（可注入假时钟；默认真 setTimeout）。 */
  sleep?: (ms: number) => Promise<void>;
  /** 每次失败后的回调（attempt 从 1 开始；UI 用它显示"正在重试"）。 */
  onRetry?: (attempt: number, error: Error) => void;
}

export async function runWithRetry<T>(task: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // 最后一次失败不会再有重试，不触发 onRetry（它表示"还有下一次"）。
      if (attempt < attempts) {
        options.onRetry?.(attempt, lastError);
        await sleep(options.delayMs);
      }
    }
  }
  throw lastError ?? new Error('retry failed');
}
