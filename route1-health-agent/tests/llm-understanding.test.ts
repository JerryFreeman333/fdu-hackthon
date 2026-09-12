import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseLlmUnderstanding,
  judgeClauseStatuses,
  mergeClauseStatus,
  parseJudgmentJson,
  resolveUnderstandingLlmConfig,
  understandElderInputWithLlm,
  type UnderstandingLlmConfig,
} from '../src/engine/llmUnderstanding';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-11';

const BASE_CONFIG: UnderstandingLlmConfig = {
  baseUrl: 'https://llm.example.com/v4',
  apiKey: 'test-key',
  model: 'test-model',
  timeoutMs: 2000,
};

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function jsonFetcher(payload: unknown, status = 200) {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })) as unknown as (...args: unknown[]) => Promise<FakeResponse>;
}

const toFetch = (fn: unknown): typeof fetch => fn as typeof fetch;

function chatCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

test('配置解析：缺 baseUrl / key / 非法协议返回 null（纯规则模式）', () => {
  assert.equal(resolveUnderstandingLlmConfig({}), null);
  assert.equal(resolveUnderstandingLlmConfig({ VITE_UNDERSTANDING_LLM_BASE_URL: 'https://x.com' }), null);
  assert.equal(resolveUnderstandingLlmConfig({ VITE_UNDERSTANDING_LLM_API_KEY: 'k' }), null);
  assert.equal(
    resolveUnderstandingLlmConfig({
      VITE_UNDERSTANDING_LLM_BASE_URL: 'ftp://x.com',
      VITE_UNDERSTANDING_LLM_API_KEY: 'k',
    }),
    null,
  );
  const full = resolveUnderstandingLlmConfig({
    VITE_UNDERSTANDING_LLM_BASE_URL: 'https://x.com/v4/',
    VITE_UNDERSTANDING_LLM_API_KEY: 'k',
  });
  assert.ok(full);
  assert.equal(full.baseUrl, 'https://x.com/v4');
  assert.equal(full.model, 'glm-4-flash', '缺省模型为 glm-4-flash');
});

test('parseJudgmentJson：稳健抽取 JSON，丢弃非法条目', () => {
  const good = parseJudgmentJson('[{"i":0,"s":"negated"},{"i":1,"s":"occurred"}]', 2);
  assert.deepEqual(good, [
    { clauseIndex: 0, status: 'negated' },
    { clauseIndex: 1, status: 'occurred' },
  ]);
  // 带前后噪声的回复
  const noisy = parseJudgmentJson('好的，结果如下：\n[{"i":0,"s":"negated"}]\n以上。', 1);
  assert.deepEqual(noisy, [{ clauseIndex: 0, status: 'negated' }]);
  // 非法状态值 / 越界索引 / 非 JSON
  assert.equal(parseJudgmentJson('[{"i":0,"s":"banana"}]', 1), null);
  assert.equal(parseJudgmentJson('[{"i":9,"s":"negated"}]', 1), null);
  assert.equal(parseJudgmentJson('我没有听清', 1), null);
});

test('judgeClauseStatuses：HTTP 错误 / 空回复返回 null，由调用方回落规则', async () => {
  assert.equal(await judgeClauseStatuses(['头晕'], BASE_CONFIG, toFetch(jsonFetcher(chatCompletion('[]'), 500))), null);
  assert.equal(await judgeClauseStatuses(['头晕'], BASE_CONFIG, toFetch(jsonFetcher({ choices: [] }))), null);
  assert.equal(
    await judgeClauseStatuses([], BASE_CONFIG, toFetch(jsonFetcher(chatCompletion('[{"i":0,"s":"negated"}]')))),
    null,
  );
});

test('judgeClauseStatuses：网络异常吞掉并返回 null（fail-closed 回落规则）', async () => {
  const failing = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
  const result = await judgeClauseStatuses(['头晕'], BASE_CONFIG, failing);
  assert.equal(result, null);
});

