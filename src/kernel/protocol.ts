/**
 * Main ↔ kernel-worker message protocol.
 *
 * The worker owns the OCCT WASM kernel and the model contract: it builds a model
 * with `build(params)`, meshes the result, and exports STEP/STL — all off the main
 * thread. This protocol is the ONLY surface between the DOM side and the kernel.
 * Keeping it small and data-only (typed arrays / ArrayBuffers, no live objects) is
 * what lets the same pipeline run headless later (v1.1 agent face).
 */

export type Vec3 = [number, number, number];

/** Params are a flat record of JSON-serialisable primitives (model contract §4). */
export type Params = Record<string, number | boolean | string>;

/* ---- requests (main → worker) ---- */

export interface InitRequest {
  id: number;
  kind: "init";
}
export interface BuildRequest {
  id: number;
  kind: "build";
  /** Overrides merged over the model's declared defaults. */
  params: Params;
}
export interface ExportRequest {
  id: number;
  kind: "export";
  format: "step" | "stl";
  params: Params;
}
export type Request = InitRequest | BuildRequest | ExportRequest;

/* ---- responses (worker → main) ---- */

/** Triangle geometry ready to drop into a THREE.BufferGeometry. */
export interface GeometryPayload {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
  bbox: { min: Vec3; max: Vec3 };
  solidCount: number;
  faceCount: number;
  triangleCount: number;
}

export interface InitOk {
  id: number;
  ok: true;
  kind: "init";
  /** Kernel banner / version string, for the status line. */
  kernel: string;
}
export interface BuildOk {
  id: number;
  ok: true;
  kind: "build";
  geometry: GeometryPayload;
  /** Wall-clock build+mesh time in ms. */
  ms: number;
}
export interface ExportOk {
  id: number;
  ok: true;
  kind: "export";
  format: "step" | "stl";
  data: ArrayBuffer;
  mime: string;
  filename: string;
  solidCount: number;
  faceCount: number;
}
export interface Failure {
  id: number;
  ok: false;
  kind: Request["kind"];
  /** Human-readable error — surfaced loudly, never swallowed. */
  error: string;
}
export type Response = InitOk | BuildOk | ExportOk | Failure;
