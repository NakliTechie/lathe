/**
 * The kernel Web Worker. Owns the OCCT WASM kernel AND compiles the model: a model is
 * source text (the editor's contents / codegen output). The worker transpiles it
 * (sucrase: TS → JS, ESM → CJS), evaluates it with the CAD API injected, then runs
 * `build(params)`, meshes, and exports — all off the main thread, no DOM, no network.
 *
 * Why eval is safe here: the worker has no DOM, no `window`, and `connect-src 'self'`;
 * its reachable surface is the CAD API + the params. Network-fetched codegen is written
 * into the editor and run through THIS same path — never eval'd from a remote source
 * (rule #5). The 'unsafe-eval' the kernel already needs (Embind) is confined here.
 */
import initOCCT from "brepjs-opencascade/src/brepjs_single.js";
import wasmUrl from "brepjs-opencascade/src/brepjs_single.wasm?url";
import { initFromOC, mesh, toBufferGeometryData, exportSTEP, exportSTL, unwrap } from "brepjs";
import { transform } from "sucrase";
import { runInScope, cadAPI, type Shape } from "./cad";
import type { Request, Response, GeometryPayload, Params, Vec3 } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// The generated .d.ts types the factory as `init(): Promise<…>` (no args), but it
// takes module options — we need `locateFile` to point at the .wasm.
type OCCT = Awaited<ReturnType<typeof initOCCT>>;
const loadOCCT = initOCCT as unknown as (opts?: {
  locateFile?: (path: string) => string;
}) => Promise<OCCT>;

let initialized = false;
async function init(): Promise<string> {
  if (initialized) return "OCCT · brepjs";
  const OC = await loadOCCT({ locateFile: () => wasmUrl }); // last use of fetch (the .wasm)
  initFromOC(OC as Parameters<typeof initFromOC>[0]);
  lockdownGlobals();
  initialized = true;
  return "OCCT · brepjs";
}

/**
 * Deny model code the obvious network-egress globals. The ENFORCED boundary is CSP
 * `connect-src 'self'` — a model (even via a nested blob worker, which inherits this
 * worker's policy) cannot reach off-origin. This just removes casual access; the
 * worker itself needs none of these once the WASM has loaded.
 */
function lockdownGlobals(): void {
  const deny = (name: string) => {
    try {
      Object.defineProperty(ctx, name, {
        value: () => {
          throw new Error(`${name} is unavailable to model code — geometry stays local (no network).`);
        },
        configurable: true,
        writable: true,
      });
    } catch {
      /* non-configurable in this runtime — CSP still enforces the boundary */
    }
  };
  ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"].forEach(deny);
}

/* ---- model compilation ---- */

type Phase = "compile" | "build" | "mesh" | "export";
class ModelError extends Error {
  constructor(readonly phase: Phase, message: string, readonly line?: number) {
    super(message);
  }
}
function asModelError(phase: Phase, err: unknown): ModelError {
  if (err instanceof ModelError) return err;
  const message = err instanceof Error ? err.message : String(err);
  // sucrase parse errors read like "... (line:col)"; pull the line out for the editor.
  const m = /\((\d+):\d+\)\s*$/.exec(message);
  return new ModelError(phase, message, m ? Number(m[1]) : undefined);
}

interface CompiledModel {
  params: Params;
  build: (p: Params) => unknown;
}
let currentModel: CompiledModel | null = null;

const CAD_NAMES = Object.keys(cadAPI);
const CAD_VALUES = Object.values(cadAPI);

function requireShim(spec: string): unknown {
  // Models don't need imports — the CAD API is in scope. Tolerate `import … from "brepjs"`.
  if (spec === "brepjs" || spec === "lathe" || spec.endsWith("/cad") || spec === "cad") return cadAPI;
  throw new ModelError("compile", `Cannot import "${spec}" in a model — the CAD API is available directly (box, cylinder, cut, fillet, …).`);
}

function compileModel(source: string): CompiledModel {
  let code: string;
  try {
    code = transform(source, { transforms: ["typescript", "imports"], production: true }).code;
  } catch (err) {
    throw asModelError("compile", err);
  }
  const exportsObj: Record<string, unknown> = {};
  const moduleObj = { exports: exportsObj };
  try {
    const factory = new Function("exports", "require", "module", ...CAD_NAMES, code);
    factory(exportsObj, requireShim, moduleObj, ...CAD_VALUES);
  } catch (err) {
    throw asModelError("compile", err);
  }
  const ns = (moduleObj.exports && moduleObj.exports !== exportsObj ? moduleObj.exports : exportsObj) as Record<string, unknown>;
  if (typeof ns.build !== "function") {
    throw new ModelError("compile", "Model must export a `build(params)` function.");
  }
  if (ns.params == null || typeof ns.params !== "object") {
    throw new ModelError("compile", "Model must export a `params` object.");
  }
  return { params: ns.params as Params, build: ns.build as (p: Params) => unknown };
}

