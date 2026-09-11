/**
 * 老人对话轮次队列：回显立即上屏，重处理按发送顺序串行执行。
 *
 * 串行化保证“更正上一句”这类跨轮操作有确定的先后关系，
 * 也避免两个未完成的回合用过期闭包互相覆盖健康事件。
 * 单个回合失败不能打断队列，后续回合必须照常执行。
 */
export interface TurnQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export function createTurnQueue(): TurnQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const run = tail.then(task, task);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
