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

/**
 * A param value. Primitives become controls directly; a `string[]` declares an enum
 * (rendered as a select, default = first). build() always receives the resolved scalar.
 */
export type ParamValue = number | boolean | string | string[];
/** Params are a flat record (model contract §4). */
export type Params = Record<string, ParamValue>;

/* ---- requests (main → worker) ---- */

export interface InitRequest {
  id: number;
  kind: "init";
}
/** Compile model source, make it the current model, and build it. The editor's Run. */
export interface RunRequest {
  id: number;
  kind: "run";
  source: string;
  /** Overrides merged over the model's declared defaults (empty = use defaults). */
  params: Params;
}
export interface BuildRequest {
  id: number;
  kind: "build";
  /** Re-run the *current* model with these param overrides (param-panel edits). */
  params: Params;
}
export interface ExportRequest {
  id: number;
  kind: "export";
  format: "step" | "stl";
  params: Params;
}
export type Request = InitRequest | RunRequest | BuildRequest | ExportRequest;

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
export interface RunOk {
  id: number;
  ok: true;
  kind: "run";
  geometry: GeometryPayload;
  /** The model's declared `params` defaults — drives the param panel (G3). */
  params: Params;
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
  /** Which stage failed, for the error region. */
  phase?: "compile" | "build" | "mesh" | "export";
  /** 1-based source line, when the error carries a location (compile errors). */
  line?: number;
}
export type Response = InitOk | RunOk | BuildOk | ExportOk | Failure;
