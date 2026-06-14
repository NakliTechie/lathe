# FORWARD-PASS

Run before each gate boundary: full test suite + the gate's security sweep, findings recorded
here. Security issues on core surfaces (key handling, sandboxing, sovereignty invariants) cannot
be deferred. Newest gate first.

---

## G2 — Editor shell (2026-06-14)

### Tests / checks — all green
- `pnpm typecheck`: clean. `pnpm build`: green (worker 401 KB w/ sucrase, still under `/assets/`).
- `pnpm verify`: 16/16 (cad.ts now auto-unwraps; harness unaffected).
- In browser: the editor's source is compiled (sucrase → CJS, `new Function` with the CAD API
  injected) and built into the bracket; **Run** (button + Cmd/Ctrl+Enter) rebuilds edited source
  (verified a `fuse` model live). Error region proven:
  - compile error → `compile · line 4`, "Unexpected token, expected …";
  - build error → `build`, "frobnicate is not defined";
  - viewport keeps the last good part (never blank); fixing + Run clears the error and renders.

### What G2 delivered
- **Three-region layout** (code | viewport | params); CodeMirror 6 with JS/TS highlighting.
- **The model is now source** — the worker compiles editor text (the "code is the model" core),
  not a bundled module. `src/models/default-model.js` is the clean default (ambient CAD API, no
  imports, no `unwrap`). `src/kernel/cad.ts` is the authoring facade (brepjs verbatim, auto-unwrap
  → fail loud, ambient disposal) and the surface injected into user models.
- **Loud error region** with phase + source line; Esc dismisses.

### Security sweep — code execution introduced; this is the core surface
- **Model runs only in the worker:** PASS — compile + `build()` happen in the kernel worker
  (no DOM, no `window`); the DOM side only sends source + params over the protocol.
- **'unsafe-eval':** the model-compile `new Function` is the SAME worker boundary that already
  needs eval for Embind (G0). No new exposure: the document policy stays strict.
- **No remote-script execution:** PASS — the model is editor source, never network-fetched;
  codegen (G4) will write into the editor and run THIS path, not eval a remote source. `script-src 'self'`.
