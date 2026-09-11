import type { FamilyNotificationRecord } from './notify';

/**
 * 派发台账的本地持久化。
 *
 * 派发记录不属于健康数据（决定已经在派发那一刻做出，记录只是通知历史），
 * 落到 localStorage 以实现跨刷新去重与未确认 push 的重试入口。
 * 写入失败（隐私模式 / 配额满）静默降级为不持久化，但内存里仍然能跑；
 * 读取失败（脏数据 / 版本不匹配）按"全部清空"处理，避免坏数据污染当前会话。
 */
const STORAGE_KEY = 'ankang-route1-dispatch-records-v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function pickStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    // 某些隐私模式下访问 localStorage 会抛错；这里先做一次轻探测。
    const probe = '__ankang_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecordShape(value: unknown): value is FamilyNotificationRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FamilyNotificationRecord>;
  return (
    typeof candidate.findingId === 'string' &&
    (candidate.severity === 'urgent' || candidate.severity === 'alert') &&
    typeof candidate.title === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.createdAt === 'string' &&
    Array.isArray(candidate.deliveries) &&
    (candidate.lifecycle === 'new' || candidate.lifecycle === 'acknowledged')
  );
}

export function loadDispatchRecords(): FamilyNotificationRecord[] {
  const storage = pickStorage();
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 任何一条不合法就整体丢弃；坏数据不值得花精力做容错解析。
    return parsed.filter(isRecordShape);
  } catch {
    return [];
  }
}

export function saveDispatchRecords(records: FamilyNotificationRecord[]): void {
  const storage = pickStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // 配额满 / 隐私模式：不持久化，但不影响内存里的台账。
  }
}

export function clearDispatchRecords(): void {
  const storage = pickStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // 同上，静默。
  }
}

export const DISPATCH_STORAGE_KEY = STORAGE_KEY;
