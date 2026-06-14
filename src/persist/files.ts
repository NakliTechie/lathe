/**
 * Model-file persistence (handoff §7, §G5). The model is the user's file: on Chromium,
 * the File System Access API saves/opens it on disk (the handle is persisted to
 * IndexedDB so re-save targets the same file). Elsewhere it falls back to a download +
 * a file-input open. A working draft is autosaved to IndexedDB so a reload never loses
 * unsaved code (local only — model code never goes to localStorage or any server).
 */
import { idbGet, idbSet, idbDel } from "./idb";

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}
interface FSWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FSFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FSWritable>;
  queryPermission?(d: { mode: string }): Promise<PermissionState>;
  requestPermission?(d: { mode: string }): Promise<PermissionState>;
}
interface PickerWindow {
  showOpenFilePicker?(opts?: { types?: FilePickerAcceptType[]; multiple?: boolean }): Promise<FSFileHandle[]>;
  showSaveFilePicker?(opts?: { suggestedName?: string; types?: FilePickerAcceptType[] }): Promise<FSFileHandle>;
}

const win = window as unknown as PickerWindow;
const ACCEPT: FilePickerAcceptType[] = [
  { description: "Lathe model", accept: { "text/javascript": [".js", ".mjs", ".ts"] } },
];
const HANDLE_KEY = "fileHandle";
const DRAFT_KEY = "draft";

export const hasFSA = typeof win.showSaveFilePicker === "function";

let handle: FSFileHandle | null = null;

async function restoredHandle(): Promise<FSFileHandle | null> {
  if (handle) return handle;
  handle = await idbGet<FSFileHandle>(HANDLE_KEY);
  return handle;
}

async function ensurePermission(h: FSFileHandle): Promise<boolean> {
  if (!h.queryPermission || !h.requestPermission) return true;
  if ((await h.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

/** Open a model file. Returns its name + contents, or null if cancelled. */
export async function openModel(): Promise<{ name: string; content: string } | null> {
  if (hasFSA && win.showOpenFilePicker) {
    const picked = await win.showOpenFilePicker({ types: ACCEPT, multiple: false }).catch(() => null);
    if (!picked?.[0]) return null;
    handle = picked[0];
    await idbSet(HANDLE_KEY, handle);
    const file = await handle.getFile();
    return { name: file.name, content: await file.text() };
  }
  return openViaInput();
}

/** Save to the current file (FSA) or download (fallback). Returns the file name, or null if cancelled. */
export async function saveModel(content: string, suggestedName = "lathe-model.js"): Promise<string | null> {
  if (hasFSA && win.showSaveFilePicker) {
    try {
      const existing = await restoredHandle();
      if (!existing || !(await ensurePermission(existing))) {
        handle = await win.showSaveFilePicker({ suggestedName, types: ACCEPT });
      }
      const target = handle!;
      const writable = await target.createWritable();
      await writable.write(content);
      await writable.close();
      await idbSet(HANDLE_KEY, target);
      return target.name;
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return null; // user cancelled the picker
      throw err;
    }
  }
  downloadText(content, suggestedName);
  return suggestedName;
}

/** Force a new file (Save As). */
export async function saveModelAs(content: string, suggestedName = "lathe-model.js"): Promise<string | null> {
  handle = null;
  await idbDel(HANDLE_KEY);
  return saveModel(content, suggestedName);
}

function openViaInput(): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".js,.mjs,.ts,text/javascript";
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, content: await f.text() } : null);
    };
    input.click();
  });
}

function downloadText(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/javascript" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

/* Working draft — IndexedDB, never localStorage (§7 forbids model code in localStorage). */
export const saveDraft = (content: string): Promise<void> => idbSet(DRAFT_KEY, content);
export const loadDraft = (): Promise<string | null> => idbGet<string>(DRAFT_KEY);
export const clearDraft = (): Promise<void> => idbDel(DRAFT_KEY);
