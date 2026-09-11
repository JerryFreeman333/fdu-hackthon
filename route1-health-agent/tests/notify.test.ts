import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Finding } from '../src/types';
import {
  acknowledgeNotification,
  countUnacknowledged,
  describeDeliveries,
  dispatchFamilyNotifications,
  type DeliveryOutcome,
  type FamilyNotificationRecord,
} from '../src/engine/notify';

function finding(overrides: Partial<Finding> & Pick<Finding, 'id' | 'severity'>): Finding {
  return {
    date: '2026-09-06',
    title: '测试发现',
    detail: '测试详情',
    evidence: ['证据一'],
    // 测试默认构造可共享的 finding。collectFamilyNotifications 要求
    // familyEligible 显式为 true 才能进通知队列；不默认会全部被漏掉。
    // 显式拒绝共享的测试自己传 familyEligible: false。
    familyEligible: true,
    ...overrides,
  };
}

const NOW = '2026-09-06T08:30:00.000Z';

function sentPush(): DeliveryOutcome[] {
  return [{ channel: 'browser_push', status: 'sent', detail: '已推送到系统通知中心' }];
}

function deliverSpy(outcomes: () => DeliveryOutcome[] = sentPush) {
  const state = { calls: 0 };
  return {
    state,
    deliver: () => {
      state.calls += 1;
      return Promise.resolve(outcomes());
    },
  };
}

void test('未授权共享或未绑定家属时，绝不派发任何通知', async () => {
  const findings = [finding({ id: 'safety.fall-2026-09-06', severity: 'urgent', familyMessage: '【紧急】测试' })];
  const { state, deliver } = deliverSpy();

  for (const sharing of ['ask', 'denied'] as const) {
    const result = await dispatchFamilyNotifications(findings, sharing, true, [], NOW, deliver);
    assert.equal(result.dispatchedCount, 0);
    assert.deepEqual(result.records, []);
  }

  const unbound = await dispatchFamilyNotifications(findings, 'granted', false, [], NOW, deliver);
  assert.equal(unbound.dispatchedCount, 0);
  assert.equal(state.calls, 0);
});

void test('派发时按紧急优先排序，并逐渠道记录投递结果', async () => {
  const findings = [
    finding({
      id: 'fusion.multisignal_deterioration-2026-09-06',
      severity: 'alert',
      familyMessage: '【建议关注】测试',
    }),
    finding({
      id: 'safety.fall-2026-09-06',
      severity: 'urgent',
      familyMessage: '【紧急】测试',
      carePath: '立即联系老人',
    }),
  ];
  const { deliver } = deliverSpy();

  const result = await dispatchFamilyNotifications(findings, 'granted', true, [], NOW, deliver);

  assert.equal(result.dispatchedCount, 2);
  assert.equal(result.records[0].findingId, 'safety.fall-2026-09-06');
  assert.equal(result.records[0].lifecycle, 'new');
  assert.equal(result.records[0].deliveries[0].channel, 'in_app');
  assert.equal(result.records[0].deliveries[0].status, 'sent');
  assert.equal(result.records[0].deliveries[1].channel, 'browser_push');
  assert.equal(result.records[0].deliveries[1].status, 'sent');
  assert.equal(result.records[0].actionPath, '立即联系老人');
});

void test('同一条发现只派发一次，重复运行不再打扰家属', async () => {
  const findings = [finding({ id: 'safety.fall-2026-09-06', severity: 'urgent', familyMessage: '【紧急】测试' })];
  const { state, deliver } = deliverSpy();

  const first = await dispatchFamilyNotifications(findings, 'granted', true, [], NOW, deliver);
  assert.equal(first.dispatchedCount, 1);

  const second = await dispatchFamilyNotifications(findings, 'granted', true, first.records, NOW, deliver);
  assert.equal(second.dispatchedCount, 0);
  assert.equal(state.calls, 1);
  assert.deepEqual(second.records, first.records);
});

void test('私密发现（familyEligible=false 或无 familyMessage）不进入家属通知', async () => {
  const findings = [
    finding({ id: 'safety.fall-2026-09-06', severity: 'urgent', familyMessage: undefined }),
    finding({ id: 'safety.fall-2026-09-05', severity: 'urgent', familyMessage: '【紧急】测试', familyEligible: false }),
  ];
  const { state, deliver } = deliverSpy();

  const result = await dispatchFamilyNotifications(findings, 'granted', true, [], NOW, deliver);

  assert.equal(result.dispatchedCount, 0);
  assert.equal(state.calls, 0);
});

void test('渠道抛错时台账如实记为 failed，不假装送达', async () => {
  const findings = [finding({ id: 'safety.fall-2026-09-06', severity: 'urgent', familyMessage: '【紧急】测试' })];
  const deliver = () => {
    throw new Error('系统通知发送失败');
  };

  const result = await dispatchFamilyNotifications(findings, 'granted', true, [], NOW, deliver);

  assert.equal(result.dispatchedCount, 1);
  const push = result.records[0].deliveries.find((item) => item.channel === 'browser_push');
  assert.equal(push?.status, 'failed');
  assert.match(describeDeliveries(result.records[0]), /系统通知未送达（系统通知发送失败）/);
});

void test('家属确认形成闭环，重复确认保留最早时间', async () => {
  const findings = [finding({ id: 'safety.fall-2026-09-06', severity: 'urgent', familyMessage: '【紧急】测试' })];
  const { deliver } = deliverSpy();
  const { records } = await dispatchFamilyNotifications(findings, 'granted', true, [], NOW, deliver);
  assert.equal(countUnacknowledged(records), 1);

  const first = acknowledgeNotification(records, 'safety.fall-2026-09-06', '2026-09-06T09:00:00.000Z');
  assert.equal(first[0].lifecycle, 'acknowledged');
  assert.equal(first[0].acknowledgedAt, '2026-09-06T09:00:00.000Z');

  const again = acknowledgeNotification(first, 'safety.fall-2026-09-06', '2026-09-06T10:00:00.000Z');
  assert.equal(again[0].acknowledgedAt, '2026-09-06T09:00:00.000Z');
  assert.equal(countUnacknowledged(again), 0);
});

void test('送达描述同时覆盖已送达与未送达两种渠道状态', async () => {
  const record = (deliveries: FamilyNotificationRecord['deliveries']): FamilyNotificationRecord => ({
    findingId: 'safety.fall-2026-09-06',
    severity: 'urgent',
    title: '发生跌倒，需要立即确认情况',
    message: '【紧急】测试',
    reason: '出现需要立即确认的安全信号。',
    createdAt: NOW,
    deliveries,
    lifecycle: 'new',
  });

  assert.equal(
    describeDeliveries(
      record([
        { channel: 'in_app', status: 'sent', detail: '已进入家属端通知中心', at: NOW },
        { channel: 'browser_push', status: 'sent', detail: '已推送到系统通知中心', at: NOW },
      ]),
    ),
    '通知中心已送达；系统通知已送达',
  );
  assert.equal(
    describeDeliveries(
      record([
        { channel: 'in_app', status: 'sent', detail: '已进入家属端通知中心', at: NOW },
        {
          channel: 'browser_push',
          status: 'unavailable',
          detail: '尚未开启系统通知权限，请在家属端点击开启',
          at: NOW,
        },
      ]),
    ),
    '通知中心已送达；系统通知未送达（尚未开启系统通知权限，请在家属端点击开启）',
  );
});