- **Network egress from model code:** ENFORCED by CSP `connect-src 'self'` (a model — even via a
  nested blob worker, which inherits this policy — can't reach off-origin). Plus a best-effort
  worker-global lockdown (`fetch`/`XHR`/`WebSocket`/`EventSource`/`importScripts` denied after
  init) — verified: a model calling `fetch` fails loud ("geometry stays local").
- **No telemetry:** PASS. **BYOK key:** still N/A (G4); will live main-thread, never in the worker.

### Follow-ups (carried)
- [G3] Param panel (the third region is a stub today). [G4] BYOK codegen writes into the editor.
- [G5] Persist editor content (FSA/IndexedDB); code-split the 1 MB main bundle; self-host fonts.
- [later] Multi-shape `build()` returns.

**Verdict:** G2 clear. Editor + Run + loud-failure proven; code-execution surface contained
(worker-only, CSP-bounded, egress-denied). No open security issue on a core surface.

---

## G1 — Kernel + render core (2026-06-14)

### Tests / checks — all green
- `pnpm typecheck`: clean.
- `pnpm verify` (headless, `--expose-gc`): **16/16** — every primitive (box, cylinder, fillet,
  union, cut, intersect); the reference bracket meshes (11 faces) and exports a valid STEP
  (770 entities, `MANIFOLD_SOLID_BREP` + `CYLINDRICAL_SURFACE` from both fillet and hole) and a
  size-exact binary STL; re-run loop over 200 builds stays bounded (peak 582 handles « 3200,
  3215 GC-reclaimed).
- `pnpm build`: green.
- In browser: reference bracket (box + cylinder + cut + fillet) renders with orbit/pan/zoom;
  `lathe.rebuild({…})` re-runs live (94 ms cold → 16 ms warm) and the viewport re-frames.

### What G1 delivered (beyond G0)
- Required primitives proven: **box, cylinder, boolean (union/cut/intersect), fillet**.
- **Re-run loop** wired and verified live (programmatic `window.lathe.rebuild`, the seed of the
  §11 agent face).
- Reference part upgraded to a mounting bracket so a boolean shows in the live render path.
- **Shape disposal** (the G0 follow-up): `src/kernel/cad.ts` `runInScope` deterministically frees
  the shapes a model creates; brepjs GC-manages the rest (verified bounded). The cad module is
  also the authoring surface that user models (G2) will be given.

### Security sweep
- **Kernel off the main thread:** PASS — unchanged; all kernel ops in the worker.
- **No telemetry / phone-home:** PASS — unchanged; `connect-src 'self'`.
- **No remote-script execution:** PASS — model still bundled; nothing eval's network data.
- **CSP:** unchanged from G0 (document strict / worker-scoped `'unsafe-eval'`).
- **New surface — `window.lathe.rebuild`:** main-thread only, calls the existing worker protocol
  with params; introduces no new capability and no key/network access. Acceptable.

### Follow-ups (carried)
- [later] Multi-shape `build()` returns (array of solids) — worker still takes the first shape;
  honor the full §4 contract when assemblies matter.
- [G5] Verify the prod CSP split live on Cloudflare Pages.
- [G5] Self-host Inter / JetBrains Mono.

**Verdict:** G1 clear. Primitives + STEP/STL export + re-run loop proven; no open security issue.

---

## G0 — Spike: kernel + authoring lib (2026-06-14)

### Tests / checks — all green
- `pnpm typecheck` (tsc strict, `noUnusedLocals`/`noUnusedParameters`): clean.
- `pnpm build` (tsc + vite prod build): green. Worker emits to `dist/assets/worker-*.js`
  (so the `/assets/*` worker-CSP rule applies); WASM is a separate asset; main bundle 137 KB gz.
- `pnpm verify` (headless kernel, Node, no DOM): **8/8 checks pass** — mesh 10 faces / 220 tris;
  STEP valid ISO-10303-21 with `MANIFOLD_SOLID_BREP` + `CYLINDRICAL_SURFACE`, 686 entities;
  binary STL size-exact.
- In-browser (Vite dev): reference part builds + renders in a Three.js viewport in ~37 ms;
  STEP and STL export from the UI both succeed.

### Security sweep
- **Kernel off the main thread:** PASS — all kernel ops (`build`/`mesh`/export) run in the
  Web Worker; the DOM side only sends the protocol and receives typed arrays / ArrayBuffers.
- **No telemetry / phone-home:** PASS — zero analytics, zero external domains. Fonts use a system
  fallback (no Google Fonts fetch). `connect-src 'self'`.
- **No remote-script execution:** PASS — the model is bundled, not fetched; nothing `eval`s
  network data; `script-src` is `'self'` (+ wasm-eval). Codegen (network→code) lands in G4 and
  will run through the same worker path, never eval'd from a remote source.
- **BYOK key handling:** N/A in G0 (no key, no auth, no network). Lands in G4 — VaultMind pattern.
- **CSP intact — with a documented deviation:** the DOCUMENT policy is strict per §8
  (`script-src 'self' 'wasm-unsafe-eval'`, no `'unsafe-eval'`). The kernel **Web Worker** policy
  adds `'unsafe-eval'` because emscripten Embind generates invokers via `new Function` —
  intrinsic to every OCCT-WASM build, unremovable without forking the kernel (rule #6). Confined
  to the worker (no DOM, no key, `connect-src 'self'`). See SPIKE-FINDINGS.md §"Security finding".
  **This is the one item flagged for the human at the G0 gate.**

### Follow-ups (carried, not blocking the gate)
- [G1] Dispose OCCT shape handles after each build (one handle leaks per build today).
- [G1] Handle multi-shape `build()` returns (G0 takes the first shape only).
- [G5] Verify the prod CSP split live on Cloudflare Pages (`vite preview` doesn't apply `_headers`).
- [G5] Self-host Inter / JetBrains Mono (tokens reference them; system-fallback for now).
- [note] 500 KB chunk warning (three.js in the main bundle) — code-split later; not a correctness issue.

**Verdict:** G0 clear. No security issue left open on a core surface; the one CSP deviation is
inherent to the chosen architecture, resolved in the most containment-preserving way, documented,
and surfaced.
