# Lathe

> Browser-native, sovereign, parametric **code-CAD** — the code is the model, geometry
> computes in-tab via an OCCT WASM kernel, and a BYOK model can write the code from a prompt.
> STEP + STL export. No server, no accounts, no telemetry — your files, your browser.

**Status:** scaffolded, pre-G0. Not yet built.

This repo currently holds the build contract and the vision. Start here:

- **[LATHE-AGENT-HANDOFF.md](LATHE-AGENT-HANDOFF.md)** — the build spec and operating
  contract (gates G0–G5, the locked model contract, security posture, what-not-to-do).
  **This is what gets executed.**
- **[LATHE-VISION-AND-ROADMAP.md](LATHE-VISION-AND-ROADMAP.md)** — why Lathe exists, the
  wedge, the roadmap (v1.0 → v1.1 agent face → commercial fork). Context, not contract.

The user-facing product README is a **G5 deliverable** (handoff §14) and will replace this
file when the tool ships.

## Stack (decided in the handoff)

TypeScript · Vite (static output) · OCCT WASM kernel in a Web Worker · Three.js render ·
CodeMirror 6 editor · `nakli-ai` BYOK codegen (VaultMind key pattern) · Cloudflare Pages →
`lathe.naklitechie.com`. Authoring lib (brepjs vs replicad) is **decided at G0**.
