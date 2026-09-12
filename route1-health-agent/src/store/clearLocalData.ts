import type { PersistentHealthRecordStore } from './PersistentHealthRecordStore';

/** 本应用全部本地键的共同前缀（IndexedDB 库名与此一致）。 */
export const LOCAL_DATA_PREFIX = 'ankang-route1-';

/**
 * 评审 P0-4：清空本机全部数据。
 * 谁在这台浏览器上试玩几分钟，谁发的测试主诉就会永久留在 IndexedDB 里持续影响
 * 基线——必须有一个用户可达的"删档重来"入口。
 * 范围：IndexedDB 健康快照 + 所有 ankang-route1-* 本地键（字号/通知台账/tab 标识等）。
 * 不触碰其它站点数据。
 */
export function clearAllLocalData(store: PersistentHealthRecordStore): void {
  store.clear();
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(LOCAL_DATA_PREFIX)) keysToRemove.push(key);
    }
    for (const key of keysToRemove) window.localStorage.removeItem(key);
  } catch {
    // 隐私模式下 localStorage 可能不可用：此时数据本来就只在内存里，不阻塞。
  }
}
