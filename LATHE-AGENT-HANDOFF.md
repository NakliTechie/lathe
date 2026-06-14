# Lathe — Agent Handoff (v1.0)

This is the build spec and the operating contract for the coding agent. Read it
whole before starting. The Vision & Roadmap doc is context; **this** is what you
execute.

---

## 0. Mission & how you work

Build **Lathe v1.0**: a browser-native, sovereign, parametric code-CAD app where
the code is the model, geometry computes in-tab via an OCCT WASM kernel, and a
BYOK model can write the code from a prompt. Ship STEP + STL export.

**Autonomy model.** Work in large autonomous chunks, not step-by-step. Proceed on
your own authority for: naming internals, implementation choices, file/module
layout, debugging, and trying alternatives. You do **not** ask permission for any
of that.

**Stop for the human ONLY when development literally cannot continue:**
- a locked decision in this doc conflicts with reality,
- you need a new dependency not implied here,
- genuine scope ambiguity that would change the *product*.

**Gates are the interrupt points.** Run autonomously *between* gates; pause at each
gate boundary with its artifact committed. Everything else, keep moving.

**Forward pass between gates (mandatory).** Before opening the next gate: run the
full test suite, run the security sweep relevant to that gate (CSP intact, BYOK key
never leaves the browser, no telemetry, no remote-script execution, kernel work off
the main thread), and record findings in `FORWARD-PASS.md`. **Security issues on
core surfaces (key handling, sandboxing, sovereignty invariants) cannot be
deferred.**

---

## 1. Repo / build / deploy

- **Repo:** `NakliTechie/lathe`
- **Language:** TypeScript. **Build:** Vite. Output is fully static.
- **Deploy:** Cloudflare Pages (commercial use OK, free, unlimited bandwidth). The
  OCCT WASM blob and any worker bundles are static assets served from the same
  origin.
- **Domain:** `lathe.naklitechie.com`
- No backend. No serverless functions. If you reach for one, stop — that's a
  sovereignty-invariant conflict, escalate.

---

## 2. Tech baseline

- **Kernel:** OCCT via `opencascade.js` / `occt-wasm` — **pending G0** (see gates).
  Run it in a **Web Worker**, always. Never on the main thread.
- **Authoring API:** `brepjs` (default) on occt-wasm; `replicad` (fallback) —
  **decided in G0**.
- **Render:** Three.js (WebGL2). The authoring lib emits shape/mesh data; Three
  owns rendering. Do not render inside the kernel lib.
- **Editor:** CodeMirror 6 (preferred — lighter) or Monaco. Your call.
- **Model code execution:** author in JS by default; if you accept TS in the model
  module, transpile in-browser with `esbuild-wasm` or `sucrase`. Execute the model
  module **inside the kernel worker** (no DOM, no network).
- **Codegen:** route BYOK calls through `nakli-ai` (unified routing). Key handling
  is the **VaultMind pattern** (see §7).
- **Icons:** Lucide (inline SVG or the static set). One icon set only.
- **UI framework:** none required. Vanilla TS or a micro-lib (e.g. Lit) — keep it
  light. No React/Vue/Svelte unless you can justify it against bundle weight; you
  almost certainly can't.

---

## 3. Browser floor

- **Full experience:** Chromium-based (Chrome / Edge) — needs WASM + WebGL2 + Web
  Workers + **File System Access API**.
- **Graceful degradation** on Firefox / Safari (no full FSA): fall back to OPFS for
  working storage and download-blob for export/save. Detect, don't assume; show a
  one-line notice when FSA is unavailable. Never hard-fail.
- WebGPU is **not** required (v1.1 local inference may use it; v1.0 does not).

---

## 4. The model contract (locked — this unifies everything)

A Lathe model is a module exporting defaults and a build function:

```js
// defaults → become the param-panel controls
export const params = { width: 40, height: 20, fillet: 3, rounded: true };

// p is the current param values; return one shape or an array of shapes
export function build(p) {
  // ...brepjs (or chosen lib) API...
  return shape; // or [shapeA, shapeB]
}
```

**App flow:** load module → read `params` → render controls → `build(current)` in
the worker → mesh → Three render. This same contract powers all three drive modes
**and** the v1.1 agent face (import module, call `build(params)` headlessly, return
STEP/mesh/png). Do not diverge from it.

- **Prompt mode** writes/edits this module.
- **Param mode** mutates `current` and re-runs (and writes back into the `params`
  object literal on explicit save).
- **Export:** mesh → STL; shape(s) → STEP via the kernel's native exporter.

---

## 5. v1.0 — the gates

Each gate ends with a working, deployed (or locally runnable) build + its artifact
+ a `FORWARD-PASS.md` entry.

