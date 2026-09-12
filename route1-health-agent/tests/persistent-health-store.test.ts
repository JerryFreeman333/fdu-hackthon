import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentHealthRecordStore, type AsyncKeyValueStore } from '../src/store/PersistentHealthRecordStore';
import type { HealthRecordSnapshot } from '../src/store/HealthRecordStore';
import type { HealthEvent } from '../src/pipeline/events';

/** 内存版异步 KV，模拟 IndexedDB 的持久语义（跨实例共享同一存储）。 */
function memoryKv(): AsyncKeyValueStore & { dump(): Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
    dump: () => map,
  };
}

const event: HealthEvent = {
  id: 'event-1',
  type: 'observation',
  timestamp: '2026-09-11T08:00:00Z',
  source: 'chat',
  observation: {
    id: 'obs-1',
    date: '2026-09-11',
    source: 'chat',
    text: '今天有点喘',
    tags: ['dyspnea'],
    status: 'occurred',
    visibility: 'family_ok',
  },
};

const snapshot: HealthRecordSnapshot = {
  events: [event],
  familyEvents: [],
  chat: [{ id: 'chat-1', role: 'elder', text: '今天有点喘', time: '09-11 08:00', persisted: true }],
};

test('save 后 hydrate 能把快照读回来（刷新页面不丢数据）', async () => {
  const kv = memoryKv();
  const writer = new PersistentHealthRecordStore(kv);
  writer.save(snapshot);

  // 模拟刷新：新实例从同一底层存储水合
  const reader = new PersistentHealthRecordStore(kv);
  const restored = await reader.hydrate();
  assert.equal(restored, true);
  assert.equal(reader.load().events[0]?.id, 'event-1');
  assert.equal(reader.load().chat[0]?.text, '今天有点喘');
});

test('无历史数据时 hydrate 返回 false，load 为空快照', async () => {
  const reader = new PersistentHealthRecordStore(memoryKv());
  assert.equal(await reader.hydrate(), false);
  assert.deepEqual(reader.load(), { events: [], familyEvents: [], chat: [] });
});

test('没有底层 KV（IDB 不可用）时退化为纯会话内存，不抛错', async () => {
  const store = new PersistentHealthRecordStore(null);
  store.save(snapshot);
  assert.equal(store.load().events[0]?.id, 'event-1');
  assert.equal(await store.hydrate(), false, '没有持久层，水合必然无历史');
});

test('坏数据/版本不符时按无历史处理，绝不把应用搞挂', async () => {
  const kv = memoryKv();
  await kv.set('ankang-route1-health-snapshot-v1', { version: 999, snapshot: 'garbage' });
  const reader = new PersistentHealthRecordStore(kv);
  assert.equal(await reader.hydrate(), false);
  assert.deepEqual(reader.load(), { events: [], familyEvents: [], chat: [] });

  await kv.set('ankang-route1-health-snapshot-v1', 'totally not an object');
  const reader2 = new PersistentHealthRecordStore(kv);
  assert.equal(await reader2.hydrate(), false);
});

test('底层写入失败只降级为会话内存，save 不抛错', async () => {
  const failing: AsyncKeyValueStore = {
    get: async () => undefined,
    set: async () => {
      throw new Error('quota exceeded');
    },
    delete: async () => {},
  };
  const store = new PersistentHealthRecordStore(failing);
  assert.doesNotThrow(() => store.save(snapshot));
  assert.equal(store.load().events[0]?.id, 'event-1', '内存缓存仍然可用');
});

test('clear 同时清空内存缓存与底层存储', async () => {
  const kv = memoryKv();
  const store = new PersistentHealthRecordStore(kv);
  store.save(snapshot);
  store.clear();
  assert.deepEqual(store.load(), { events: [], familyEvents: [], chat: [] });
  assert.equal(kv.dump().size, 0);
});

test('hydrate 是幂等的：重复调用不重复读取也不会覆盖已有缓存', async () => {
  const kv = memoryKv();
  const writer = new PersistentHealthRecordStore(kv);
  writer.save(snapshot);
  const reader = new PersistentHealthRecordStore(kv);
  await reader.hydrate();
  // 水合后外部新写入不会自动出现（hydrate 一次性），但已水合内容稳定
  writer.save({ ...snapshot, chat: [] });
  const second = await reader.hydrate();
  assert.equal(second, true);
  assert.equal(reader.load().events[0]?.id, 'event-1');
});

test('并发 hydrate（React StrictMode 双触发）必须共享同一次读取，不得误判无历史', async () => {
  // 模拟 IndexedDB 的异步读取：第一次 get 在微任务之后才 resolve。
  const map = new Map<string, unknown>();
  const writer = new PersistentHealthRecordStore({
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
  });
  writer.save(snapshot);
  let reads = 0;
  const slowKv = {
    get: async (key: string) => {
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return map.get(key);
    },
    set: async (key: string, value: unknown) => {
      map.set(key, value);
    },
    delete: async (key: string) => {
      map.delete(key);
    },
  };
  const reader = new PersistentHealthRecordStore(slowKv);
  // StrictMode：第二个 effect 在第一个的 IDB 读取完成前就发起 hydrate。
  const [first, second] = await Promise.all([reader.hydrate(), reader.hydrate()]);
  assert.equal(first, true, '第一次 hydrate 必须读到历史数据');
  assert.equal(second, true, '并发第二次 hydrate 不允许在读取完成前短路成 false（会把历史覆盖成种子）');
  assert.equal(reader.load().events[0]?.id, 'event-1');
});
