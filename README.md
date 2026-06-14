# Lathe

**Browser-native, sovereign, parametric code-CAD.** The code *is* the model: you write — or
prompt an AI to write — a small parametric module, and an OpenCASCADE kernel compiled to
WebAssembly computes the geometry **in your browser tab**. Export STEP for manufacturing and STL
for printing. No server, no accounts, no telemetry. Your files, your machine; geometry never
leaves the page.

## Quickstart

Open the app, then drive the same model three ways:

- **Write code** in the left pane and press **Run** (`Cmd/Ctrl+Enter`).
- **Drag params** on the right — named values in your model become live controls.
- **Prompt** — describe a part ("a 40×20 bracket with two M4 holes") and your AI model writes the
  code into the editor.

Then **Export** STEP or STL. Save your model to disk with `Cmd/Ctrl+S`.

## The three drive modes

- **Code** — a model is a tiny JS/TS module. You have the full language; the geometry is exact B-rep.
- **Params** — every value you name in `params` is introspected into a typed control (slider,
  toggle, select). Edits re-run live; **Save to code** writes the values back into your source.
- **Prompt** — bring-your-own-key codegen. Your model writes the module against the same contract;
  a bad generation fails loud in the editor, never silently wrong.

## The model contract

A model exports `params` (its controls) and `build(p)` (which returns a shape). The CAD API
(`box`, `cylinder`, `cut`, `fuse`, `fillet`, `chamfer`, `translate`, `edgeFinder`, …) is available
directly — no imports. Distances are millimetres.

```js
export const params = { width: 40, depth: 30, height: 12, holeRadius: 4, fillet: 3 };

export function build(p) {
  let solid = box(p.width, p.depth, p.height);
  solid = fillet(solid, edgeFinder().inDirection([0, 0, 1]), p.fillet);   // round the vertical edges
  const drill = translate(cylinder(p.holeRadius, p.height + 2), [p.width / 2, p.depth / 2, -1]);
  return cut(solid, drill);                                               // drill a centred hole
}
```

The same `build(params)` → kernel pipeline runs headlessly too — it's the basis of the v1.1 agent
face (drive Lathe from Claude Code / Cursor over an MCP surface).

## Bring your own AI

Pick where codegen runs (behind the 🔑 button):

- **Anthropic** or **OpenAI** — bring your key.
- **Custom / Local** — any OpenAI-compatible endpoint you type in: a local Ollama / LM Studio
  server (`http://localhost:11434/v1/…`), OpenRouter, Together, Groq, … (key optional).
- **Local (WebGPU)** — a small coder model (Qwen2.5-Coder) runs **on your GPU, in the tab**. No
  key, and no network for inference: weights download once, then it's fully on-device.

Cloud keys are stored **in your browser only** (IndexedDB, one per provider) and sent **only to
that provider** — never to any Lathe server (there is none). A short fingerprint is shown for
recognition. Geometry is never part of any request: the kernel runs locally regardless.

## Browser support

- **Full experience on Chromium** (Chrome / Edge): WASM + WebGL2 + Web Workers + the File System
  Access API (save/open straight to disk).
- **Graceful fallback** elsewhere (Firefox / Safari): models export and open via download + file
  picker. Detect, never hard-fail.

## Export formats

- **STEP** — exact B-rep, for manufacturing (opens in FreeCAD, Fusion, SolidWorks, …).
- **STL** — triangle mesh, for 3D printing.

## Develop

```sh
pnpm install
pnpm dev        # Vite dev server
pnpm build      # static production build → dist/
pnpm verify     # headless kernel checks (no DOM): primitives, STEP/STL, re-run loop
```

Static output deploys to any static host (Cloudflare Pages target: `lathe.naklitechie.com`).
The security headers in `public/_headers` (CSP, etc.) ship with the build — see `DEPLOY.md`.

## License

Lathe's own source is © NakliTechie. The geometry kernel — `brepjs-opencascade`, an OpenCASCADE
build compiled to WebAssembly — is **LGPL-2.1** and is bundled as a *replaceable* static asset
(the WASM blob); that LGPL obligation travels with it. Adopt the kernel as-is; don't patch it.
