/**
 * P2 回归：混合意图不得丢输入。
 * "这个不要告诉孩子，我最近胸口有点闷" = 隐私请求 + 真实症状。
 * 修复前：胸口发闷不产生任何标签 → claim 无处可去 → 只得到解释文，主诉蒸发；
 * 修复后：症状按 dyspnea 识别并以 private 记录，隐私请求得到显式独立回应。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseElderInput } from '../src/engine/agent';
import { parsePrivacyIntent } from '../src/engine/privacy';
import { understandElderInput } from '../src/engine/understanding';
import { planElderTurn, type ElderTurnRequest } from '../src/engine/elderTurn';
import { ruleBasedAdapter } from '../src/engine/agent';
import type { Finding } from '../src/types';

const TODAY = '2026-09-12';

void test('规则层必须识别"胸口有点闷"为 dyspnea', () => {
  const parsed = parseElderInput('这个不要告诉孩子，我最近胸口有点闷');
  assert.ok(parsed.tags.includes('dyspnea'), `应识别出 dyspnea，实际：${parsed.tags.join('、')}`);
});

void test('混合意图的理解结果：症状归老人本人、状态为 occurred', () => {
  const intent = parsePrivacyIntent('这个不要告诉孩子，我最近胸口有点闷');
  assert.equal(intent, 'private');
  const understanding = understandElderInput('这个不要告诉孩子，我最近胸口有点闷', TODAY, []);
  const selfClaim = understanding.claims.find((claim) => claim.subject === 'self');
  assert.ok(selfClaim, '必须产生本人 claim');
  assert.ok(selfClaim.tags.includes('dyspnea'));
  assert.equal(selfClaim.status, 'occurred');
  assert.equal(selfClaim.eventDate, TODAY);
});

void test('【P2】混合意图整回合：症状以 private 入库，隐私请求得到显式回应', async () => {
  const text = '这个不要告诉孩子，我最近胸口有点闷';
  const understanding = understandElderInput(text, TODAY, []);
  const request: ElderTurnRequest = {
    text,
    understanding,
    priorChat: [],
    findings: [] as Finding[],
    events: [],
    familySharing: 'denied',
    agentContext: undefined,
    llmAdapter: ruleBasedAdapter,
    today: TODAY,
    now: '09-12 08:30',
    receivedAt: '2026-09-12T08:30:00.000',
    sourceMessageId: 'elder-test-mixed',
    idSeed: 1757600000000,
  };
  const plan = await planElderTurn(request);
  assert.equal(plan.recordIntent, 'record');
  assert.ok(plan.eventsToAppend.length >= 1, '症状必须入库，不许蒸发');
  const observation = plan.eventsToAppend.find((event) => event.type === 'observation');
  assert.ok(observation && observation.type === 'observation', '症状必须以 observation 事件入库');
  assert.equal(observation.observation.visibility, 'private');
  assert.ok(observation.observation.tags.includes('dyspnea'));

  const privacyBlock = plan.replyBlocks.find((block) => block.kind === 'privacy');
  assert.ok(privacyBlock, '隐私声明必须独立成行');
  assert.match(privacyBlock.text, /不会告诉家属/);
});

void test('【P2】症状没被识别时，隐私请求也要得到独立成行的回应', async () => {
  // 构造一个识别不出症状、但明确要求隐私的输入
  const text = '这个不要告诉孩子，我最近有点怕冷';
  const understanding = understandElderInput(text, TODAY, []);
  const plan = await planElderTurn({
    text,
    understanding,
    priorChat: [],
    findings: [] as Finding[],
    events: [],
    familySharing: 'denied',
    agentContext: undefined,
    llmAdapter: ruleBasedAdapter,
    today: TODAY,
    now: '09-12 08:30',
    receivedAt: '2026-09-12T08:30:00.000',
    sourceMessageId: 'elder-test-mixed-2',
    idSeed: 1757600000001,
  });
  const privacyBlock = plan.replyBlocks.find((block) => block.kind === 'privacy');
  assert.ok(privacyBlock, '隐私请求必须有独立回应');
  assert.match(privacyBlock.text, /不会告诉家属/);
});
