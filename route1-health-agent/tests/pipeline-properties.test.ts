/**
 * 管线性质测试（评审 P2：验证体系）——不逐句断言文案，只断言管线必须永远成立的性质：
 *
 * 1. 无静默丢弃：语料里的每一句话都必须得到回应（主气泡非空），任何理解失败
 *    都不能让界面零反馈；
 * 2. 不得凭空捏造：没有可接受 claim 就不得产生健康事件；事件只能来自老人原话
 *    对应的 claim 标签，不能由管线自行发明；
 * 3. 归属正确：家属消息永不写进本人档案；no_record 一条事件都不落。
 *
 * 语料来自 tests/corpus/utterances.json，新增语料自动纳入本测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planElderTurn, type ElderTurnRequest } from '../src/engine/elderTurn';
import { ruleBasedAdapter } from '../src/engine/agent';
import { understandElderInput, acceptedSelfClaims } from '../src/engine/understanding';

const TODAY = '2026-09-12';

interface CorpusExpectation {
  minEvents?: number;
  minFamilyEvents?: number;
  forbiddenTags?: string[];
}

interface CorpusUtterance {
  text: string;
  category: 'self-occurred' | 'negated' | 'family' | 'no-record' | 'conversational' | 'mixed';
  subject?: string;
  expect?: CorpusExpectation;
}

const corpus: CorpusUtterance[] = JSON.parse(
  readFileSync(resolve(__dirname, 'corpus', 'utterances.json'), 'utf8'),
).utterances;

async function planOf(text: string) {
  const request: ElderTurnRequest = {
    text,
    understanding: understandElderInput(text, TODAY, []),
    priorChat: [],
    findings: [],
    events: [],
    familySharing: 'denied',
    agentContext: undefined,
    llmAdapter: ruleBasedAdapter,
    today: TODAY,
    now: '09-12 08:30',
    receivedAt: `${TODAY}T08:30:00.000`,
    sourceMessageId: 'elder-corpus-1',
    idSeed: 1757600000000,
  };
  return planElderTurn(request);
}

test('语料非空且分类合法', () => {
  assert.ok(corpus.length >= 20, '语料至少要覆盖 20 句真实口语');
  const allowed = new Set(['self-occurred', 'negated', 'family', 'no-record', 'conversational', 'mixed']);
  for (const item of corpus) {
    assert.ok(allowed.has(item.category), `未知 category：${item.category}（${item.text}）`);
  }
});

test('性质一：无静默丢弃——每句话都有主气泡回应', async () => {
  for (const item of corpus) {
    const plan = await planOf(item.text);
    const main = plan.replyBlocks.find((block) => block.kind === 'main');
    assert.ok(main, `「${item.text}」必须有主气泡`);
    assert.ok(main.text.trim().length > 0, `「${item.text}」的主气泡不能为空`);
    assert.ok(plan.toast.trim().length > 0, `「${item.text}」必须有用户可见的提示`);
  }
});

test('性质二：不得凭空捏造——事件只能来自已接受的 claim', async () => {
  for (const item of corpus) {
    const plan = await planOf(item.text);
    const understanding = understandElderInput(item.text, TODAY, []);
    const claimTags = new Set(understanding.claims.flatMap((claim) => claim.tags));
    for (const event of plan.eventsToAppend) {
      if (event.type !== 'observation') continue;
      const tags = event.observation.tags ?? [];
      assert.ok(
        tags.length === 0 || tags.every((tag) => claimTags.has(tag)),
        `「${item.text}」的事件标签 ${tags.join(',')} 必须来自原话 claim，不得凭空发明`,
      );
    }
  }
});

test('性质二（续）：否定/痊愈表达一条事件都不许捏造', async () => {
  for (const item of corpus.filter((entry) => entry.category === 'negated')) {
    const plan = await planOf(item.text);
    assert.equal(plan.eventsToAppend.length, 0, `「${item.text}」是否定/痊愈表达，不得生成任何健康事件`);
    assert.equal(
      acceptedSelfClaims(understandElderInput(item.text, TODAY, [])).length,
      0,
      `「${item.text}」不得被记为已发生的本人事实`,
    );
  }
});

test('性质三：家属消息永不写进本人档案', async () => {
  for (const item of corpus.filter((entry) => entry.category === 'family')) {
    const plan = await planOf(item.text);
    assert.equal(plan.eventsToAppend.length, 0, `「${item.text}」是家属消息，不得进入本人健康事件`);
    assert.ok(plan.familyEventsToAppend.length >= 1, `「${item.text}」必须生成家属事实`);
    if (item.subject) {
      assert.equal(plan.familyEventsToAppend[0]?.subject, item.subject, `「${item.text}」归属错误`);
    }
  }
});

test('性质四：no_record 一个字节的事件都不落', async () => {
  for (const item of corpus.filter((entry) => entry.category === 'no-record')) {
    const plan = await planOf(item.text);
    assert.equal(plan.recordIntent, 'no_record', `「${item.text}」必须走 no_record`);
    assert.equal(plan.eventsToAppend.length, 0, `「${item.text}」不得产生健康事件`);
    assert.equal(plan.familyEventsToAppend.length, 0, `「${item.text}」不得产生家属事实`);
    assert.equal(plan.sharingAuditEntries.length, 0, `「${item.text}」不得产生共享台账`);
    const privacy = plan.replyBlocks.find((block) => block.kind === 'privacy');
    assert.ok(privacy, `「${item.text}」的回复必须包含独立隐私行`);
  }
});

test('性质五：真实症状必须入库（防漏记方向）', async () => {
  for (const item of corpus.filter((entry) => entry.category === 'self-occurred')) {
    const plan = await planOf(item.text);
    assert.ok(plan.eventsToAppend.length >= 1, `「${item.text}」是真实症状，必须至少产生一条事件`);
  }
});

test('性质六：寒暄/报平安不得生成事件', async () => {
  for (const item of corpus.filter((entry) => entry.category === 'conversational')) {
    const plan = await planOf(item.text);
    assert.equal(plan.eventsToAppend.length, 0, `「${item.text}」是寒暄，不得生成健康事件`);
  }
});

test('性质七：混合句式——该记的记、该否的否', async () => {
  for (const item of corpus.filter((entry) => entry.category === 'mixed')) {
    const plan = await planOf(item.text);
    const expect = item.expect ?? {};
    if (expect.forbiddenTags) {
      for (const event of plan.eventsToAppend) {
        if (event.type !== 'observation') continue;
        const tags = event.observation.tags ?? [];
        const forbiddenHit = tags.filter((tag) => expect.forbiddenTags?.includes(tag));
        assert.equal(forbiddenHit.length, 0, `「${item.text}」中被否定的 ${forbiddenHit.join(',')} 不得被记成已发生`);
      }
    }
    if (typeof expect.minEvents === 'number') {
      assert.ok(
        plan.eventsToAppend.length >= expect.minEvents,
        `「${item.text}」中的真实症状必须留痕（期望 ≥${expect.minEvents} 条事件）`,
      );
    }
    if (typeof expect.minFamilyEvents === 'number') {
      assert.ok(
        plan.familyEventsToAppend.length >= expect.minFamilyEvents,
        `「${item.text}」中的家属部分必须进入家属事实`,
      );
      if (item.subject) {
        assert.equal(plan.familyEventsToAppend[0]?.subject, item.subject, `「${item.text}」家属归属错误`);
      }
    }
  }
});
