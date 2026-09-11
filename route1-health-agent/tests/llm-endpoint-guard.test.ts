import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHttpLlmAdapter, generateAgentReply, isAllowedAgentEndpoint, type LlmAdapter } from '../src/engine/agent';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// P1-3 回归：localhost 前缀匹配放过 localhost.evil.com —— 必须按 hostname 精确判断。
assert(isAllowedAgentEndpoint('/api/agent/chat'), 'same-origin path must be allowed');
assert(isAllowedAgentEndpoint('https://agent.example.com/v1'), 'https endpoint must be allowed');
assert(isAllowedAgentEndpoint('http://localhost:3000/api'), 'localhost dev endpoint must be allowed');
assert(isAllowedAgentEndpoint('http://127.0.0.1:8000'), 'loopback dev endpoint must be allowed');
assert(!isAllowedAgentEndpoint('http://localhost.evil.com/steal'), 'lookalike localhost host must be rejected');
assert(!isAllowedAgentEndpoint('http://example.com/api'), 'plain http remote host must be rejected');
let rejectedConstruction = false;
try {
  createHttpLlmAdapter('http://localhost.evil.com/steal');
} catch {
  rejectedConstruction = true;
}
assert(rejectedConstruction, 'adapter construction must reject lookalike endpoints');

async function main() {
  // 挂起的端点：complete 必须在超时后失败，而不是无限等待整个对话回合。
  const hung = createServer(() => {
    // 故意不响应。
  });
  await new Promise<void>((resolve) => hung.listen(0, '127.0.0.1', resolve));
  const hungPort = (hung.address() as AddressInfo).port;
  const hungAdapter = createHttpLlmAdapter(`http://127.0.0.1:${hungPort}`, 150);
  const startedAt = Date.now();
  let timedOut = false;
  try {
    await hungAdapter.complete('sys', '我有点头晕', undefined);
  } catch {
    timedOut = true;
  }
  hung.close();
  assert(timedOut, 'hung endpoint must reject instead of waiting forever');
  assert(Date.now() - startedAt < 5000, 'timeout must fire promptly');

  // 正常端点：请求携带老人原话，返回内容透传。
  const good = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      assert(body.includes('我有点头晕'), 'adapter must send the elder text');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ text: '先坐下来休息。' }));
    });
  });
  await new Promise<void>((resolve) => good.listen(0, '127.0.0.1', resolve));
  const goodPort = (good.address() as AddressInfo).port;
  const goodAdapter = createHttpLlmAdapter(`http://127.0.0.1:${goodPort}`);
  const completion = await goodAdapter.complete('sys', '我有点头晕', undefined);
  good.close();
  assert(completion.text === '先坐下来休息。', 'healthy endpoint payload must pass through');

  // 失败的 adapter：generateAgentReply 必须回退到规则回复，而不是让回合失败。
  const failingAdapter: LlmAdapter = {
    async complete() {
      throw new Error('endpoint down');
    },
  };
  const fallback = await generateAgentReply('我有点头晕', ['dizziness'], [], false, undefined, failingAdapter);
  assert(fallback.trim().length > 0, 'adapter failure must fall back to the rule-based reply');

  console.log('PASS: llm endpoint guard, timeout, and fallback regression suite');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
