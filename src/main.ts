/**
 * App entry (DOM side). Three regions — code | viewport | params — over one kernel
 * worker. The editor's source is the model; Run compiles + builds it in the worker;
 * errors surface loudly into the error region (never a blank screen). The DOM never
 * touches the kernel directly, only the protocol — so the core stays headless-callable.
 */
import "./styles.css";
import { Viewport } from "./render/viewport";
import { createEditor, getDoc } from "./editor/editor";
import defaultModel from "./models/default-model.js?raw";
import type { EditorView } from "@codemirror/view";
import type { Request, Response, Params, Failure } from "./kernel/protocol";

const app = document.getElementById("app")!;
app.insertAdjacentHTML(
  "afterbegin",
  `
  <header class="topbar">
    <div class="brand"><span class="dot"></span>Lathe<span class="tag">sovereign code-CAD</span></div>
    <div class="spacer"></div>
    <button class="btn btn-run" id="run" aria-label="Run model — Cmd or Ctrl + Enter">${icon("play")} Run</button>
    <button class="btn" id="export-step" disabled aria-label="Export STEP file for manufacturing">${icon("box")} STEP</button>
    <button class="btn" id="export-stl" disabled aria-label="Export STL file for 3D printing">${icon("download")} STL</button>
  </header>
  <main class="workbench">
    <section class="pane pane-code">
      <div id="editor" aria-label="Model code"></div>
      <div class="error-region" id="error" role="alert" hidden></div>
    </section>
    <section class="pane pane-viewport"><div id="viewport"></div></section>
    <aside class="pane pane-params">
      <div class="pane-title">Parameters</div>
      <div id="params" class="params-body">
        <p class="params-hint">Param controls arrive in G3. For now, edit the <code>params</code> object and Run.</p>
      </div>
    </aside>
  </main>
  <footer class="statusbar" role="status" aria-live="polite"><span class="led"></span><span id="status">Starting…</span></footer>
`,
);

const boot = document.getElementById("boot")!;
const bootStatus = document.getElementById("boot-status")!;
const statusbar = document.querySelector(".statusbar") as HTMLElement;
const statusEl = document.getElementById("status")!;
const errorEl = document.getElementById("error")!;
const runBtn = document.getElementById("run") as HTMLButtonElement;
const stepBtn = document.getElementById("export-step") as HTMLButtonElement;
const stlBtn = document.getElementById("export-stl") as HTMLButtonElement;

const viewport = new Viewport(document.getElementById("viewport")!);
const editor: EditorView = createEditor(document.getElementById("editor")!, defaultModel, () => void runModel());

/* ---- worker RPC ---- */
const worker = new Worker(new URL("./kernel/worker.ts", import.meta.url), { type: "module" });
let nextId = 1;
const pending = new Map<number, (r: Response) => void>();

worker.onmessage = (e: MessageEvent<Response>) => {
  const resolve = pending.get(e.data.id);
  if (resolve) {
    pending.delete(e.data.id);
    resolve(e.data);
  }
};
worker.onerror = (e) => setStatus(`Kernel worker crashed: ${e.message}`, "error");

type ReqNoId =
  | { kind: "init" }
  | { kind: "run"; source: string; params: Params }
  | { kind: "build"; params: Params }
  | { kind: "export"; format: "step" | "stl"; params: Params };

function call(req: ReqNoId): Promise<Response> {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    worker.postMessage({ ...req, id } as Request);
  });
}

/* ---- flow ---- */
let currentParams: Params = {}; // param overrides (G3 will populate from the panel)
let canExport = false;

/** Compile + build the editor's source. The editor's Run, and the boot path. */
async function runModel(): Promise<void> {
  currentParams = {};
  setStatus("Running…");
  const res = await call({ kind: "run", source: getDoc(editor), params: currentParams });
  if (!res.ok) {
    showError(res);
    return;
  }
  if (res.kind !== "run") return;
  clearError();
  viewport.setGeometry(res.geometry);
  const g = res.geometry;
  setStatus(
    `${g.solidCount} solid · ${g.faceCount} faces · ${g.triangleCount.toLocaleString()} triangles · ${Math.round(res.ms)} ms`,
    "ok",
  );
  canExport = true;
  stepBtn.disabled = false;
  stlBtn.disabled = false;
}

async function doExport(format: "step" | "stl"): Promise<void> {
  if (!canExport) return;
  setStatus(`Exporting ${format.toUpperCase()}…`);
  const res = await call({ kind: "export", format, params: currentParams });
  if (!res.ok) {
    showError(res);
    return;
  }
  if (res.kind !== "export") return;
  triggerDownload(res.data, res.mime, res.filename);
  setStatus(`Exported ${res.filename} — ${res.solidCount} solid, ${res.faceCount} faces`, "ok");
}

async function start(): Promise<void> {
  try {
    bootStatus.textContent = "Loading kernel…";
    const initRes = await call({ kind: "init" });
    if (!initRes.ok) throw new Error(initRes.error);
    bootStatus.textContent = "Building model…";
    await runModel();
    hideBoot();
  } catch (err) {
    setStatus(`Failed to start — ${message(err)}`, "error");
    hideBoot();
  }
}

runBtn.addEventListener("click", () => void runModel());
stepBtn.addEventListener("click", () => void doExport("step"));
stlBtn.addEventListener("click", () => void doExport("stl"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") clearError();
});

// Programmatic surface — the seed of the v1.1 agent face (§11).
declare global {
  interface Window {
    lathe?: {
      run: () => Promise<void>;
      rebuild: (overrides?: Params) => Promise<void>;
      setSource: (src: string) => void;
    };
  }
}
window.lathe = {
  run: () => runModel(),
  rebuild: async (overrides: Params = {}) => {
    currentParams = { ...currentParams, ...overrides };
    const res = await call({ kind: "build", params: currentParams });
    if (res.ok && res.kind === "build") viewport.setGeometry(res.geometry);
  },
  setSource: (src: string) =>
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: src } }),
};

/* ---- helpers ---- */
function setStatus(text: string, tone?: "ok" | "error"): void {
  statusEl.textContent = text;
  statusbar.classList.toggle("is-ok", tone === "ok");
  statusbar.classList.toggle("is-error", tone === "error");
}

function showError(res: Failure): void {
  const where = res.phase ? `${res.phase}${res.line ? ` · line ${res.line}` : ""}` : "error";
  errorEl.hidden = false;
  errorEl.innerHTML = `<span class="error-where">${escapeHtml(where)}</span><span class="error-msg">${escapeHtml(res.error)}</span>`;
  setStatus(`Failed (${res.phase ?? "error"}) — ${res.error}`, "error");
}
function clearError(): void {
  errorEl.hidden = true;
  errorEl.textContent = "";
  if (statusbar.classList.contains("is-error")) setStatus("Ready", "ok");
}

function hideBoot(): void {
  boot.classList.add("hidden");
  boot.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    boot.style.display = "none";
  }, 450);
}

function triggerDownload(data: ArrayBuffer, mime: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Minimal inline Lucide-style glyphs (one icon set, currentColor). */
function icon(name: "play" | "box" | "download"): string {
  const paths: Record<string, string> = {
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

void start();
