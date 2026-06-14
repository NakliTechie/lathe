/**
 * App entry (DOM side). Three regions — code | viewport | params — over one kernel
 * worker. The editor's source is the model; Run compiles + builds it in the worker;
 * errors surface loudly into the error region (never a blank screen). The DOM never
 * touches the kernel directly, only the protocol — so the core stays headless-callable.
 */
import "./styles.css";
import { Viewport } from "./render/viewport";
import { createEditor, getDoc, setEditorTheme } from "./editor/editor";
import { createParamPanel, type ParamPanel } from "./params/panel";
import { generateModel, MODELS, DEFAULT_MODEL } from "./codegen/generate";
import { getFingerprint, setKey, clearKey } from "./codegen/vault";
import { openModel, saveModel, saveDraft, loadDraft } from "./persist/files";
import { openHelp } from "./ui/help";
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
    <button class="btn btn-icon" id="open" aria-label="Open a model file" title="Open">${icon("folder")}</button>
    <button class="btn btn-icon" id="save" aria-label="Save model to disk — Cmd or Ctrl + S" title="Save (Cmd/Ctrl+S)">${icon("save")}</button>
    <button class="btn btn-run" id="run" aria-label="Run model — Cmd or Ctrl + Enter">${icon("play")} Run</button>
    <button class="btn" id="export-step" disabled aria-label="Export STEP file for manufacturing">${icon("box")} STEP</button>
    <button class="btn" id="export-stl" disabled aria-label="Export STL file for 3D printing">${icon("download")} STL</button>
    <button class="btn btn-icon" id="theme" aria-label="Toggle light or dark theme" title="Theme">${icon("moon")}</button>
    <button class="btn btn-icon" id="help" aria-label="Help" title="Help">${icon("help")}</button>
  </header>
  <main class="workbench">
    <section class="pane pane-code">
      <div class="prompt-bar">
        <input id="prompt" class="prompt-input" type="text" autocomplete="off" spellcheck="false"
          placeholder="Describe a part — e.g. a 40×20 bracket with two M4 holes"
          aria-label="Describe a part for the AI to model" />
        <button class="btn btn-accent" id="generate">${icon("sparkles")} Generate</button>
        <button class="btn btn-icon" id="key-btn" aria-label="API key settings" title="API key">${icon("key")}</button>
        <div class="key-panel" id="key-panel" hidden>
          <label class="key-label" for="key-input">Anthropic API key — bring your own</label>
          <input id="key-input" class="key-input" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-..." />
          <label class="key-label" for="model-select">Model</label>
          <select id="model-select" class="param-select"></select>
          <div class="key-actions">
            <button class="btn btn-accent" id="key-save">Save key</button>
            <button class="btn btn-ghost" id="key-clear" hidden>Clear</button>
          </div>
          <p class="key-note" id="key-note"></p>
        </div>
      </div>
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
const openBtn = document.getElementById("open") as HTMLButtonElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const themeBtn = document.getElementById("theme") as HTMLButtonElement;
const helpBtn = document.getElementById("help") as HTMLButtonElement;
const paramsBody = document.getElementById("params")!;
const saveParamsBtn = document.getElementById("save-params") as HTMLButtonElement;
const promptInput = document.getElementById("prompt") as HTMLInputElement;
const generateBtn = document.getElementById("generate") as HTMLButtonElement;
const keyBtn = document.getElementById("key-btn") as HTMLButtonElement;
const keyPanel = document.getElementById("key-panel")!;
const keyInput = document.getElementById("key-input") as HTMLInputElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const keySaveBtn = document.getElementById("key-save") as HTMLButtonElement;
const keyClearBtn = document.getElementById("key-clear") as HTMLButtonElement;
const keyNote = document.getElementById("key-note")!;

const viewport = new Viewport(document.getElementById("viewport")!);

const THEME_PREF = "lathe.theme";
let theme: "dark" | "light" = localStorage.getItem(THEME_PREF) === "light" ? "light" : "dark";