### G0 — Spike: kernel + authoring lib *(autonomous decision, document it)*
Stand up **the same reference part in both candidates**: a box with one filleted
edge, exported to STEP, meshed, and rendered in a Three.js viewport, with `build()`
running in a Web Worker. Compare: bundle size, cold-start, re-run latency on a
moderately complex part, and authoring DX against the model contract.
- **Decide on your own authority.** Default to **brepjs/occt-wasm**; fall back to
  **replicad** only if the spike shows it clearing the bar materially better.
- **Artifact:** `SPIKE-FINDINGS.md` — numbers + the decision + why.
- **Escalate only if neither candidate clears a usable floor** (then it's a
  new-dependency/scope question).

### G1 — Kernel + render core
Chosen lib wired in the worker; main↔worker message protocol; `build(params)` →
mesh → Three viewport with orbit/pan/zoom; re-run loop. Working primitives:
box, cylinder, boolean (union/cut/intersect), fillet. **STEP + STL export working.**
- **Artifact:** deployed build; the reference part exports a valid STEP that opens
  in FreeCAD.

### G2 — Editor shell
CodeMirror/Monaco code pane; **Run** (Cmd/Ctrl+Enter); error surfacing from worker
+ kernel into a readable error region (line/message; never a silent failure);
three-region layout (code | viewport | params). Loud-failure path proven: a
deliberately broken model shows a clear error, not a blank screen.
- **Artifact:** deployed build; broken-model error UX demoed.

### G3 — Param panel
Introspect the model's `params` object → render typed controls (number → input +
slider, boolean → toggle, string-enum → select). Edit → re-run live. **Save**
writes current values back into the `params` literal in the source.
- **Artifact:** deployed build; param edits drive the viewport live.

### G4 — Codegen (BYOK)
Prompt box → `nakli-ai` BYOK call → model module written into the editor → run.
Honest cloud default (§ Vision). VaultMind key handling (§7). Bad generation fails
loud via the existing error path (G2). System prompt instructs the model in the
**model contract** and the chosen lib's API.
- **Artifact:** deployed build; "a 40×20 bracket with two M4 holes" → running model.
- **Smoke-test point for the human.** (G1 and G4 are the two that tell you whether
  Lathe feels right.)

### G5 — Persistence + polish + ship
FSA save/open of model files; OPFS fallback; IndexedDB for mesh cache + param
presets + persisted FSA handles; localStorage prefs + key fingerprint (§7). Empty
state, error states, a11y pass, keyboard map, **help modal** (§15), **README**
(§14). Deploy to `lathe.naklitechie.com`.
- **Artifact:** the shipped tool.

---

## 6. Design tokens + icons

