import type { ChatMessage, FamilyHealthEvent } from '../types';
import type { HealthRecordSnapshot, HealthRecordStore } from './HealthRecordStore';
import type { HealthEvent } from '../pipeline/events';

/**
 * 本地持久化边界（审查反馈：刷新页面清空一切 = "这东西现在还不能用"）。
 *
 * PersistentHealthRecordStore 在 LocalHealthRecordStore 的会话内存语义之上，
 * 增加「浏览器本地异步持久化 + 启动水合」：
 * - load/save/clear 仍是同步接口，App 的调用方式完全不变；
 * - save 以 fire-and-forget 方式写入底层 KV（IndexedDB），写失败只降级为会话内存，不阻塞 UI；
 * - hydrate() 在应用启动时把上次的快照读回内存缓存，App 在水合完成前不渲染主界面，
 *   从而避免"首次 save 覆盖掉历史数据"的竞态。
 *
 * 隐私边界不变：数据只存在本机浏览器、本浏览器 profile 内，不上传任何服务器；
 * 换设备/换浏览器仍需要显式的跨设备同步（PeerJS）或未来的账号体系。
 */

export interface AsyncKeyValueStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const STORAGE_KEY = 'ankang-route1-health-snapshot-v1';
const SNAPSHOT_VERSION = 1;

interface StoredEnvelope {
  version: number;
  savedAt: string;
  snapshot: HealthRecordSnapshot;
}

const EMPTY: HealthRecordSnapshot = { events: [], familyEvents: [], chat: [] };

function cloneSnapshot(snapshot: HealthRecordSnapshot): HealthRecordSnapshot {
  return {
    events: snapshot.events.map((event) => ({ ...event })) as HealthEvent[],
    familyEvents: snapshot.familyEvents.map((event) => ({ ...event })) as FamilyHealthEvent[],
    chat: snapshot.chat.map((message) => ({ ...message })) as ChatMessage[],
  };
}

/** 结构校验：持久化里的旧数据/坏数据不能把应用搞挂，宁可当作没有历史。 */
function isValidSnapshot(value: unknown): value is HealthRecordSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<HealthRecordSnapshot>;
  return Array.isArray(candidate.events) && Array.isArray(candidate.familyEvents) && Array.isArray(candidate.chat);
}

export class PersistentHealthRecordStore implements HealthRecordStore {
  private cache: HealthRecordSnapshot = EMPTY;
  /** 在途/已完成的水合 promise：并发调用共享同一结果（React StrictMode 双触发防覆盖）。 */
  private hydratePromise: Promise<boolean> | null = null;

  constructor(private readonly kv: AsyncKeyValueStore | null) {}

  load(): HealthRecordSnapshot {
    return cloneSnapshot(this.cache);
  }

  save(snapshot: HealthRecordSnapshot): void {
    this.cache = cloneSnapshot(snapshot);
    if (!this.kv) return;
    const envelope: StoredEnvelope = {
      version: SNAPSHOT_VERSION,
      savedAt: new Date().toISOString(),
      snapshot: cloneSnapshot(snapshot),
    };
    void this.kv.set(STORAGE_KEY, envelope).catch((error) => {
      console.warn('[health-store] 本地持久化写入失败，当前会话仍可继续使用：', error);
    });
  }

  clear(): void {
    this.cache = EMPTY;
    if (!this.kv) return;
    void this.kv.delete(STORAGE_KEY).catch(() => {});
  }

  /**
   * 启动水合：把上次持久化的快照读进内存缓存。
   * 返回 true 表示存在可用的历史数据（App 应直接采用 load() 的结果）。
   * 多次调用幂等；任何读取/解析失败都等价于"没有历史数据"。
   *
   * 关键：并发调用必须共享同一个在途 promise。React StrictMode 会在开发模式
   * 双触发启动 effect——第二次调用发生在第一次的 IDB 读取尚未完成时，若按
   * "已完成"短路返回空 cache 的结果，App 会误判"无历史"并种下演示数据，
   * 把上一次会话的真实记录覆盖掉（彩排实测复现：刷新即丢聊天）。
   */
  hydrate(): Promise<boolean> {
    if (!this.hydratePromise) {
      this.hydratePromise = this.runHydrate();
    }
    return this.hydratePromise;
  }

  private async runHydrate(): Promise<boolean> {
    if (!this.kv) return false;
    try {
      const raw = await this.kv.get(STORAGE_KEY);
      if (typeof raw !== 'object' || raw === null) return false;
      const envelope = raw as Partial<StoredEnvelope>;
      if (envelope.version !== SNAPSHOT_VERSION) return false;
      if (!isValidSnapshot(envelope.snapshot)) return false;
      this.cache = cloneSnapshot(envelope.snapshot);
      return this.cache.events.length > 0 || this.cache.familyEvents.length > 0 || this.cache.chat.length > 0;
    } catch (error) {
      console.warn('[health-store] 本地历史数据读取失败，按无历史启动：', error);
      return false;
    }
  }
}
