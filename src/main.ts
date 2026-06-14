/**
 * App entry (DOM side). Spawns the kernel worker, builds the reference part, renders
 * it, and wires STEP/STL export. The DOM never touches the kernel directly — only the
 * protocol — so the same build pipeline is callable headlessly later.
 */
import "./styles.css";
import { Viewport } from "./render/viewport";
import type { Request, Response, Params } from "./kernel/protocol";

const app = document.getElementById("app")!;

app.insertAdjacentHTML(
  "afterbegin",
  `
  <div id="viewport"></div>
  <header class="topbar">
    <div class="brand"><span class="dot"></span>Lathe<span class="tag">sovereign code-CAD · G0</span></div>
    <div class="spacer"></div>
    <button class="btn" id="export-step" disabled aria-label="Export STEP file for manufacturing">
      ${icon("box")} STEP
    </button>
    <button class="btn" id="export-stl" disabled aria-label="Export STL file for 3D printing">
      ${icon("download")} STL
    </button>
  </header>
  <footer class="statusbar" role="status" aria-live="polite">
    <span class="led"></span><span id="status">Starting…</span>
  </footer>
`,
);

const boot = document.getElementById("boot")!;
const bootStatus = document.getElementById("boot-status")!;
const statusbar = document.querySelector(".statusbar") as HTMLElement;
const statusEl = document.getElementById("status")!;
const stepBtn = document.getElementById("export-step") as HTMLButtonElement;
const stlBtn = document.getElementById("export-stl") as HTMLButtonElement;

const viewport = new Viewport(document.getElementById("viewport")!);

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
const params: Params = {}; // G0: model defaults

async function start(): Promise<void> {
  try {
    bootStatus.textContent = "Loading kernel…";
    const initRes = await call({ kind: "init" });
    if (!initRes.ok) throw new Error(initRes.error);

    bootStatus.textContent = "Building reference part…";
    const res = await call({ kind: "build", params });
    if (!res.ok) throw new Error(res.error);
    if (res.kind !== "build") return;

    viewport.setGeometry(res.geometry);
    const g = res.geometry;
    setStatus(
      `Reference part — ${g.solidCount} solid, ${g.faceCount} faces, ${g.triangleCount.toLocaleString()} triangles · built in ${Math.round(res.ms)} ms`,
      "ok",
    );
    stepBtn.disabled = false;
    stlBtn.disabled = false;
    hideBoot();
  } catch (err) {
    setStatus(`Failed to build reference part — ${message(err)}`, "error");
    hideBoot();
  }
}

async function doExport(format: "step" | "stl"): Promise<void> {
  setStatus(`Exporting ${format.toUpperCase()}…`);
  const res = await call({ kind: "export", format, params });
  if (!res.ok) {
    setStatus(`${format.toUpperCase()} export failed — ${res.error}`, "error");
    return;
  }
  if (res.kind !== "export") return;
  triggerDownload(res.data, res.mime, res.filename);
  setStatus(`Exported ${res.filename} — ${res.solidCount} solid, ${res.faceCount} faces`, "ok");
}

stepBtn.addEventListener("click", () => void doExport("step"));
stlBtn.addEventListener("click", () => void doExport("stl"));

/* ---- helpers ---- */
function setStatus(text: string, tone?: "ok" | "error"): void {
  statusEl.textContent = text;
  statusbar.classList.toggle("is-ok", tone === "ok");
  statusbar.classList.toggle("is-error", tone === "error");
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

/** Minimal inline Lucide-style glyphs (one icon set, currentColor). */
function icon(name: "box" | "download"): string {
  const paths: Record<string, string> = {
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

void start();
