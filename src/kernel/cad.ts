/**
 * The CAD authoring surface — the API a Lathe model writes against (model contract §4).
 *
 * It re-exports the brepjs functional API verbatim (same names, same signatures — no
 * bespoke DSL, per rule #2) with one thing woven in: every shape a model creates is
 * registered to an ambient disposal scope. `runInScope(fn)` opens that scope; when it
 * returns, the model's OCCT shape handles are deleted deterministically. (brepjs also
 * GC-collects handles via FinalizationRegistry — verified bounded over 200 builds — so
 * this scope is hygiene + lower peak memory, not the only safety net.)
 *
 * This is also how user-authored model code (G2) gets the API: these exports are the
 * identifiers injected into the model's scope.
 */
import {
  box as _box,
  cylinder as _cylinder,
  sphere as _sphere,
  cone as _cone,
  fuse as _fuse,
  cut as _cut,
  intersect as _intersect,
  fillet as _fillet,
  chamfer as _chamfer,
  shell as _shell,
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

interface Deletable {
  delete: () => void;
}

let current: Set<Deletable> | null = null;

/**
 * Run `fn` inside an ambient disposal scope. Shapes produced by the authoring ops
 * below are deleted when `fn` returns (on success or throw). The mesh/STEP/STL bytes
 * a caller extracts before returning are plain data and survive.
 */
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
function track<T>(shape: T): T {
  if (current && isDeletable(shape)) current.add(shape);
  return shape;
}
function trackResult<T>(result: T): T {
  if (isOk(result as never)) track(unwrap(result as never));
  return result;
}

const wrapShape = <F extends (...a: never[]) => unknown>(fn: F): F =>
  ((...a: never[]) => track(fn(...a))) as F;
const wrapResult = <F extends (...a: never[]) => unknown>(fn: F): F =>
  ((...a: never[]) => trackResult(fn(...a))) as F;

/* Primitives + transforms return a shape directly. */
export const box = wrapShape(_box);
export const cylinder = wrapShape(_cylinder);
export const sphere = wrapShape(_sphere);
export const cone = wrapShape(_cone);
export const translate = wrapShape(_translate);
export const rotate = wrapShape(_rotate);
export const scale = wrapShape(_scale);
export const mirror = wrapShape(_mirror);

/* Booleans + edge ops return Result<Shape> — unwrap to fail loud, track the value. */
export const fuse = wrapResult(_fuse);
export const cut = wrapResult(_cut);
export const intersect = wrapResult(_intersect);
export const fillet = wrapResult(_fillet);
export const chamfer = wrapResult(_chamfer);
export const shell = wrapResult(_shell);

export { edgeFinder, faceFinder, unwrap, isOk, isErr };