/** Merge overrides over declared defaults; an enum (string[]) resolves to the chosen
 *  option, or its first entry. build() always sees scalar params. */
function resolveParams(declared: Params, overrides: Params): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(declared)) {
    if (Array.isArray(v)) out[k] = (overrides[k] as string | undefined) ?? v[0];
    else out[k] = overrides[k] ?? v;
  }
  return out;
}

function buildShape(model: CompiledModel, params: Params): Shape {
  let out: unknown;
  try {
    out = model.build(resolveParams(model.params, params));
  } catch (err) {
    throw asModelError("build", err);
  }
  const shape = Array.isArray(out) ? out[0] : out; // single shape for now (multi-shape later)
  if (!shape || typeof shape !== "object") {
    throw new ModelError("build", "build() must return a shape (or an array of shapes).");
  }
  return shape as Shape;
}

function meshToGeometry(shape: Shape): GeometryPayload {
  let m;
  try {
    m = mesh(shape, { tolerance: 0.05, angularTolerance: 0.25, cache: false });
  } catch (err) {
    throw asModelError("mesh", err);
  }
  const data = toBufferGeometryData(m);
  return {
    position: data.position,
    normal: data.normal,
    index: data.index,
    bbox: bboxOf(data.position),
    solidCount: 1,
    faceCount: m.faceGroups.length,
    triangleCount: data.index.length / 3,
  };
}

function bboxOf(pos: Float32Array): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = pos[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

function requireModel(): CompiledModel {
  if (!currentModel) throw new ModelError("build", "No model loaded — Run a model first.");
  return currentModel;
}

/* ---- message handling ---- */

ctx.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    switch (req.kind) {
      case "init": {
        const kernel = await init();
        reply({ id: req.id, ok: true, kind: "init", kernel });
        break;
      }
      case "run": {
        await init();
        const t0 = performance.now();
        const model = compileModel(req.source); // ModelError("compile") on failure
        currentModel = model;
        const geometry = runInScope(() => meshToGeometry(buildShape(model, req.params)));
        const ms = performance.now() - t0;
        reply({ id: req.id, ok: true, kind: "run", geometry, params: model.params, ms }, [
          geometry.position.buffer,
          geometry.normal.buffer,
          geometry.index.buffer,
        ]);
        break;
      }
      case "build": {
        await init();
        const model = requireModel();
        const t0 = performance.now();
        const geometry = runInScope(() => meshToGeometry(buildShape(model, req.params)));
        const ms = performance.now() - t0;
        reply({ id: req.id, ok: true, kind: "build", geometry, ms }, [
          geometry.position.buffer,
          geometry.normal.buffer,
          geometry.index.buffer,
        ]);
        break;
      }
      case "export": {
        await init();
        const model = requireModel();
        const { blob, mime, filename, faceCount } = runInScope(() => {
          const shape = buildShape(model, req.params);
          const faces = mesh(shape, { tolerance: 0.05, angularTolerance: 0.25, cache: false }).faceGroups.length;
          try {
            if (req.format === "step") {
              return { blob: unwrap(exportSTEP(shape)), mime: "application/step", filename: "lathe-part.step", faceCount: faces };
            }
            return { blob: unwrap(exportSTL(shape, { binary: true })), mime: "model/stl", filename: "lathe-part.stl", faceCount: faces };
          } catch (err) {
            throw asModelError("export", err);
          }
        });
        const data = await blob.arrayBuffer();
        reply(
          { id: req.id, ok: true, kind: "export", format: req.format, data, mime, filename, solidCount: 1, faceCount },
          [data],
        );
        break;
      }
    }
  } catch (err) {
    const me = err instanceof ModelError ? err : asModelError("build", err);
    reply({ id: req.id, ok: false, kind: req.kind, error: me.message, phase: me.phase, line: me.line });
  }
};

function reply(res: Response, transfer: Transferable[] = []): void {
  ctx.postMessage(res, transfer);
}
