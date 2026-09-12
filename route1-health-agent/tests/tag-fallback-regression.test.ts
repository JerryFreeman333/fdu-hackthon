/**
 * 兜底（纯规则）模式的标签识别回归。
 *
 * 理解层 LLM 仲裁（llm-understanding.test.ts）是主修复；这里锁定规则下限
 * 在未配置 LLM / private / no_record 场景下的行为——被审查点名的句子
 * 不允许再整句静默消失，同时禁止为补覆盖而引入新的误识别。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedSelfClaims, understandElderInput } from '../src/engine/understanding';

const TODAY = '2026-09-12';

test('兜底规则："头一点都不晕了"留下否定痕迹而不误记录', () => {
  // 旧窗口 {0,2} 覆盖不了"头"与"晕"之间的"一点都不"，整句曾无 claim、零反馈。
  const input = understandElderInput('头一点都不晕了', TODAY);
  assert.equal(input.claims.length, 1, '否定事实必须留下 claim 痕迹');
  assert.deepEqual(input.claims[0]?.tags, ['dizziness']);
  assert.equal(input.claims[0]?.status, 'negated');
  assert.equal(acceptedSelfClaims(input).length, 0, '被否认的症状不得进入事实流');
});

test('兜底规则："不晕，但是有点累"的否定半句不再凭空消失', () => {
  const input = understandElderInput('不晕，但是有点累', TODAY);
  const dizziness = input.claims.find((claim) => claim.tags.includes('dizziness'));
  assert.ok(dizziness, '"不晕"这半句的头晕否定必须被保留');
  assert.equal(dizziness?.status, 'negated');
  const accepted = acceptedSelfClaims(input);
  assert.equal(accepted.length, 1);
  assert.ok(accepted[0]?.tags.includes('fatigue'));
});

test('兜底规则："摔是没摔，就是腿软了一下"两个事实都识别', () => {
  const input = understandElderInput('摔是没摔，就是腿软了一下', TODAY);
  const fall = input.claims.find((claim) => claim.tags.includes('fall'));
  assert.ok(fall, '让步句式"摔是没摔"必须识别出 fall');
  assert.equal(fall?.status, 'negated', '"摔是没摔"按否定记录，不得触发摔倒安全流程');
  const fatigue = input.claims.find((claim) => claim.tags.includes('fatigue'));
  assert.ok(fatigue, '"腿软了一下"是真实身体状况，必须识别');
  assert.equal(fatigue?.status, 'occurred');
  assert.deepEqual(
    acceptedSelfClaims(input).map((claim) => claim.tags),
    [['fatigue']],
  );
});

test('兜底规则防误报：晕车类说法不得被记成头晕发生', () => {
  // 为"不晕/没晕"补窄模式时，正面裸"晕"刻意不收——晕车/晕船是误报面。
  assert.equal(acceptedSelfClaims(understandElderInput('我坐车有点晕车', TODAY)).length, 0);
  assert.equal(acceptedSelfClaims(understandElderInput('我一坐船就晕船', TODAY)).length, 0);
});

test('兜底规则防误报：既有正例不受窗口放宽影响', () => {
  const input = understandElderInput('我今天头晕', TODAY);
  assert.equal(acceptedSelfClaims(input).length, 1);
  assert.ok(acceptedSelfClaims(input)[0]?.tags.includes('dizziness'));
});