Calm, craft, technical-but-warm. Dark default (a 3D + code tool), light available.
The accent is brass/amber — thematically apt for a lathe, and warm rather than
corporate. Concrete starter tokens (tune, don't bikeshed):

```css
:root {
  /* dark default */
  --surface-0:#16161a; --surface-1:#1d1d22; --surface-2:#26262d;
  --border:#33333c; --text:#e8e8ea; --text-dim:#9a9aa3;
  --accent:#d8973c; --accent-dim:#a36f2c;      /* brass */
  --danger:#e5564e; --ok:#5bbd7a;
  --radius:8px; --radius-sm:5px;
  --space:8px;  /* multiples: 8/16/24/32 */
  --font-ui:"Inter",system-ui,sans-serif;
  --font-mono:"JetBrains Mono",ui-monospace,monospace;
}
[data-theme="light"]{
  --surface-0:#faf9f6; --surface-1:#fff; --surface-2:#f0efe9;
  --border:#e0ded6; --text:#1c1c1e; --text-dim:#6b6b73;
  --accent:#b5751f; --accent-dim:#8c5a18;
}
```

Code pane uses `--font-mono`; everything else `--font-ui`. Icons: Lucide, 20px in
the toolbar, `currentColor`.

---

## 7. Persistence rules

**localStorage — ALLOW:** UI prefs (theme, panel sizes, last export format), BYOK
key **fingerprint** (short hash for recognition, *not* the key), last-opened file
label.
**localStorage — FORBID:** model code content, the BYOK key itself, any geometry or
mesh data.

**IndexedDB:** persisted FSA file handles (for re-open), mesh/render cache, param
presets, **and the BYOK key under the VaultMind pattern**.
**sessionStorage:** acceptable alternative home for the BYOK key for the session.

**BYOK key — VaultMind pattern (canonical):** key persists locally (sessionStorage
or IndexedDB), **never leaves the browser, never hits any NakliTechie server**, and
a fingerprint is shown in the UI for recognition. Do **not** implement
"in-memory-only / lost on reload" — that's friction with no security gain.

**FSA:** the model files (`.js`/`.ts`) and the STEP/STL exports go to the user's
disk. They own the files.

---

## 8. Security posture + CSP

- **Lathe executes authored code by design** (the model is code). Contain it: run
  the model module **only in the kernel Web Worker** — no DOM, no `window`. The
  worker's reachable surface is the kernel API plus the params, nothing else.
- **Never auto-run network-fetched code.** Codegen output is written into the
  editor and run through the same worker path as hand-authored code; it is not
  `eval`'d from a remote source.
- **CSP (starting point):**
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:;
  connect-src 'self' <BYOK provider endpoints> http://127.0.0.1:* (v1.1 bridge);
  img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none';
  base-uri 'self'; frame-ancestors 'none'.`
  Pin `connect-src` to the specific provider hosts you route to via nakli-ai; add
  the localhost bridge origin only in v1.1.
- **No telemetry domains. No analytics. No phone-home.** This is a hard invariant.

---

## 9. Accessibility

- Full keyboard navigation; visible focus; focus trapping + restore in modals.
- ARIA labels on all toolbar icon-buttons; the prompt box and code pane are
  labelled.
- The 3D canvas is inherently visual — provide a **text status** of operations and
  export results (e.g. "Exported bracket.step — 1 solid, 4 faces") so non-visual
  users get confirmation.
- Contrast ≥ WCAG AA in both themes (check the brass accent on both surfaces).

---

## 10. Keyboard map + conflict resolutions

- **Cmd/Ctrl+Enter** — Run.
- **Cmd/Ctrl+S** — Save model to disk. **Intercept the browser save** (`preventDefault`)
  and route to FSA (or download fallback). This is the one real conflict; resolve it.
- **Esc** — close modal / dismiss error.
- Editor-internal shortcuts belong to CodeMirror/Monaco; don't shadow them.

---

## 11. Agent face of Lathe *(standing question — answer in v1.1, design for it now)*

The agent face is **the model-build pipeline exposed without UI**: `{spec | params}`
→ `{STEP, mesh, png, errors}`, over the same `build(params)` → kernel path the
editor uses. v1.0 ships its human-clothed form (prompt → model). v1.1 adds the
headless op runner and an **MCP server** so Claude Code / Cursor can drive Lathe
directly (ShapeItUp proves the MCP-CAD shape; ours is sovereign and shares the
editor's core). **Build v1.0 so the core is callable without the DOM** — that's why
the model contract (§4) and the worker boundary (§8) are shaped the way they are.
Do not bolt a parallel codepath on later.

---

## 12. Portfolio integration timing

Ship standalone first; integrate after. v1.0 has **no private-mesh dependencies**
(local, no accounts). Use `nakli-ai` for codegen routing and the VaultMind pattern
for keys from day one — those are conventions, not couplings. The commercial fork
(later, separate company) is what composes Identity / Grant / Sync / History.

---

## 13. What NOT to do (hard rules)

1. **No geometry server, no upload, no phone-home.** Geometry computes client-side.
2. **Don't invent a CAD DSL.** Author in TS/JS against the chosen lib.
3. **No live multiplayer co-edit** of model code (commercial fork's file-lock
   territory; silent geometry merges are dangerous).
4. **Never persist the BYOK key** to localStorage or any server. VaultMind only.
5. **Never auto-run network-fetched code**; model code runs in the worker sandbox;
   CSP forbids remote script.
6. **Don't touch or patch the OCCT kernel.** Adopt as-is.
7. **No telemetry / analytics, ever.**
8. **Never block the main thread** with kernel ops — Web Worker, always.
9. **Don't render inside the kernel lib** — Three.js owns render.
10. **Don't fake local codegen quality.** Honest BYOK-cloud default; loud failure on
    bad generation.

---

## 14. README scope (write this — keep it scoped, not the whole vision)

- One-line what-it-is + the sovereignty stance (no server, no accounts, no
  telemetry; your files; geometry stays in your browser).
- **Quickstart:** open the URL → write code, drag params, or prompt → Run → Export.
- **The three drive modes**, two sentences each.
- **The model contract** (`params` + `build(p)`), with the minimal example.
- **BYOK setup:** bring your key; it stays local; fingerprint shown.
- **Browser support:** Chrome/Edge for full FSA; others fall back to download/OPFS.
- **Export formats:** STEP (manufacturing), STL (printing).
- **License** (carries the OCCT LGPL obligation — note the kernel is a replaceable
  WASM component; the portfolio license stance applies to Lathe's own code).

## 15. Help modal content (in-app, behind a `?` button)

- **Keyboard:** Cmd/Ctrl+Enter run · Cmd/Ctrl+S save · Esc close.
- **Three ways to build:** write code · drag params · prompt.
- **How params work:** name a value in the `params` object and it becomes a control;
  drag to re-run live; Save writes the value back into your code.
- **Your key stays local:** BYOK, stored in your browser only, fingerprint shown for
  recognition; it never reaches any server.
- **Where files go:** saved to your disk (or downloaded, on browsers without File
  System Access). Exports: STEP and STL.
- **What runs where:** the CAD kernel runs in your browser tab; nothing is uploaded.
