/**
 * Tiny IndexedDB key/value store for local persistence (handoff §7 — IndexedDB holds
 * persisted FSA handles, the working draft, and param presets). Same-origin, local only.
 */
const DB_NAME = "lathe-store";
const STORE = "kv";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = op(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    return (await run<T | undefined>("readonly", (s) => s.get(key))) ?? null;
  } catch {
    return null;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(value, key));
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export async function idbDel(key: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(key));
  } catch {
    /* non-fatal */
  }
}
