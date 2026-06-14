# Lathe — Vision & Roadmap

*Browser-native, sovereign, agent-native CAD where the code is the model.*

---

## 1. What Lathe is

Lathe is a browser application for designing manufacturable parts by writing — or
prompting an agent to write — parametric code. The geometry kernel (OpenCASCADE,
compiled to WebAssembly) runs **in the tab**. You open a URL, describe or code a
part, the kernel executes it deterministically, and you export STEP (for
manufacturing) and STL (for printing). Nothing is uploaded. The model is a small
text file you own.

Three ways to drive the same model, in one front end:

1. **Write code** — a parametric model module (TS/JS).
2. **Drag params** — named values in the model surface as sliders/inputs; tweak, re-run live.
3. **Prompt** — describe a part in plain language; a BYOK model writes the code into the editor and runs it.

The agent face (v1.1) is the same build pipeline with the UI removed — a
programmatic and MCP surface, not a different product.

---

## 2. Why this exists — the wedge

**The CAD moat is the geometry kernel, not the software.** A B-rep solid modeler
that does exact NURBS surfaces, booleans, fillets, and clean STEP export is
decades-deep. Two licensed kernels (Siemens Parasolid, Dassault/Spatial ACIS) sit
under most of the industry. UI is replaceable; the kernel and the file formats
(DWG proprietary; STEP/IGES neutral) are the lock-in. We do **not** reimplement a
kernel — we adopt the open one (OCCT) and own the surface and the shape.

Two players define the boundaries of the opportunity:

- **NASSCAD** already ships the single-file, offline, no-login browser CAD — but on
  Manifold (mesh/CSG). It's triangles, not exact surfaces: great for 3D printing,
  no clean manufacturing handoff. The maker/CSG end of the browser is occupied.
  Lathe is deliberately the **B-rep, manufacturing-grade** end (STEP out), where
  browser-native is still empty.
- **Zoo** (ex-KittyCAD) runs the exact playbook — API-first, agent-callable + human
  UI, AI-native, new kernel — but made the un-sovereign choice: the geometry
  engine runs on *their* GPUs and streams the 3D view back as a video element over
  WebSockets. The model lives in their cloud.

**Lathe is Zoo's pitch, on-device.** Geometry never leaves the tab. That single
fact is the moat, and it's only affordable because the model is text: the same
"code is the model" decision makes the agent face clean and the commercial collab
server cheap (sync text, not geometry).

---

## 3. Audience — who becomes themselves here

The sovereignty-minded engineer or maker who opted out of the subscription-and-cloud
lock-in (Fusion, SolidWorks, Onshape) and wants to own their geometry, their
toolchain, and their files. People who think in parameters and would rather their
CAD be a versionable text artifact than a binary in someone's cloud. Hardware
people who already live in code and want their design tool to meet them there —
and want an agent to do the first draft without shipping the part to a vendor.

This is a worldview, not a demographic: ownership, continuity, sovereignty, craft.

---

## 4. Doctrine fit

**Sovereign invariants (v1.0, non-negotiable):** zero server, zero accounts, zero
telemetry. You own the storage (files on your disk via FSA). BYOK key never leaves
the browser, never persisted server-side (VaultMind pattern).

**Edge-First, applied honestly:**

- **Geometry is always local**, in-tab WASM. This is where the sovereignty story
  lives and it never escalates to a server.
- **Codegen rides the inference ladder**, but the honest default is **BYOK cloud
  (C1)** — the quality floor for valid manufacturable CAD code is high and small
  local models won't clear it initially. L1 (Ollama coder via nakli-local-bridge)
  is the v1.1 elevation rung; L2 (Transformers.js) is aspirational for this task.
  Local-first is a stance, not dogma that ships a worse part.
- **Safety property:** typed authoring API + deterministic kernel means a bad
  codegen fails *loud* (compile error / kernel exception), never silent-wrong.
  That is what makes "let a model write your CAD" acceptable.

**"Single HTML file" bends here, on purpose.** The OCCT WASM blob is a multi-MB
asset loaded alongside the HTML (the same way NASSCAD serves its Manifold blob and
OpenGeometry serves its kernel). The signature constraint relaxes from *literally
one file* to **static assets, zero backend, operator-less**. Every sovereignty
invariant still holds. This is called out because it's a real relaxation of the
portfolio's headline constraint.

---

## 5. Roadmap

