/**
 * P0-1 回归：老人从未授权共享就报急事（如摔倒）时，
 * private 的 urgent 发现绝不能从家属端的"真相视图"里蒸发。
 *
 * 根因链（修复前）：
 *   elderTurn: canShare=false → 事件 visibility='private'
 *   safety.fall: shareable=false → familyMessage=undefined, familyEligible=false
 *   collectGatedFindings（旧）: 要求 familyMessage 存在 → 不计入"被挡住"
 *   dashboardStatus: 三个未知分支全部落空 → 掉进绿色 ok 分支"今天总体正常"
 *
 * 修复后：collectGatedFindings 必须把"内容私密的紧急发现"也计入被挡住
 * （只暴露数量，不暴露内容），familyStatus 绝不给绿色 ok。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDetection } from '../src/engine/detect';
import { collectFamilyNotifications, collectGatedFindings } from '../src/engine/escalate';
import { familyStatus } from '../src/engine/dashboardStatus';
import { observationToEvent, type HealthEvent } from '../src/pipeline/events';

const TODAY = '2026-09-12';

function privateFallEvents(): HealthEvent[] {
  return [
    observationToEvent({
      id: 'obs-fall-1',
      date: TODAY,
      source: 'chat',
      text: '我刚才在厕所摔了一跤，现在站起来有点晕',
      tags: ['fall', 'dizziness'],
      status: 'occurred',
      visibility: 'private',
    }),
  ];
}

void test('未授权共享时摔倒报告生成 private urgent 发现（无 familyMessage）', () => {
  const findings = runDetection(privateFallEvents(), TODAY);
  const fall = findings.find((finding) => finding.ruleId === 'safety.fall');
  assert.ok(fall, '摔倒必须生成发现');
  assert.equal(fall.severity, 'urgent');
  assert.equal(fall.familyEligible, false);
  assert.equal(fall.familyMessage, undefined);
  assert.ok(
    fall.evidence.some((line) => line.includes('未共享')),
    '证据必须如实标注内容未共享',
  );
});

void test('【P0-1】private 的 urgent 发现计入"被挡住"，不再从真相视图蒸发', () => {
  const findings = runDetection(privateFallEvents(), TODAY);
  const gated = collectGatedFindings(findings, 'denied', [], TODAY);
  assert.equal(gated.length, 1, 'denied 时 private urgent 必须被计为被挡住');
  // 已授权（granted）也一样：内容是 private 的，家属照样看不到，照样算被挡住
  assert.equal(collectGatedFindings(findings, 'granted', [], TODAY).length, 1);
  assert.equal(collectFamilyNotifications(findings, 'denied', [], TODAY).length, 0);
});

void test('【P0-1】家属首页状态：有信号 + private urgent → unknown"被隐私挡住"，绝不是"总体正常"', () => {
  const findings = runDetection(privateFallEvents(), TODAY);
  const gatedAlertCount = collectGatedFindings(findings, 'denied', [], TODAY).length;
  const status = familyStatus(
    collectFamilyNotifications(findings, 'denied', [], TODAY),
    [],
    3, // 老人今天说过话：3 条信号
    gatedAlertCount,
  );
  assert.equal(status.tone, 'unknown');
  assert.doesNotMatch(status.title, /今天总体正常/);
  assert.doesNotMatch(status.detail, /暂无需要您介入的变化/);
  assert.match(status.title, /隐私设置挡住/);
  assert.match(status.detail, /直接联系老人/);
});

void test('【P0-1】类型 B 不该误伤：无门控内容的 watch/info 发现不算被挡住', () => {
  // watch 级别的发现不进 FAMILY_LEVELS，无论 visibility 都不触发"被挡住"
  const events: HealthEvent[] = [
    observationToEvent({
      id: 'obs-tired-1',
      date: TODAY,
      source: 'chat',
      text: '最近腿有点没劲',
      tags: ['fatigue'],
      status: 'occurred',
      visibility: 'private',
    }),
  ];
  const findings = runDetection(events, TODAY);
  const gated = collectGatedFindings(findings, 'denied', [], TODAY);
  assert.equal(gated.length, 0, 'watch 级发现不算被挡住的紧急信号');
});

void test('【P0-1】非今日的 private 紧急发现不重复计入', () => {
  const events: HealthEvent[] = [
    observationToEvent({
      id: 'obs-fall-old',
      date: '2026-09-10',
      source: 'chat',
      text: '前天摔了一跤',
      tags: ['fall'],
      status: 'occurred',
      visibility: 'private',
    }),
  ];
  const findings = runDetection(events, TODAY);
  assert.equal(collectGatedFindings(findings, 'denied', [], TODAY).length, 0);
});
