/**
 * The G0 reference part — and the canonical demonstration of the model contract (§4).
 *
 * A Lathe model is a module that exports `params` (defaults → param-panel controls)
 * and `build(p)` (returns one shape or an array of shapes). This same shape is what
 * the editor runs, what the param panel drives, and what the v1.1 agent face calls
 * headlessly. Authored against the brepjs functional API — no bespoke DSL.
 */
import { box, fillet, edgeFinder, unwrap } from "brepjs";

export const params = {
  width: 40,
  depth: 20,
  height: 20,
  fillet: 3,
};

export function build(p: typeof params) {
  // A box, with its vertical (Z-direction) edges rounded — the reference part.
  const solid = box(p.width, p.depth, p.height);
  if (p.fillet <= 0) return solid;

  // fillet(shape, edgeSelector, radius) → Result; unwrap so a bad radius fails loud.
  return unwrap(fillet(solid, edgeFinder().inDirection([0, 0, 1]), p.fillet));
}
