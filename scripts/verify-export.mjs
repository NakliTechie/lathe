/**
 * Headless verification harness (G1). Proves the kernel pipeline is callable WITHOUT
 * a DOM (the v1.1 agent-face property, §11): loads OCCT in Node and exercises every
 * required primitive, the reference part's STEP/STL, and the re-run loop's handle
 * discipline. Exits non-zero on failure. Run: `node scripts/verify-export.mjs`.
 */
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import initOCCT from "brepjs-opencascade/src/brepjs_single.js";
import {
  initFromOC, box, cylinder, fuse, cut, intersect, fillet, translate, edgeFinder,
  unwrap, mesh, exportSTEP, exportSTL, getDisposalStats,
} from "brepjs";

const wasmPath = fileURLToPath(
  new URL("../node_modules/brepjs-opencascade/src/brepjs_single.wasm", import.meta.url),
);

let failures = 0;
function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "  ok " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const triCount = (s) => mesh(s, { tolerance: 0.1, cache: false }).triangles.length / 3;
const faceCount = (s) => mesh(s, { tolerance: 0.1, cache: false }).faceGroups.length;

console.log("Lathe — headless kernel verification (G1)\n");
initFromOC(await initOCCT({ locateFile: () => wasmPath }));
console.log("kernel: OCCT initialised in Node (no DOM)\n");

// --- the reference part: a mounting bracket (matches src/models/reference.ts) ---
function bracket(p) {
  let solid = box(p.width, p.depth, p.height);
  solid = unwrap(fillet(solid, edgeFinder().inDirection([0, 0, 1]), p.fillet));
  const drill = translate(cylinder(p.holeRadius, p.height + 2), [p.width / 2, p.depth / 2, -1]);
  return unwrap(cut(solid, drill));
}
const P = { width: 40, depth: 30, height: 12, holeRadius: 4, fillet: 3 };

console.log("primitives:");
check("box", triCount(box(10, 10, 10)) > 0);
check("cylinder", triCount(cylinder(5, 10)) > 0);
check("fillet adds faces", faceCount(unwrap(fillet(box(10, 10, 10), edgeFinder().inDirection([0, 0, 1]), 2))) > 6);
check("union (fuse)", triCount(unwrap(fuse(box(10, 10, 10), translate(box(10, 10, 10), [6, 6, 6])))) > 0);
check("cut", triCount(unwrap(cut(box(10, 10, 10), translate(cylinder(3, 30), [5, 5, -10])))) > 0);
{
  const overlap = unwrap(intersect(box(10, 10, 10), translate(box(10, 10, 10), [5, 5, 5])));
  const m = mesh(overlap, { tolerance: 0.1, cache: false });
  const xs = [];
  for (let i = 0; i < m.vertices.length; i += 3) xs.push(m.vertices[i]);
  check("intersect (5×5×5 overlap)", Math.round(Math.max(...xs) - Math.min(...xs)) === 5, `x-span ${Math.round(Math.max(...xs) - Math.min(...xs))}`);
}

console.log("\nreference part (bracket):");
const part = bracket(P);
check("bracket meshes", triCount(part) > 0, `${triCount(part)} tris, ${faceCount(part)} faces`);

const step = await unwrap(exportSTEP(part)).text();
check("STEP: ISO-10303-21 header", step.startsWith("ISO-10303-21;"));
check("STEP: closes cleanly", step.trimEnd().endsWith("END-ISO-10303-21;"));
check("STEP: declares a schema", /FILE_SCHEMA\s*\(\s*\(\s*'[^']+'/.test(step));
check("STEP: B-rep solid entities", /MANIFOLD_SOLID_BREP|ADVANCED_BREP_SHAPE_REPRESENTATION|CLOSED_SHELL/.test(step));
check("STEP: cylindrical (fillet + hole) surfaces", /CYLINDRICAL_SURFACE/.test(step));
const entityCount = (step.match(/^#\d+\s*=/gm) || []).length;
check("STEP: non-trivial entity count", entityCount > 50, `${entityCount} entities`);

const stl = new Uint8Array(await unwrap(exportSTL(part, { binary: true })).arrayBuffer());
const triN = new DataView(stl.buffer).getUint32(80, true);
check("STL: binary size exact", stl.length === 84 + triN * 50, `${triN} tris`);

// --- re-run loop: brepjs GC-manages OCCT handles (FinalizationRegistry). Build many
//     times, letting GC run, and assert handles stay BOUNDED (plateau) rather than
//     growing linearly — i.e. the re-run loop does not leak. Needs --expose-gc
//     (`pnpm verify` provides it); the in-app worker also disposes deterministically
//     via runInScope (src/kernel/cad.ts). ---
console.log("\nre-run loop (200 builds, GC-managed handles):");
for (let i = 0; i < 200; i++) {
  mesh(bracket({ ...P, holeRadius: 2 + (i % 6) }), { tolerance: 0.2, cache: false });
  if (i % 20 === 0) {
    globalThis.gc?.();
    await new Promise((r) => setTimeout(r, 0));
  }
}
globalThis.gc?.();
await new Promise((r) => setTimeout(r, 20));
globalThis.gc?.();
const st = getDisposalStats();
check("handles bounded — no linear leak", st.peakHandles < 200 * 16, `peak ${st.peakHandles} « cap ${200 * 16}`);
check("GC reclaims handles", st.gcCollected > 200, `gcCollected ${st.gcCollected}`);
console.log("  disposal stats:", JSON.stringify(st));

// Save reference exports for manual FreeCAD inspection (G1 artifact).
writeFileSync(join(tmpdir(), "lathe-reference.step"), step);
writeFileSync(join(tmpdir(), "lathe-reference.stl"), stl);
console.log(`\nwrote ${join(tmpdir(), "lathe-reference.step")} (${entityCount} entities, ${step.length} bytes)`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