let draftTimer = 0;
const editor: EditorView = createEditor(
  document.getElementById("editor")!,
  defaultModel,
  () => void runModel(),
  (doc) => {
    clearTimeout(draftTimer);
    draftTimer = self.setTimeout(() => void saveDraft(doc), 600); // autosave draft (IndexedDB)
  },
  theme === "dark",
);

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
    // Restore the last unsaved draft (local IndexedDB) so a reload doesn't lose work.
    const draft = await loadDraft();
    if (draft && draft.trim()) setEditorSource(draft);
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

/* ---- file ops + theme + help (G5) ---- */
openBtn.addEventListener("click", async () => {
  const file = await openModel();
  if (!file) return;
  setEditorSource(file.content);
  setStatus(`Opened ${file.name}`, "ok");
  await runModel();
});

async function saveToDisk(): Promise<void> {
  const name = await saveModel(getDoc(editor));
  if (name) setStatus(`Saved ${name}`, "ok");
}
saveBtn.addEventListener("click", () => void saveToDisk());

function applyTheme(): void {
  document.documentElement.dataset.theme = theme;
  themeBtn.innerHTML = icon(theme === "dark" ? "sun" : "moon");
  setEditorTheme(editor, theme === "dark");
  viewport.refreshTheme();
}
applyTheme();
themeBtn.addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_PREF, theme);
  applyTheme();
});

helpBtn.addEventListener("click", () => openHelp());

saveParamsBtn.addEventListener("click", () => {
  if (!panel) return;
  const updated = writeParamsBack(getDoc(editor), panel.writeback());
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: updated } });
  setStatus("Saved current parameters into your code", "ok");
});
/* ---- BYOK codegen + VaultMind key (G4) ---- */
const MODEL_PREF = "lathe.byok.model";
let currentModel = localStorage.getItem(MODEL_PREF) ?? DEFAULT_MODEL;
for (const m of MODELS) {
  const opt = document.createElement("option");
  opt.value = m.id;
  opt.textContent = m.label;
  modelSelect.appendChild(opt);
}
modelSelect.value = currentModel;
modelSelect.addEventListener("change", () => {
  currentModel = modelSelect.value;
  localStorage.setItem(MODEL_PREF, currentModel);
});

function refreshKeyUI(): void {
  const fp = getFingerprint();
  keyBtn.classList.toggle("has-key", !!fp);
  keyClearBtn.hidden = !fp;
  keyNote.textContent = `${fp ? `Key ${fp} stored` : "Stored"} in your browser only (IndexedDB) — sent only to your AI provider, never to Lathe.`;
}
refreshKeyUI();

keyBtn.addEventListener("click", () => {
  keyPanel.hidden = !keyPanel.hidden;
  if (!keyPanel.hidden) keyInput.focus();
});
keySaveBtn.addEventListener("click", async () => {
  const v = keyInput.value.trim();
  if (!v) return;
  await setKey(v);
  keyInput.value = "";
  refreshKeyUI();
  keyPanel.hidden = true;
  setStatus("API key saved — it stays in your browser.", "ok");
});
keyClearBtn.addEventListener("click", async () => {
  await clearKey();
  refreshKeyUI();
  setStatus("API key cleared.", "ok");
});

async function generate(): Promise<void> {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    promptInput.focus();
    return;
  }
  if (!getFingerprint()) {
    keyPanel.hidden = false;
    keyInput.focus();
    setStatus("Add your Anthropic API key to generate.", "error");
    return;
  }
  const label = MODELS.find((m) => m.id === currentModel)?.label ?? currentModel;
  generateBtn.disabled = true;
  setStatus(`Generating with ${label}…`);
  try {
    const code = await generateModel({ model: currentModel, prompt });
    setEditorSource(code);
    await runModel(); // a bad generation fails loud via the G2 error path
  } catch (err) {
    setStatus(`Generation failed — ${message(err)}`, "error");
  } finally {
    generateBtn.disabled = false;
  }
}
generateBtn.addEventListener("click", () => void generate());
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void generate();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    clearError();
    keyPanel.hidden = true;
  }
  // Intercept the browser's Save and route to disk (handoff §10).
  if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    void saveToDisk();
  }
});

function setEditorSource(src: string): void {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: src } });
}

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
  setSource: (src: string) => setEditorSource(src),
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
function icon(name: "play" | "box" | "download" | "save" | "sparkles" | "key" | "folder" | "sun" | "moon" | "help"): string {
  const paths: Record<string, string> = {
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

void start();
