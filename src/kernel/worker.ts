/**
 * The kernel Web Worker. Owns the OCCT WASM kernel; runs the model's `build(params)`,
 * meshes the result for the viewport, and exports STEP/STL — all off the main thread
 * (hard invariant: never block the main thread with kernel ops). No DOM, no network:
 * the worker's reachable surface is the kernel API + the model, nothing else.
 */
import initOCCT from "brepjs-opencascade/src/brepjs_single.js";
import wasmUrl from "brepjs-opencascade/src/brepjs_single.wasm?url";
import { initFromOC, mesh, toBufferGeometryData, exportSTEP, exportSTL, unwrap } from "brepjs";
import { runInScope } from "./cad";
import * as reference from "../models/reference";
import type { Request, Response, GeometryPayload, Params, Vec3 } from "./protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// The generated .d.ts types the emscripten factory as `init(): Promise<…>` (no args),
// but it actually takes module options (we need `locateFile` to point at the .wasm).
type OCCT = Awaited<ReturnType<typeof initOCCT>>;
const loadOCCT = initOCCT as unknown as (opts?: {
  locateFile?: (path: string) => string;
}) => Promise<OCCT>;

type Shape = ReturnType<typeof reference.build>;
let initialized = false;

async function init(): Promise<string> {
  if (initialized) return "OCCT · brepjs";
  const OC = await loadOCCT({ locateFile: () => wasmUrl });
  initFromOC(OC as Parameters<typeof initFromOC>[0]);
  initialized = true;
  return "OCCT · brepjs";
}

/** Run the model contract: merge params over defaults, call build(), take the solid. */
function buildModel(params: Params): Shape {
  const merged = { ...reference.params, ...params } as typeof reference.params;
  const out = reference.build(merged);
  return Array.isArray(out) ? out[0] : out; // G0: single shape (arrays land in G1)
}

function meshToGeometry(shape: Shape): GeometryPayload {
  // cache:false → fresh typed arrays, so transferring their buffers can't detach a
  // mesh the kernel still holds.
  const m = mesh(shape, { tolerance: 0.05, angularTolerance: 0.25, cache: false });
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

ctx.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    switch (req.kind) {
      case "init": {
        const kernel = await init();
        reply({ id: req.id, ok: true, kind: "init", kernel });
        break;
      }
      case "build": {
        await init();
        const t0 = performance.now();
        // Build + mesh inside a disposal scope; the typed arrays survive, the shapes don't.
        const geometry = runInScope(() => meshToGeometry(buildModel(req.params)));
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
        // Serialise to the Blob inside the scope (the bytes survive; the shape is freed).
        const { blob, mime, filename, faceCount } = runInScope(() => {
          const shape = buildModel(req.params);
          const faces = mesh(shape, { tolerance: 0.05, angularTolerance: 0.25, cache: false }).faceGroups.length;
          if (req.format === "step") {
            return { blob: unwrap(exportSTEP(shape)), mime: "application/step", filename: "lathe-part.step", faceCount: faces };
          }
          return { blob: unwrap(exportSTL(shape, { binary: true })), mime: "model/stl", filename: "lathe-part.stl", faceCount: faces };
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
    reply({ id: req.id, ok: false, kind: req.kind, error: errorMessage(err) });
  }
};

function reply(res: Response, transfer: Transferable[] = []): void {
  ctx.postMessage(res, transfer);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
