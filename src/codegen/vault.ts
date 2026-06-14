/**
 * VaultMind key handling (handoff §7) — the BYOK key lives in the browser only.
 *
 * - The key is stored in IndexedDB (persists across sessions; never localStorage, never
 *   any server). It leaves the browser only on a direct request to the AI provider.
 * - A short fingerprint (a hash prefix — NOT the key) is kept in localStorage so the UI
 *   can show "key recognised" across sessions (§7 allows the fingerprint in localStorage).
 *
 * The key is read on the MAIN thread only, for the codegen fetch. It is never sent to
 * the kernel worker.
 */
const DB_NAME = "lathe-vault";
const STORE = "byok";
const KEY_ID = "anthropic";
const FINGERPRINT_KEY = "lathe.byok.fingerprint";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

/** Short, non-reversible recognition hash (first 8 hex of SHA-256). Not the key. */
async function fingerprintOf(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getKey(): Promise<string | null> {
  try {
    return (await tx<string | undefined>("readonly", (s) => s.get(KEY_ID))) ?? null;
  } catch {
    return null;
  }
}

export async function setKey(key: string): Promise<void> {
  await tx("readwrite", (s) => s.put(key, KEY_ID));
  localStorage.setItem(FINGERPRINT_KEY, await fingerprintOf(key));
}

export async function clearKey(): Promise<void> {
  await tx("readwrite", (s) => s.delete(KEY_ID));
  localStorage.removeItem(FINGERPRINT_KEY);
}

/** The recognition fingerprint for the stored key, or null if none. */
export function getFingerprint(): string | null {
  return localStorage.getItem(FINGERPRINT_KEY);
}
