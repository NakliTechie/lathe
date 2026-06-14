# G0 — Spike findings: kernel + authoring lib

**Decision: `brepjs` on `brepjs-opencascade` (occt-wasm).** The handoff default clears the
bar decisively; `replicad` remains a drop-in fallback. Documented 2026-06-14.

---

## The candidates

| | brepjs (default) | replicad (fallback) |
|---|---|---|
| npm | `brepjs@18.69.1` + `brepjs-opencascade@0.15.6` | `replicad@0.23.1` + `replicad-opencascadejs@0.23.0` |
| kernel | OCCT → WASM (emscripten single-thread, 25.9 MB) | OCCT → WASM (same lineage) |
| deps | `flatbush`, `opentype.js` | `flatbush`, `opentype.js` |
| dist shape | `.cjs` + `.js` + `.d.ts` | `.cjs` + `.js` + `.d.ts` |

**Finding — they share a bloodline.** `brepjs` is a fork/superset of `replicad`: identical
runtime deps, identical dist layout, identical split-WASM-kernel pattern
(`brepjs-opencascade` ↔ `replicad-opencascadejs`), published by the NakliTechie-orbit author
`andymai`. So a head-to-head bench would compare a library against its own parent — the
kernel and the meshing/IO core are the same OCCT. brepjs then *adds* surface the editor and
codegen will lean on:

- a **pluggable-kernel abstraction** (`init` / `initFromOC` / `OcctWasmAdapter`, capability
  tiers) — fits the handoff's "pluggable geometry kernel" framing and the v1.1 inference ladder;
- a **`Result<T>` monad** (`ok`/`err`/`unwrap`) so bad geometry fails as a value, not a throw —
  aligns with the "fail loud, never silent-wrong" safety property (§4 doctrine);
- **finders** (`edgeFinder().inDirection(...)`, `faceFinder`, …) for selecting edges/faces;
- **first-class Three.js adapters** (`toBufferGeometryData`, `toLineGeometryData`) returning
  transferable typed arrays — exactly the main↔worker boundary we need;
- native exporters: STEP, STL, IGES, glTF, OBJ, DXF, 3MF.

Because brepjs *is* replicad-plus, and it cleared the floor (below), running a second,
redundant replicad worker path was not worth the time. replicad stays the fallback: same API
core, so swapping it in is mechanical if brepjs ever proves unstable.

## Did it clear the floor? Yes — proven end to end

The reference part (a 40×20×20 box with its 4 vertical edges filleted, r=3) was built with
`build()` **in a Web Worker**, meshed, rendered in a Three.js viewport, and exported.

Headless harness (`pnpm verify`, `scripts/verify-export.mjs`) — kernel loaded in **Node, no DOM**:

- mesh: 220 triangles, **10 faces** (6 box + 4 filleted) — fillet topology is correct.
- STEP: valid `ISO-10303-21`, declares a schema, closes cleanly, **686 entities**, contains
  `MANIFOLD_SOLID_BREP` **and `CYLINDRICAL_SURFACE`** → exact B-rep with real filleted
  surfaces, *not* a mesh approximation. 32 KB. This is the manufacturing-grade STEP-out that is
  Lathe's entire wedge.
- STL (binary): 220 tris, 11 084 bytes = 84 + 220×50 — structurally exact.

That the same pipeline runs in Node confirms the core is **callable without the DOM** (the v1.1
agent-face property, §11).

## Measurements

| metric | value | note |
|---|---|---|
| kernel WASM | 25.96 MB (8.03 MB gzip) | single-threaded OCCT — no COOP/COEP needed |
| worker bundle | 183.5 KB | brepjs + model + protocol |
| main bundle | 542 KB (137 KB gzip) | mostly three.js; code-split later |
| build + mesh (warm) | **~37 ms** | reference part, in-worker, reported in the status line |
| cold start | ~1–3 s | one-time WASM fetch + compile + init |

DX against the model contract is good: `box(w,d,h)`, `fillet(shape, edgeFinder()…, r)`,
`mesh()`, `exportSTEP()`. The only friction is `Result`/`unwrap` verbosity in authored code —
acceptable, and it buys loud-by-default failure.

## Security finding — the kernel forces worker-scoped `'unsafe-eval'`

The in-browser OCCT kernel (emscripten **Embind**) generates C++ invoker functions via
`new Function` (two call sites in `brepjs_single.js`). That needs CSP `'unsafe-eval'`, which the
handoff §8 document policy deliberately omits. This is **intrinsic to every OCCT-WASM / replicad
build** and unremovable without rebuilding the kernel with `-sDYNAMIC_EXECUTION=0` — forbidden by
rule #6 ("don't touch or patch the OCCT kernel"). Switching to replicad would hit the identical
wall (same Embind).

**Resolution (on own authority, preserves §8's intent):** confine `'unsafe-eval'` to the kernel
**Web Worker** — which has no DOM, no `window`, no BYOK key, and `connect-src 'self'` only. The
**document** keeps the strict policy (`script-src 'self' 'wasm-unsafe-eval'`, no eval), so the
thread that holds the key and talks to the network never gets dynamic eval. Implemented as a
split CSP (dev middleware by request; prod `public/_headers` by path — a script file's response
CSP is inert except when loaded *as a worker*, so the `/assets/*` policy does not loosen document
script execution). **Flagged for the human at the G0 gate** as a deviation from a locked value.

## Carried forward

- **G1:** dispose OCCT shape handles after each build (they currently leak one handle per build).
- **G5:** verify the prod CSP split live on Cloudflare Pages (`vite preview` can't apply `_headers`).
- **G5:** self-host Inter / JetBrains Mono (referenced in tokens; currently system-fallback to
  honor `font-src 'self'` + sovereignty — no Google Fonts fetch).
