import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseLlmUnderstanding,
  judgeClauseStatuses,
  mergeClauseStatus,
  mergeClauseStatusWithAddedTags,
  mergeClauseTags,
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

test('parseJudgmentJson：解析症状标签 t，非法标签剔除、空数组视同未提供', () => {
  const good = parseJudgmentJson(
    '[{"i":0,"s":"negated","t":["dizziness"]},{"i":1,"s":"occurred","t":["banana","pain"]}]',
    2,
  );
  assert.deepEqual(good, [
    { clauseIndex: 0, status: 'negated', tags: ['dizziness'] },
    { clauseIndex: 1, status: 'occurred', tags: ['pain'] },
  ]);
  // 无 t 字段 / 空数组：不带 tags 键（与只仲裁肯否的旧契约兼容）
  assert.deepEqual(parseJudgmentJson('[{"i":0,"s":"negated"}]', 1), [{ clauseIndex: 0, status: 'negated' }]);
  assert.deepEqual(parseJudgmentJson('[{"i":0,"s":"occurred","t":[]}]', 1), [{ clauseIndex: 0, status: 'occurred' }]);
});

test('mergeClauseTags：LLM 只增不删，规则标签是下限', () => {
  assert.deepEqual(mergeClauseTags(['fatigue'], ['dizziness', 'fatigue']), ['fatigue', 'dizziness']);
  assert.deepEqual(mergeClauseTags(['pain'], undefined), ['pain']);
  assert.deepEqual(mergeClauseTags([], ['dizziness', 'dizziness']), ['dizziness']);
});

