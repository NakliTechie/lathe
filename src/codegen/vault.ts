/**
 * VaultMind key handling (handoff §7) — BYOK keys live in the browser only, one per
 * provider. Keys are stored in IndexedDB (never localStorage, never any server); a key
 * leaves the browser only on a direct request to that provider. A short fingerprint (a
 * hash prefix — NOT the key) is kept in localStorage so the UI can show "key recognised".
 *
 * Keys are read on the MAIN thread only, for codegen; never sent to the kernel worker.
 */
const DB_NAME = "lathe-vault";
const STORE = "byok";
const FP_PREFIX = "lathe.byok.fp.";

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

/** Short, non-reversible recognition hash (first 4 bytes of SHA-256). Not the key. */
async function fingerprintOf(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getKey(provider: string): Promise<string | null> {
  try {
    return (await tx<string | undefined>("readonly", (s) => s.get(provider))) ?? null;
  } catch {
    return null;
  }
}

export async function setKey(provider: string, key: string): Promise<void> {
  await tx("readwrite", (s) => s.put(key, provider));
  localStorage.setItem(FP_PREFIX + provider, await fingerprintOf(key));
}

export async function clearKey(provider: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(provider));
  localStorage.removeItem(FP_PREFIX + provider);
}

/** The recognition fingerprint for a provider's stored key, or null if none. */
export function getFingerprint(provider: string): string | null {
  return localStorage.getItem(FP_PREFIX + provider);
}
