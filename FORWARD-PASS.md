# FORWARD-PASS

Run before each gate boundary: full test suite + the gate's security sweep, findings recorded
here. Security issues on core surfaces (key handling, sandboxing, sovereignty invariants) cannot
be deferred. Newest gate first.

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