test('judgeClauseStatuses：超时中止请求并返回 null', async () => {
  const never = ((_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
  const result = await judgeClauseStatuses(['头晕'], { ...BASE_CONFIG, timeoutMs: 1000 }, never);
  assert.equal(result, null);
});

test('隐私门控：private / no_record 永远不发送给外部模型', () => {
  assert.equal(canUseLlmUnderstanding('private', true), false);
  assert.equal(canUseLlmUnderstanding('no_record', true), false);
  assert.equal(canUseLlmUnderstanding('none', true), true);
  assert.equal(canUseLlmUnderstanding('share_family', true), true);
  assert.equal(canUseLlmUnderstanding('none', false), false, '未配置时不启用');
});

test('合并策略：强词汇信号不被 LLM 覆盖，肯否轴双向仲裁', () => {
  assert.equal(mergeClauseStatus('hypothetical', 'occurred'), 'hypothetical');
  assert.equal(mergeClauseStatus('uncertain', 'negated'), 'uncertain');
  assert.equal(mergeClauseStatus('near_miss', 'occurred'), 'near_miss');
  assert.equal(mergeClauseStatus('occurred', 'negated'), 'negated');
  assert.equal(mergeClauseStatus('negated', 'occurred'), 'occurred');
  assert.equal(mergeClauseStatus('occurred', 'occurred'), 'occurred');
  // LLM 给出 uncertain 但规则判 occurred：不收紧为 occurred 之外的方向（保守不记录）
  assert.equal(mergeClauseStatus('occurred', 'uncertain'), 'occurred');
});

test('端到端：规则误判 occurred 时 LLM 仲裁翻转为 negated（比较级好转句）', async () => {
  // "今天没那么喘了" 规则按既有语义判 occurred；LLM 判 negated → 最终不记录
  const text = '今天没那么喘了，比昨天好多了';
  const ruleBased = understandElderInput(text, TODAY);
  assert.equal(acceptedSelfClaims(ruleBased).length, 1, '规则模式按既有语义记录');

  let requestedBody: { messages?: Array<{ role: string; content: string }> } | undefined;
  const fetchImpl = toFetch(((_url: unknown, init?: { body?: string }) => {
    requestedBody = JSON.parse(init?.body ?? '{}');
    return Promise.resolve(jsonFetcher(chatCompletion('[{"i":0,"s":"negated"}]'))());
  }) as unknown);

  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  assert.equal(acceptedSelfClaims(merged).length, 0, 'LLM 仲裁后不应记录');
  assert.ok(requestedBody?.messages?.[0]?.content?.includes('negated'), '请求应包含判定指令');
});

test('端到端：规则误判 negated 时 LLM 仲裁恢复为 occurred（双重否定）', async () => {
  const text = '我不是没有喘';
  const ruleBased = understandElderInput(text, TODAY);
  assert.equal(acceptedSelfClaims(ruleBased).length, 0, '规则模式把双重否定当否定');

  const fetchImpl = jsonFetcher(chatCompletion('[{"i":0,"s":"occurred"}]')) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  const accepted = acceptedSelfClaims(merged);
  assert.equal(accepted.length, 1, 'LLM 识别双重否定后应记录');
  assert.ok(accepted[0]?.tags.includes('dyspnea'));
});

test('端到端：LLM 失败时回落到与规则模式完全一致的结果', async () => {
  const text = '我胸口疼了一上午';
  const ruleBased = understandElderInput(text, TODAY);
  const fetchImpl = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  assert.deepEqual(
    acceptedSelfClaims(merged).map((c) => c.tags),
    acceptedSelfClaims(ruleBased).map((c) => c.tags),
  );
  assert.equal(acceptedSelfClaims(merged).length, 1);
});

test('端到端：超长输入/子句过多时直接走规则，不发起 LLM 请求', async () => {
  let called = 0;
  const counting = ((..._args: unknown[]) => {
    called += 1;
    return Promise.reject(new Error('should not be called'));
  }) as unknown as typeof fetch;
  const longText = '喘'.repeat(600);
  const merged = await understandElderInputWithLlm(longText, TODAY, [], BASE_CONFIG, counting);
  assert.equal(called, 0, '超长输入不得发起请求');
  assert.equal(merged.claims.length, understandElderInput(longText, TODAY).claims.length);
});
