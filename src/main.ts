/**
 * App entry (DOM side). Three regions — code | viewport | params — over one kernel
 * worker. The editor's source is the model; Run compiles + builds it in the worker;
 * errors surface loudly into the error region (never a blank screen). The DOM never
 * touches the kernel directly, only the protocol — so the core stays headless-callable.
 */
import "./styles.css";
import { Viewport } from "./render/viewport";
import { createEditor, getDoc } from "./editor/editor";
import { createParamPanel, type ParamPanel } from "./params/panel";
import defaultModel from "./models/default-model.js?raw";
import type { EditorView } from "@codemirror/view";
import type { Request, Response, Params, ParamValue, Failure } from "./kernel/protocol";

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
      <div class="params-header">
        <div class="pane-title">Parameters</div>
        <button class="btn btn-ghost" id="save-params" disabled aria-label="Write current parameter values back into your code">${icon("save")} Save to code</button>
      </div>
      <div id="params" class="params-body">
        <p class="params-hint">Run a model — its <code>params</code> become controls here.</p>
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
const paramsBody = document.getElementById("params")!;
const saveParamsBtn = document.getElementById("save-params") as HTMLButtonElement;

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
let currentParams: Params = {}; // the panel's current values (overrides over model defaults)
let panel: ParamPanel | null = null;
let canExport = false;
let buildSeq = 0;
let liveTimer = 0;

/** Compile + build the editor's source. The editor's Run, and the boot path. */
async function runModel(): Promise<void> {
  setStatus("Running…");
  const res = await call({ kind: "run", source: getDoc(editor), params: {} });
  if (!res.ok) {
    showError(res);
    return;
  }
  if (res.kind !== "run") return;
  clearError();
  viewport.setGeometry(res.geometry);
  // Introspect the model's declared params into controls; edits re-run live.
  panel = createParamPanel(paramsBody, res.params, onParamInput);
  currentParams = panel.values();
  saveParamsBtn.disabled = false;
  showStats(res.geometry, res.ms);
  canExport = true;
  stepBtn.disabled = false;
  stlBtn.disabled = false;
}

function onParamInput(): void {
  if (!panel) return;
  currentParams = panel.values();
  clearTimeout(liveTimer);
  liveTimer = self.setTimeout(() => void liveBuild(), 24);
}

/** Re-run the current model with the panel's params (no recompile). Latest build wins. */
async function liveBuild(): Promise<void> {
  const seq = ++buildSeq;
  const res = await call({ kind: "build", params: currentParams });
  if (seq !== buildSeq) return; // superseded by a newer edit
  if (!res.ok) {
    showError(res);
    return;
  }
  if (res.kind !== "build") return;
  clearError();
  viewport.setGeometry(res.geometry);
  showStats(res.geometry, res.ms);
}

function showStats(g: { solidCount: number; faceCount: number; triangleCount: number }, ms: number): void {
  setStatus(
    `${g.solidCount} solid · ${g.faceCount} faces · ${g.triangleCount.toLocaleString()} triangles · ${Math.round(ms)} ms`,
    "ok",
  );
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
saveParamsBtn.addEventListener("click", () => {
  if (!panel) return;
  const updated = writeParamsBack(getDoc(editor), panel.writeback());
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: updated } });
  setStatus("Saved current parameters into your code", "ok");
});
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

/** Write current param values back into the source `params` literal, preserving the
 *  rest of the file (handoff §G3 Save). Targets a flat object literal (model contract). */
function writeParamsBack(source: string, values: Record<string, ParamValue>): string {
  const m = source.match(/(export\s+const\s+params\s*=\s*\{)([^}]*)(\})/);
  if (!m || m.index === undefined) return source;
  let body = m[2];
  for (const [key, val] of Object.entries(values)) {
    const re = new RegExp(`(\\b${escapeRe(key)}\\s*:\\s*)(\\[[^\\]]*\\]|"[^"]*"|'[^']*'|[^,}\\n]+)`);
    if (re.test(body)) body = body.replace(re, (_full, pre: string) => pre + formatValue(val));
  }
  return source.slice(0, m.index) + m[1] + body + m[3] + source.slice(m.index + m[0].length);
}
function formatValue(v: ParamValue): string {
  if (Array.isArray(v)) return `[${v.map((s) => JSON.stringify(s)).join(", ")}]`;
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Minimal inline Lucide-style glyphs (one icon set, currentColor). */
function icon(name: "play" | "box" | "download" | "save"): string {
  const paths: Record<string, string> = {
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

void start();
