import test from 'node:test';
import assert from 'node:assert/strict';
import type { Finding } from '../src/types';
import type { FamilyNotificationRecord } from '../src/engine/notify';
import { dispatchSignature } from '../src/engine/dispatchSignature';
import { isRecordFromToday, ledgerRecordToNotification, mergeNotificationRecord } from '../src/engine/notify';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'family-safety:family-yesterday',
    date: '2026-11-15',
    severity: 'urgent',
    title: '老人转述：其父亲出现跌倒，需要立即确认',
    detail: '请立即联系确认是否受伤。',
    evidence: [],
    familyMessage: '【紧急】2026-11-14：老人转述其父亲跌倒。',
    carePath: '联系老人确认',
    ruleId: 'family.safety',
    familyEligible: true,
    ...overrides,
  };
}

function record(overrides: Partial<FamilyNotificationRecord> = {}): FamilyNotificationRecord {
  return {
    findingId: 'family-safety:family-yesterday',
    severity: 'urgent',
    title: '老人转述：其父亲出现跌倒，需要立即确认',
    message: '【紧急】2026-11-14：老人转述其父亲跌倒。',
    reason: '出现需要立即确认的安全信号。',
    createdAt: '2026-11-14T10:00:00.000',
    lifecycle: 'new',
    deliveries: [{ channel: 'in_app', status: 'sent', detail: '', at: '2026-11-14T10:00:00.000' }],
    ...overrides,
  };
}

test('派发签名包含提醒日期：家人安全事件跨午夜必须触发一次重新派发', () => {
  const beforeMidnight = dispatchSignature([finding()], []);
  const afterMidnight = dispatchSignature([finding({ date: '2026-11-16' })], []);
  assert.notEqual(beforeMidnight, afterMidnight);
});

test('派发签名仍能感知严重度、正文与一次性共享清单变化', () => {
  assert.notEqual(
    dispatchSignature([finding({ severity: 'alert' })], []),
    dispatchSignature([finding({ severity: 'urgent' })], []),
  );
  assert.notEqual(dispatchSignature([finding()], []), dispatchSignature([finding()], ['family-safety:other']));
});

test('台账的“今天”以最近一次更新为准，隔天重申的记录不能被过滤掉', () => {
  const repeated = record({ updatedAt: '2026-11-16T09:00:00.000' });
  assert.equal(isRecordFromToday(repeated, '2026-11-16'), true);
  assert.equal(isRecordFromToday(repeated, '2026-11-15'), false);
  assert.equal(ledgerRecordToNotification(repeated).finding.date, '2026-11-16');
});

test('没有 updatedAt 的旧台账继续按 createdAt 判断', () => {
  const legacy = record();
  assert.equal(isRecordFromToday(legacy, '2026-11-14'), true);
  assert.equal(ledgerRecordToNotification(legacy).finding.date, '2026-11-14');
});

test('重推途中收到家属确认，异步派发结果不能把它恢复成未确认', () => {
  const confirmed = record({ lifecycle: 'acknowledged', acknowledgedAt: '2026-11-16T09:00:01' });
  const repeated = record({ updatedAt: '2026-11-16T09:00:00' });
  const merged = mergeNotificationRecord([confirmed], repeated);
  assert.equal(merged[0]?.lifecycle, 'acknowledged');
  assert.equal(merged[0]?.acknowledgedAt, confirmed.acknowledgedAt);
});

test('家属的送达回执不会被同版本旧副本覆盖，也不会跨天冒充今日送达', () => {
  const delivered = record({
    deliveries: [{ channel: 'browser_push', status: 'sent', detail: '家属端', at: '2026-11-14T10:01:00' }],
  });
  const pending = record({
    deliveries: [{ channel: 'browser_push', status: 'unavailable', detail: '待家属端接收', at: '2026-11-14T10:00:00' }],
  });
  assert.equal(mergeNotificationRecord([delivered], pending)[0]?.deliveries[0]?.status, 'sent');
  const repeated = { ...pending, updatedAt: '2026-11-15T09:00:00' };
  assert.equal(mergeNotificationRecord([delivered], repeated)[0]?.deliveries[0]?.status, 'unavailable');
});

test('内容确实升级时重新待确认，同一回执重复接收保持幂等', () => {
  const confirmed = record({ lifecycle: 'acknowledged', acknowledgedAt: '2026-11-14T11:00:00' });
  const upgraded = record({ updatedAt: '2026-11-14T12:00:00', message: '新增持续胸痛' });
  const merged = mergeNotificationRecord([confirmed], upgraded);
  assert.equal(merged[0]?.lifecycle, 'new');
  assert.equal(mergeNotificationRecord(merged, upgraded), merged);
});
