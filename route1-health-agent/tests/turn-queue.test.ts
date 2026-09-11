import { setTimeout as wait } from 'node:timers/promises';
import { createTurnQueue } from '../src/engine/turnQueue';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const queue = createTurnQueue();
  const events: string[] = [];

  // 慢回合先入队、快回合后入队：必须严格按发送顺序执行，
  // 否则两个未完成回合会互相覆盖健康事件、更正也会失去确定的先后关系。
  const slow = queue.enqueue(async () => {
    events.push('slow:start');
    await wait(80);
    events.push('slow:end');
    return 'slow';
  });
  const fast = queue.enqueue(async () => {
    events.push('fast:start');
    events.push('fast:end');
    return 'fast';
  });

  const [slowResult, fastResult] = await Promise.all([slow, fast]);
  assert(slowResult === 'slow' && fastResult === 'fast', 'queue must preserve results');
  assert(
    events.join('|') === 'slow:start|slow:end|fast:start|fast:end',
    `tasks must run strictly in send order, got ${events.join('|')}`,
  );

  // 单个回合失败要能被调用方感知，但不能打断后续回合。
  const failing = queue.enqueue(async () => {
    throw new Error('turn failed');
  });
  let rejected = false;
  await failing.catch(() => {
    rejected = true;
  });
  assert(rejected, 'caller must still see the task failure');

  let recovered = false;
  await queue.enqueue(async () => {
    recovered = true;
  });
  assert(recovered, 'a failed turn must not break the queue for later turns');

  console.log('PASS: elder turn queue serializes processing and survives failures');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
