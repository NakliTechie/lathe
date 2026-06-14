// A Lathe model. Export `params` — these become the controls on the right — and
// `build(p)`, which returns the shape to render and export. The CAD API (box,
// cylinder, cut, fuse, fillet, translate, edgeFinder, …) is available directly;
// no imports. Everything computes in your browser. Press Cmd/Ctrl+Enter to run.

export const params = {
  width: 40,
  depth: 30,
  height: 12,
  holeRadius: 4,
  fillet: 3,
};

export function build(p) {
  // A mounting bracket: a rounded plate with a centred through-hole.
  let solid = box(p.width, p.depth, p.height);

  // Round the four vertical edges.
  if (p.fillet > 0) {
    solid = fillet(solid, edgeFinder().inDirection([0, 0, 1]), p.fillet);
  }

  // Drill a centred hole straight down through Z.
  if (p.holeRadius > 0) {
    const drill = translate(cylinder(p.holeRadius, p.height + 2), [p.width / 2, p.depth / 2, -1]);
    solid = cut(solid, drill);
  }

  return solid;
}
