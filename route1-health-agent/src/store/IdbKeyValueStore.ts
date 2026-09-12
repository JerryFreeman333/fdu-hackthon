import type { AsyncKeyValueStore } from './PersistentHealthRecordStore';

/**
 * IndexedDB 之上的极简异步 KV。只存一个 key（整个健康快照），因此不需要
 * objectStore 之外的任何结构；打开失败（Safari 私密模式、权限策略等）返回 null，
 * 由调用方降级为纯会话内存——持久化是增强，不是硬依赖。
 */
export function createIdbKeyValueStore(dbName = 'ankang-route1', storeName = 'kv'): AsyncKeyValueStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
        request.onblocked = () => reject(new Error('indexedDB open blocked'));
      });
    }
    return dbPromise;
  }

  function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          const request = run(tx.objectStore(storeName));
          tx.oncomplete = () => resolve(request.result);
          tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
          tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
        }),
    );
  }

  return {
    get(key) {
      return withStore('readonly', (store) => store.get(key) as IDBRequest<unknown>);
    },
    set(key, value) {
      return withStore('readwrite', (store) => store.put(value, key) as IDBRequest<IDBValidKey>).then(() => undefined);
    },
    delete(key) {
      return withStore('readwrite', (store) => store.delete(key) as IDBRequest<undefined>).then(() => undefined);
    },
  };
}
