import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FamilyNotification } from '../src/engine/escalate';
import { collectGatedFindings } from '../src/engine/escalate';
import type { FamilyNotificationRecord } from '../src/engine/notify';
import { familyStatus } from '../src/engine/dashboardStatus';

const NOW = '2026-09-09T08:30:00.000Z';

function finding(severity: 'urgent' | 'alert' | 'watch' | 'info', id = `f-${severity}-${NOW}`) {
  return {
    id,
    date: '2026-09-09',
    severity,
    title: `${severity} finding`,
    detail: '...',
    evidence: ['e'],
    familyMessage: '请关注',
  };
}

function notification(severity: 'urgent' | 'alert' | 'watch' | 'info'): FamilyNotification {
  const f = finding(severity);
  return {
    finding: f,
    message: f.familyMessage as string,
    reason: severity === 'urgent' ? '出现需要立即确认的安全信号。' : '多项变化叠加',
    oneTime: false,
  };
}

function record(
  findingId: string,
  severity: 'urgent' | 'alert',
  pushStatus: 'sent' | 'failed' | 'unavailable',
  pushDetail: string,
  lifecycle: 'new' | 'acknowledged' = 'new',
): FamilyNotificationRecord {
  return {
    findingId,
    severity,
    title: '提醒',
    message: '请关注',
    reason: '...',
    createdAt: NOW,
    deliveries: [
      { channel: 'in_app', status: 'sent', detail: '已进入家属端通知中心', at: NOW },
      { channel: 'browser_push', status: pushStatus, detail: pushDetail, at: NOW },
    ],
    lifecycle,
  };
}

void test('urgent 通知 → danger，永远压制 unknown', () => {
  const status = familyStatus(
    [notification('urgent'), notification('alert')],
    [record('f-failed', 'urgent', 'failed', '发送失败')],
    10,
  );
  assert.equal(status.tone, 'danger');
  assert.match(status.title, /立即介入/);
});

void test('仅 alert 通知 → warn', () => {
  const status = familyStatus([notification('alert')], [], 5);
  assert.equal(status.tone, 'warn');
});

void test('没有任何通知、也没有任何派发台账，今日有信号 → ok，可以安心', () => {
  const status = familyStatus([], [], 4);
  assert.equal(status.tone, 'ok');
  assert.match(status.title, /今天总体正常/);
  assert.match(status.detail, /今日已收到 4 条健康信号/);
});

void test('无通知但有未确认的系统通知失败 → unknown，绝不显示总体正常', () => {
  const status = familyStatus([], [record('safety.fall-2026-09-09', 'urgent', 'failed', '系统通知发送失败')], 3);
  assert.equal(status.tone, 'unknown');
  assert.doesNotMatch(status.title, /今天总体正常/);
  assert.match(status.title, /未全部送达/);
  assert.match(status.detail, /发送失败/);
});

void test('无通知但有未确认的系统通知未开启 → unknown', () => {
  const status = familyStatus(
    [],
    [record('safety.fall-2026-09-09', 'urgent', 'unavailable', '尚未开启系统通知权限')],
    3,
  );
  assert.equal(status.tone, 'unknown');
  assert.match(status.detail, /未开启/);
});

void test('无通知、派发台账里全部已确认，今日有信号 → ok', () => {
  const status = familyStatus([], [record('safety.fall-2026-09-09', 'urgent', 'failed', '失败', 'acknowledged')], 2);
  // 已确认的记录不再让首页处于 unknown；家属已经看到并处理了。
  assert.equal(status.tone, 'ok');
});

void test('无通知、in_app 失败但 push 已送达 → 不算 unknown', () => {
  const status = familyStatus(
    [],
    [
      {
        findingId: 'f1',
        severity: 'urgent',
        title: '...',
        message: '...',
        reason: '...',
        createdAt: NOW,
        deliveries: [
          { channel: 'in_app', status: 'failed', detail: 'in_app 失败', at: NOW },
          { channel: 'browser_push', status: 'sent', detail: '已送达', at: NOW },
        ],
        lifecycle: 'new',
      },
    ],
    2,
  );
  // push 已送达就足以让家属知道，in_app 失败不构成 unknown。
  assert.equal(status.tone, 'ok');
});