### v1.0 — the anchor (full spec in the Agent Handoff)
Editor + kernel + Three.js viewport + STEP/STL export + BYOK prompt→code + param
panel + save-to-disk (FSA). **The differentiation ships here**: natural-language →
manufacturable model, computed locally, sovereign. Same URL, same codebase as
later milestones.

### v1.1 — activate the scaffolds
- **Local inference rung** — nakli-local-bridge → Ollama; the L2→L1 elevation flow.
- **The agent face** — headless op runner + MCP server: `{spec | params}` →
  `{STEP, mesh, png, errors}`, drivable by Claude Code / Cursor. The programmatic
  twin of the editor over the same `build(params)` → kernel pipeline. (Prior art:
  ShapeItUp already exposes Replicad/OCCT as an MCP server for coding agents — the
  shape is proven; Lathe's is sovereign and shares the editor's core.)

### v1.x / v2 — depth
- **Constraint sketching** surface that compiles to the model contract (2D profile
  → code), for users who won't hand-author sketches.
- **Assemblies** — multiple model modules positioned in a scene; exploded views.
- **2D drawings** — projected views + dimensions from a solid (the manufacturing
  paperwork layer).
- **Import** — STEP/IGES in (round-trip from other tools), not just export out.
- **Measurement & inspection** — distances, interferences, mass properties from
  the kernel.

### v3 — reach
- **Native surface** where the job needs OS-level reach (Mac via the Swift track),
  if a workflow demands it. Browser stays primary.
- **Manufacturing-aware codegen** — local/BYOK models tuned on the model-contract
  corpus once the dataset exists.

---

## 6. Commercial fork — server-side collaboration *(on the horizon; different architecture)*

A separate company carries the enterprise packaging that justifies server infra the
sovereign side forbids. **Name deferred.**

**The sharpening that matters:** because Lathe's models are code (text), the
commercial server is a **sync + identity + lock + admin layer, not a geometry
server**. Geometry still computes client-side in every browser via the WASM kernel —
Edge-First holds even on the commercial side. Zoo *has to* run engines server-side;
we sync text. "Code is the model" pays off a third time.

**What the server actually does:**

- **Shared spaces** — repos of model files (code).
- **File locks** — PLM-style checkout/check-in. One writer; others read-only or
  branched until release. **Not** Google-Docs live co-edit: silently merging two
  people's geometry code is how you ship a broken bracket. Locking is the correct,
  deliberate choice.
- **Admin / SSO / retention / procurement paper** — the packaging.
- **Audit** — every change is a signed diff (who / what / when) on an append-only
  ledger. Nearly free because models are text. Same shape as Docket's hash-chained
  log and the Tape pattern.

| Shared spine (with sovereign Lathe) | Forked (commercial only) |
|---|---|
| Kernel (occt-wasm), authoring API (brepjs/chosen), Three.js render, codegen (nakli-ai), the model contract | Persistence + sync + collab layer (shared spaces, locks, audit); admin/SSO; the billing path |

**Stack:** Bun / TypeScript — shares types with the TS client across the wire,
realtime over WebSockets, matches the Wharf posture. Not Rails here: the payload is
code + presence, and type-sharing across the boundary is the win.

**Billing:** Razorpay (India) + Stripe Netherlands proxy (international).

**The boundary is the relay, not the codebase.** Sovereign Lathe saves to your disk
and never phones home; the commercial sibling runs a real backend with real billing.
They share the spine; they never share the server. The moment sovereign Lathe routes
through a retaining server, it stops being sovereign.

---

## 7. What Lathe is NOT

- Not a geometry server. Geometry computes client-side, always.
- Not another browser CSG/mesh toy — NASSCAD owns that end. Lathe is B-rep, STEP-out.
- Not a new CAD DSL — author in TS/JS. A bespoke language is a training-data desert
  (the reason Zoo's KCL needs Zoo's own tuned model).
- Not live multiplayer co-edit of model code (that's the commercial fork's file-lock
  territory, and silent geometry merges are dangerous).
- Not telemetry-bearing. No analytics, ever.

---

## 8. Build vs adopt

- **Adopt, don't touch:** OCCT kernel via opencascade.js / occt-wasm; Three.js
  render; the kernel's native STEP/IGES/STL/glB exporters.
- **Build:** the editor shell, the model contract + param extraction, the codegen
  wiring (nakli-ai + VaultMind), the sovereign shape, and (v1.1) the headless/MCP
  agent surface.
- **Defer:** the commercial collab server (composes private-mesh Identity / Grant /
  Sync / History; sovereign v1.0 needs none of them).
