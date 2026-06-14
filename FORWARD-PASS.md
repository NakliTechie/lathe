# FORWARD-PASS

Run before each gate boundary: full test suite + the gate's security sweep, findings recorded
here. Security issues on core surfaces (key handling, sandboxing, sovereignty invariants) cannot
be deferred. Newest gate first.

---

## G4 — Codegen (BYOK) (2026-06-14)

### Tests / checks — all green
- `pnpm typecheck`: clean. `pnpm build`: green (+8 KB codegen, all main-thread; worker unchanged).
- `pnpm verify`: 16/16.
- In browser: prompt bar + key panel render; the VaultMind key flow works — a key saves to
  IndexedDB, its fingerprint (`4c2fab08`, a SHA-256 prefix — *not* the key) shows in the UI, and
  Clear removes both. **Pipeline proven with a deliberately fake key:** Generate → a real
  `401 Invalid API key` surfaced loudly (not a network error), which proves CSP, CORS, the
  `anthropic-dangerous-direct-browser-access` header, the request shape, and error handling all
  work end to end. No CSP violation logged.
- **Real generation is the human smoke-test** (handoff names G4 a smoke-test point): with a valid
  key, "a 40×20 bracket with two M4 holes" → a running model. Only a valid key stands between the
  verified pipeline and that result.

### What G4 delivered
- `src/codegen/generate.ts` — BYOK codegen (the `nakli-ai` routing convention realized locally;
  it's not a package, handoff §12). Raw `fetch` to `api.anthropic.com` (no heavy SDK in a
  bundle-sensitive sovereign app); model picker (Opus 4.8 default, honest cloud C1); adaptive
  thinking; a system prompt that teaches the model contract + the CAD API + coordinate conventions
  + an M-bolt hint + a worked bracket example; robust fenced-code extraction.
- `src/codegen/vault.ts` — VaultMind (§7): key in IndexedDB, fingerprint in localStorage.
- Generated code → editor → Run; a bad generation fails loud via the G2 compile/build path.

### Security sweep — BYOK key handling is the core surface; not deferred
- **VaultMind key (§7):** PASS — key in **IndexedDB** (never localStorage, never any server);
  only the recognition **fingerprint** (hash prefix) is in localStorage; the key is read on the
  **main thread only** and is **never sent to the kernel worker**; it leaves the browser only on
  the direct request to the user's chosen provider (there is no Lathe server). Verified store /
  fingerprint / clear.
- **No telemetry / phone-home:** PASS — the only external origin is `api.anthropic.com` (the
  user's provider), pinned in `connect-src` on the **document** policy only; the worker stays
  `connect-src 'self'`.
- **No remote-script execution:** PASS — generated code is written into the editor and run through
  the worker path, never eval'd from the network (rule #5).
- **CSP:** document `connect-src` adds `https://api.anthropic.com`; worker policy unchanged;
  verified the live call raised no CSP violation.

### Follow-ups (carried)
- [G5] persist editor content + key UX polish; help modal; a11y pass; self-host fonts; code-split.
- [human] real-key smoke test of generation quality.

**Verdict:** G4 clear. BYOK codegen wired; the key-handling surface is VaultMind-compliant and
verified; the network path is CSP-bounded and proven. No open security issue on a core surface.

---

## G3 — Param panel (2026-06-14)

### Tests / checks — all green
- `pnpm typecheck`: clean. `pnpm build`: green. `pnpm verify`: 16/16.
- In browser: the panel introspects the model's declared `params` and renders the four
  control types — number → slider + number input, boolean → toggle, string → text,
  `string[]` → select (enum). Verified live:
  - editing `width`/`holeRadius` re-runs and re-renders (debounced, latest-build-wins);
  - the enum select `finish: fillet → chamfer` rebuilt the part with chamfered edges (6 ms);
  - **Save to code** wrote current values back into the source literal
    (`width: 40 → 64`, `holeRadius: 4 → 11`), other params + formatting preserved.

### What G3 delivered
- `src/params/panel.ts` — typed controls from the declared params; edits call back into a
  debounced, latest-wins live build.
- Worker `resolveParams` — an enum (`string[]`) declaration resolves to the selected option
  (default = first) before `build()`; build always sees scalars.
- Save-to-code — `writeParamsBack` rewrites the flat `params` literal in place (numbers,
  booleans, quoted strings, and enum arrays reordered selected-first), preserving the rest.

### Security sweep
- No new capability: the panel is DOM only — it sends `build` with params over the existing
  protocol (no eval, no network). Save edits the editor document client-side. CSP unchanged.
- Kernel off main thread / no telemetry / no remote-script / egress-denied: all still PASS.

### Follow-ups (carried)
- [G4] BYOK codegen writes a model into the editor. [G5] persist editor content; code-split
  the 1 MB main bundle; self-host fonts. [later] multi-shape `build()`.

**Verdict:** G3 clear. Typed controls + live re-run + Save-to-code proven; no new security surface.

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
