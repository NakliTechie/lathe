/**
 * The reference part — and the canonical demonstration of the model contract (§4).
 *
 * A Lathe model is a module that exports `params` (defaults → param-panel controls)
 * and `build(p)` (returns one shape or an array of shapes). The same module is what
 * the editor runs, what the param panel drives, and what the v1.1 agent face calls
 * headlessly. Authored against the brepjs functional API (via ../kernel/cad) — no DSL.
 *
 * This one is a mounting bracket: a rounded-corner plate with a centred through-hole —
 * it exercises box, cylinder, fillet, and a boolean cut in a believable manufacturable part.
 */
import { box, cylinder, cut, fillet, translate, edgeFinder, unwrap } from "../kernel/cad";

export const params = {
  width: 40,
  depth: 30,
  height: 12,
  holeRadius: 4,
  fillet: 3,
};

export function build(p: typeof params) {
  // Plate, corner at the origin, extending into +X/+Y/+Z.
  let solid = box(p.width, p.depth, p.height);

  // Round the four vertical (Z-direction) edges.
  if (p.fillet > 0) {
    solid = unwrap(fillet(solid, edgeFinder().inDirection([0, 0, 1]), p.fillet));
  }

  // Drill a centred hole straight through Z. The cylinder is XY-centred at the origin,
  // so translate it to the plate centre; over-length so it cleanly clears both faces.
  if (p.holeRadius > 0) {
    const drill = translate(cylinder(p.holeRadius, p.height + 2), [p.width / 2, p.depth / 2, -1]);
    solid = unwrap(cut(solid, drill));
  }

  return solid;
}
