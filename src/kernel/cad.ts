/**
 * The CAD authoring surface — the API a Lathe model writes against (model contract §4).
 *
 * It is the brepjs functional API, lightly faced (rule #2 — author in JS against the
 * chosen lib, no DSL): clean primitive/boolean names, Results auto-unwrapped so a bad
 * operation throws *loud* (caught and surfaced, never silent-wrong, §4 doctrine), and
 * every shape registered to an ambient disposal scope.
 *
 * `runInScope(fn)` opens that scope; on return the model's OCCT handles are deleted
 * deterministically (brepjs also GC-collects — verified bounded over 200 builds).
 *
 * `cadAPI` is the same surface as a record — the identifiers injected into user model
 * code in the worker (G2). So hand-authored and AI-authored models see one API.
 */
import {
  box as _box,
  cylinder as _cylinder,
  sphere as _sphere,
  fuse as _fuse,
  cut as _cut,
  intersect as _intersect,
  fillet as _fillet,
  chamfer as _chamfer,
  translate as _translate,
  rotate as _rotate,
  scale as _scale,
  mirror as _mirror,
  edgeFinder,
  faceFinder,
  unwrap,
  isOk,
  isErr,
  isLive,
} from "brepjs";

/** An opaque CAD shape (a brepjs solid). Models build these and return them. */
export type Shape = ReturnType<typeof _box>;
export type EdgeSelector = ReturnType<typeof edgeFinder>;
export type Vec3 = [number, number, number];

interface Deletable {
  delete: () => void;
}
let current: Set<Deletable> | null = null;

/** Run `fn` inside an ambient disposal scope; shapes it creates are freed on return. */
export function runInScope<T>(fn: () => T): T {
  const previous = current;
  const bag = new Set<Deletable>();
  current = bag;
  try {
    return fn();
  } finally {
    current = previous;
    for (const shape of bag) {
      try {
        if (isLive(shape as never)) shape.delete();
      } catch {
        /* already disposed — fine */
      }
    }
  }
}

function isDeletable(v: unknown): v is Deletable {
  return !!v && typeof (v as Deletable).delete === "function";
}
function keep<T>(shape: T): T {
  if (current && isDeletable(shape)) current.add(shape);
  return shape;
}
/** Unwrap a Result (throws loud on Err) and track the shape. */
function loud(result: unknown): Shape {
  return keep(unwrap(result as never)) as Shape;
}

/* ---- primitives ---- */
export function box(width: number, depth: number, height: number): Shape {
  return keep(_box(width, depth, height));
}
export function cylinder(radius: number, height: number): Shape {
  return keep(_cylinder(radius, height));
}
export function sphere(radius: number): Shape {
  return keep(_sphere(radius));
}

/* ---- transforms (brepjs option objects forwarded as-is) ---- */
export function translate(shape: Shape, v: Vec3): Shape {
  return keep((_translate as (s: Shape, v: Vec3) => Shape)(shape, v));
}
export function rotate(shape: Shape, angle: number, options?: Parameters<typeof _rotate>[2]): Shape {
  return keep((_rotate as (s: Shape, a: number, o?: unknown) => Shape)(shape, angle, options));
}
export function scale(shape: Shape, factor: number, options?: Parameters<typeof _scale>[2]): Shape {
  return keep((_scale as (s: Shape, f: number, o?: unknown) => Shape)(shape, factor, options));
}
export function mirror(shape: Shape, options?: Parameters<typeof _mirror>[1]): Shape {
  return keep((_mirror as (s: Shape, o?: unknown) => Shape)(shape, options));
}

/* ---- booleans (auto-unwrap → fail loud) ---- */
export function fuse(a: Shape, b: Shape): Shape {
  return loud(_fuse(a as never, b as never));
}
export function cut(base: Shape, tool: Shape): Shape {
  return loud(_cut(base as never, tool as never));
}
export function intersect(a: Shape, b: Shape): Shape {
  return loud(_intersect(a as never, b as never));
}

/* ---- edge ops (auto-unwrap) ---- */
export function fillet(shape: Shape, edges: EdgeSelector, radius: number): Shape;
export function fillet(shape: Shape, radius: number): Shape;
export function fillet(shape: Shape, a: EdgeSelector | number, b?: number): Shape {
  return b === undefined ? loud((_fillet as Function)(shape, a)) : loud((_fillet as Function)(shape, a, b));
}
export function chamfer(shape: Shape, edges: EdgeSelector, distance: number): Shape;
export function chamfer(shape: Shape, distance: number): Shape;
export function chamfer(shape: Shape, a: EdgeSelector | number, b?: number): Shape {
  return b === undefined ? loud((_chamfer as Function)(shape, a)) : loud((_chamfer as Function)(shape, a, b));
}

export { edgeFinder, faceFinder, unwrap, isOk, isErr };

/** The authoring API as a record — injected into user model code in the worker. */
export const cadAPI = {
  box,
  cylinder,
  sphere,
  translate,
  rotate,
  scale,
  mirror,
  fuse,
  cut,
  intersect,
  fillet,
  chamfer,
  edgeFinder,
  faceFinder,
  unwrap,
} as const;