test('mergeClauseStatusWithAddedTags：LLM 补标签时肯否采 LLM，强词汇信号优先', () => {
  assert.equal(mergeClauseStatusWithAddedTags('occurred', 'negated'), 'negated');
  assert.equal(mergeClauseStatusWithAddedTags('negated', 'occurred'), 'occurred');
  assert.equal(mergeClauseStatusWithAddedTags('occurred', 'hypothetical'), 'hypothetical');
  assert.equal(mergeClauseStatusWithAddedTags('hypothetical', 'occurred'), 'hypothetical', '假设句不因补标签被记录');
  assert.equal(mergeClauseStatusWithAddedTags('uncertain', 'occurred'), 'uncertain');
  assert.equal(mergeClauseStatusWithAddedTags('near_miss', 'occurred'), 'near_miss');
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

test('端到端：规则漏识别的否定症状（头一点都不晕了）不再整句消失', async () => {
  // "头"与"晕"隔 3 个字，超出 INTENT_RULES {0,2} 窗口：规则模式整句无 claim、界面零反馈。
  const text = '头一点都不晕了';
  const ruleBased = understandElderInput(text, TODAY);
  assert.equal(ruleBased.claims.length, 0, '规则模式：标签漏识别，整句无 claim（本轮修复的现状）');

  const fetchImpl = jsonFetcher(chatCompletion('[{"i":0,"s":"negated","t":["dizziness"]}]')) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  assert.equal(merged.claims.length, 1, 'LLM 补识别后否定事实必须存在，不能静默丢弃');
  assert.deepEqual(merged.claims[0]?.tags, ['dizziness']);
  assert.equal(merged.claims[0]?.status, 'negated');
  assert.equal(acceptedSelfClaims(merged).length, 0, '被否认的症状不得进入事实流');
});

test('端到端：混合句的否定半句不被整句丢弃（不晕，但是有点累）', async () => {
  // "不晕"无"头"字，规则识别不出 dizziness；旧结果是这半句凭空消失。
  const text = '不晕，但是有点累';
  const fetchImpl = jsonFetcher(
    chatCompletion('[{"i":0,"s":"negated","t":["dizziness"]},{"i":1,"s":"occurred","t":["fatigue"]}]'),
  ) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  const dizzinessClaim = merged.claims.find((claim) => claim.tags.includes('dizziness'));
  assert.ok(dizzinessClaim, '“不晕”这半句的头晕否定必须被保留');
  assert.equal(dizzinessClaim?.status, 'negated');
  const accepted = acceptedSelfClaims(merged);
  assert.equal(accepted.length, 1, '疲劳部分照常记录');
  assert.ok(accepted[0]?.tags.includes('fatigue'));
});

test('端到端：让步句式（摔是没摔，就是腿软了一下）两个事实都不丢', async () => {
  // 老人口语常见的"X是没X，就是Y"：规则对 X（fall 需紧邻"倒/了"）和 Y（腿软）都不识别。
  const text = '摔是没摔，就是腿软了一下';
  const ruleBased = understandElderInput(text, TODAY);
  assert.equal(ruleBased.claims.length, 0, '规则模式：两个事实都识别不出（本轮修复的现状）');

  const fetchImpl = jsonFetcher(
    chatCompletion('[{"i":0,"s":"negated","t":["fall"]},{"i":1,"s":"occurred","t":["fatigue"]}]'),
  ) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  assert.equal(merged.claims.length, 2, '否定的事实与报告的事实都要留下痕迹');
  const fallClaim = merged.claims.find((claim) => claim.tags.includes('fall'));
  assert.ok(fallClaim);
  assert.equal(fallClaim?.status, 'negated', '“摔是没摔”按否定记录，不得触发摔倒安全流程');
  const fatigueClaim = merged.claims.find((claim) => claim.tags.includes('fatigue'));
  assert.ok(fatigueClaim);
  assert.equal(fatigueClaim?.status, 'occurred', '“腿软了一下”是真实身体状况，应进入事实流');
  assert.deepEqual(
    acceptedSelfClaims(merged).map((claim) => claim.tags),
    [['fatigue']],
  );
});

test('端到端：LLM 补识别的症状按 occurred 进入事实流（有点眩晕）', async () => {
  const text = '今天有点眩晕';
  assert.equal(acceptedSelfClaims(understandElderInput(text, TODAY)).length, 0, '规则模式识别不出眩晕');

  const fetchImpl = jsonFetcher(
    chatCompletion('[{"i":0,"s":"occurred","t":["dizziness"]}]'),
  ) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  const accepted = acceptedSelfClaims(merged);
  assert.equal(accepted.length, 1, '补识别的症状照常记录，而不是静默消失');
  assert.ok(accepted[0]?.tags.includes('dizziness'));
});

test('端到端：规则看不见的假设句由 LLM 肯否仲裁，不被误记录', async () => {
  // "眩晕"对规则不可见，规则的 hypothetical 判定门槛（句内需有规则可识别的健康词）也够不到，
  // 此时肯否完全由 LLM 仲裁——LLM 判假设 → 只留 claim 痕迹，不进事实流。
  const text = '如果眩晕怎么办';
  const fetchImpl = jsonFetcher(
    chatCompletion('[{"i":0,"s":"hypothetical","t":["dizziness"]}]'),
  ) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  assert.equal(acceptedSelfClaims(merged).length, 0, '假设句不得因标签补识别而被记录');
  const claim = merged.claims.find((item) => item.tags.includes('dizziness'));
  assert.equal(claim?.status, 'hypothetical');
});

test('端到端：LLM 补标签时规则的强词汇信号仍然优先（差点眩晕摔倒）', async () => {
  // 规则能探到"差点…摔倒"的 near_miss 强信号，但"眩晕"标签漏识别；
  // LLM 说 occurred 也不得把擦边事件记成真实发生。
  const text = '差点眩晕摔倒';
  const fetchImpl = jsonFetcher(
    chatCompletion('[{"i":0,"s":"occurred","t":["dizziness"]}]'),
  ) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  assert.equal(acceptedSelfClaims(merged).length, 0, '擦边事件不得因标签补识别而被记录');
  const claim = merged.claims.find((item) => item.tags.includes('dizziness'));
  assert.equal(claim?.status, 'near_miss');
});

test('端到端：LLM 不得删除规则已识别的标签', async () => {
  const text = '我今天头晕';
  const fetchImpl = jsonFetcher(chatCompletion('[{"i":0,"s":"occurred","t":[]}]')) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  const accepted = acceptedSelfClaims(merged);
  assert.equal(accepted.length, 1);
  assert.ok(accepted[0]?.tags.includes('dizziness'), '规则识别出的标签不被 LLM 空标签删除');
});

test('端到端：LLM 失败时标签漏识别的句子保持纯规则结果', async () => {
  const text = '头一点都不晕了';
  const fetchImpl = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
  const merged = await understandElderInputWithLlm(text, TODAY, [], BASE_CONFIG, fetchImpl);
  assert.deepEqual(
    merged.claims,
    understandElderInput(text, TODAY).claims,
    'fail-closed：回落规则，不产生半真半假的 claim',
  );
});