void test('混合：1 条失败 + 1 条未开启 → detail 里分项计数', () => {
  const status = familyStatus(
    [],
    [
      record('f1', 'urgent', 'failed', '系统通知发送失败'),
      record('f2', 'urgent', 'unavailable', '尚未开启系统通知权限'),
    ],
    1,
  );
  assert.equal(status.tone, 'unknown');
  assert.match(status.detail, /1 条系统通知发送失败/);
  assert.match(status.detail, /1 条系统通知未开启/);
});

void test('【断点 3 修复】无通知、无派发失败、今日零信号 → unknown，绝不显示总体正常', () => {
  const status = familyStatus([], [], 0);
  assert.equal(status.tone, 'unknown');
  assert.doesNotMatch(status.title, /今天总体正常/);
  assert.match(status.title, /今天还没有任何健康信号/);
  assert.match(status.detail, /暂无数据可以判断/);
  assert.match(status.detail, /建议主动联系老人/);
});

void test('【断点 3 修复】零信号即使配 all-sent 的派发台账，仍标 unknown（沉默优先于派发成功）', () => {
  const status = familyStatus([], [record('f-sent', 'urgent', 'sent', '已送达', 'acknowledged')], 0);
  // 沉默是更强的信号：派发成功并不能抹掉"今天没说话"的事实。
  assert.equal(status.tone, 'unknown');
});

void test('【断点 3 修复】今日只有 1 条信号也允许 ok，但 detail 必须如实说明数量', () => {
  const status = familyStatus([], [], 1);
  assert.equal(status.tone, 'ok');
  assert.match(status.detail, /今日已收到 1 条健康信号/);
});

void test('【断点 3 修复】今日大量信号 + 无通知 → ok 且 detail 提示数量', () => {
  const status = familyStatus([], [], 17);
  assert.equal(status.tone, 'ok');
  assert.match(status.detail, /今日已收到 17 条健康信号/);
});

// ===== 评审 P0-2：第三种未知 —— 有数据但被隐私门控挡住 =====

void test('【评审现场时序】有信号但被隐私门控挡住 → unknown，绝不显示总体正常', () => {
  // 现场时序：老人 02:42 报胸痛（alert/urgent 被门控挡住），家属 02:44 打开首页，
  // 看到的是"今天总体正常——今日已收到 24 条健康信号"。
  const status = familyStatus([], [], 24, 1);
  assert.equal(status.tone, 'unknown');
  assert.doesNotMatch(status.title, /今天总体正常/);
  assert.match(status.title, /隐私设置挡住/);
  assert.match(status.detail, /24 条健康信号/);
  assert.match(status.detail, /1 条被系统标记为需要关注/);
  assert.match(status.detail, /直接联系老人/);
});

void test('多条被挡住的信号在标题中复数呈现', () => {
  const status = familyStatus([], [], 10, 3);
  assert.match(status.title, /3 件事被隐私设置挡住/);
  assert.match(status.detail, /3 条被系统标记为需要关注/);
});

void test('gated 优先于派发失败：被挡住的信号比送达状态更需要家属知道', () => {
  const status = familyStatus([], [record('f1', 'urgent', 'failed', '系统通知发送失败')], 5, 2);
  assert.equal(status.tone, 'unknown');
  assert.match(status.title, /隐私设置挡住/);
});

void test('可见 alert 通知存在时仍走 warn，gated 数量不改变其分级', () => {
  const status = familyStatus([notification('alert')], [], 6, 1);
  assert.equal(status.tone, 'warn');
});

void test('gated=0 保持既有行为：有信号、无通知、无失败 → ok', () => {
  const status = familyStatus([], [], 24, 0);
  assert.equal(status.tone, 'ok');
});

void test('collectGatedFindings：未授权时返回今日 alert/urgent，授权后为空', () => {
  const findings = [finding('urgent', 'f-urgent'), finding('alert', 'f-alert'), finding('watch', 'f-watch')];
  assert.deepEqual(
    collectGatedFindings(findings, 'ask', [], '2026-09-09')
      .map((item) => item.id)
      .sort(),
    ['f-alert', 'f-urgent'],
  );
  assert.equal(collectGatedFindings(findings, 'granted', [], '2026-09-09').length, 0);
  // 一次性共享过的 finding 不再属于"被挡住"
  assert.equal(collectGatedFindings(findings, 'ask', ['f-urgent'], '2026-09-09').length, 1);
  // 非今日的 finding 不计入（与 collectFamilyNotifications 的今日门控一致）
  assert.equal(collectGatedFindings(findings, 'denied', [], '2026-09-01').length, 0);
});
