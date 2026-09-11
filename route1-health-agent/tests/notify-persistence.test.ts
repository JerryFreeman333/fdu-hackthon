import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPATCH_STORAGE_KEY,
  clearDispatchRecords,
  loadDispatchRecords,
  saveDispatchRecords,
} from '../src/engine/notifyPersistence';
import type { FamilyNotificationRecord } from '../src/engine/notify';

/** 构造一个干净可控的 localStorage stub，未挂到 window 上所以不会污染其它测试 */
function makeStorageStub() {
  const map = new Map<string, string>();
  let available = true;
  const stub = {
    getItem: (key: string) => (available ? (map.get(key) ?? null) : null),
    setItem: (key: string, value: string) => {
      if (!available) throw new Error('QuotaExceeded');
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    /** 仅测试用：模拟 localStorage 不可用（隐私模式 / SSR） */
    disable() {
      available = false;
    },
  };
  return stub;
}

function makeRecord(overrides: Partial<FamilyNotificationRecord> = {}): FamilyNotificationRecord {
  return {
    findingId: 'safety.fall-2026-09-09',
    severity: 'urgent',
    title: '发生跌倒',
    message: '【紧急】请立即确认',
    reason: '出现需要立即确认的安全信号。',
    createdAt: '2026-09-09T08:30:00.000Z',
    deliveries: [
      { channel: 'in_app', status: 'sent', detail: '已进入家属端通知中心', at: '2026-09-09T08:30:00.000Z' },
      { channel: 'browser_push', status: 'failed', detail: '系统通知发送失败', at: '2026-09-09T08:30:00.000Z' },
    ],
    lifecycle: 'new',
    ...overrides,
  };
}

void test('空存储读出 []', () => {
  const stub = makeStorageStub();
  // @ts-expect-error 测试用 stub
  globalThis.window = { localStorage: stub };
  assert.deepEqual(loadDispatchRecords(), []);
});

void test('保存后再读能拿到同一份记录（跨刷新闭环）', () => {
  const stub = makeStorageStub();
  // @ts-expect-error 测试用 stub
  globalThis.window = { localStorage: stub };
  const record = makeRecord();
  saveDispatchRecords([record]);
  assert.equal(stub.getItem(DISPATCH_STORAGE_KEY), JSON.stringify([record]));
  const reloaded = loadDispatchRecords();
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].findingId, 'safety.fall-2026-09-09');
  assert.equal(reloaded[0].lifecycle, 'new');
  assert.equal(reloaded[0].deliveries[1].status, 'failed');
});

void test('多项记录能完整往返', () => {
  const stub = makeStorageStub();
  // @ts-expect-error 测试用 stub
  globalThis.window = { localStorage: stub };
  const records = [
    makeRecord({ findingId: 'f-1', severity: 'urgent' }),
    makeRecord({ findingId: 'f-2', severity: 'alert', title: '血氧偏低' }),
    makeRecord({
      findingId: 'f-3',
      severity: 'urgent',
      lifecycle: 'acknowledged',
      acknowledgedAt: '2026-09-09T10:00:00.000Z',
    }),
  ];
  saveDispatchRecords(records);
  const reloaded = loadDispatchRecords();
  assert.equal(reloaded.length, 3);
  assert.equal(reloaded[2].lifecycle, 'acknowledged');
  assert.equal(reloaded[2].acknowledgedAt, '2026-09-09T10:00:00.000Z');
});

void test('脏 JSON 不会污染当前会话', () => {
  const stub = makeStorageStub();
  // @ts-expect-error 测试用 stub
  globalThis.window = { localStorage: stub };
  stub.setItem(DISPATCH_STORAGE_KEY, '{not json');
  assert.deepEqual(loadDispatchRecords(), []);
});

void test('数组里混了非法形状的记录会被全部丢弃', () => {
  const stub = makeStorageStub();
  // @ts-expect-error 测试用 stub
  globalThis.window = { localStorage: stub };
  stub.setItem(DISPATCH_STORAGE_KEY, JSON.stringify([{ not: 'a record' }, makeRecord({ findingId: 'f-valid' })]));
  const reloaded = loadDispatchRecords();
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].findingId, 'f-valid');
});

void test('clear 后能重新开始', () => {
  const stub = makeStorageStub();
  // @ts-expect-error 测试用 stub
  globalThis.window = { localStorage: stub };
  saveDispatchRecords([makeRecord()]);
  clearDispatchRecords();
  assert.equal(stub.getItem(DISPATCH_STORAGE_KEY), null);
  assert.deepEqual(loadDispatchRecords(), []);
});

void test('localStorage 不可用时不抛错，内存仍能跑', () => {
  const stub = makeStorageStub();
  stub.disable();
  // @ts-expect-error 测试用 stub
  globalThis.window = { localStorage: stub };
  // load / save / clear 全部静默降级为 no-op
  assert.deepEqual(loadDispatchRecords(), []);
  saveDispatchRecords([makeRecord()]); // 不应抛错
  clearDispatchRecords(); // 不应抛错
});

void test('配额满时不抛错，记录丢失但不破坏内存', () => {
  const stub = makeStorageStub();
  // @ts-expect-error 测试用 stub
  globalThis.window = { localStorage: stub };
  // 模拟 setItem 抛 QuotaExceeded（makeStorageStub.disable 会让 setItem 抛错）
  stub.disable();
  saveDispatchRecords([makeRecord()]); // 必须静默吞掉
});
