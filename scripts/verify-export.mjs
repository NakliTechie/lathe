/**
 * Headless verification harness — proves the kernel pipeline is callable WITHOUT a
 * DOM (the v1.1 agent-face property, §11): load OCCT in Node, build the reference
 * part, export STEP + STL, and structurally validate the bytes. Exits non-zero on
 * failure. Run: `node scripts/verify-export.mjs`.
 */
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import initOCCT from "brepjs-opencascade/src/brepjs_single.js";
import { initFromOC, box, fillet, edgeFinder, unwrap, exportSTEP, exportSTL, mesh } from "brepjs";

const wasmPath = fileURLToPath(
  new URL("../node_modules/brepjs-opencascade/src/brepjs_single.wasm", import.meta.url),
);

let failures = 0;
function check(label, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : "FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

console.log("Lathe — headless kernel verification\n");

const OC = await initOCCT({ locateFile: () => wasmPath });
initFromOC(OC);
console.log("kernel: OCCT initialised in Node (no DOM)\n");

// Same geometry as src/models/reference.ts.
const solid = unwrap(fillet(box(40, 20, 20), edgeFinder().inDirection([0, 0, 1]), 3));

// --- mesh ---
const m = mesh(solid, { tolerance: 0.05, angularTolerance: 0.25, cache: false });
check("mesh: has triangles", m.triangles.length > 0, `${m.triangles.length / 3} tris`);
check("mesh: 10 faces (6 box + 4 filleted)", m.faceGroups.length === 10, `${m.faceGroups.length} faces`);

// --- STEP ---
const stepBlob = unwrap(exportSTEP(solid));
const step = await stepBlob.text();
check("STEP: ISO-10303-21 header", step.startsWith("ISO-10303-21;"));
check("STEP: closes cleanly", step.trimEnd().endsWith("END-ISO-10303-21;"));
check("STEP: declares a schema", /FILE_SCHEMA\s*\(\s*\(\s*'[^']+'/.test(step));
check(
  "STEP: contains B-rep solid entities",
  /MANIFOLD_SOLID_BREP|ADVANCED_BREP_SHAPE_REPRESENTATION|CLOSED_SHELL/.test(step),
);
check("STEP: has cylindrical (filleted) surfaces", /CYLINDRICAL_SURFACE/.test(step));
const entityCount = (step.match(/^#\d+\s*=/gm) || []).length;
check("STEP: non-trivial entity count", entityCount > 50, `${entityCount} entities`);

// --- STL (binary) ---
const stlBlob = unwrap(exportSTL(solid, { binary: true }));
const stl = new Uint8Array(await stlBlob.arrayBuffer());
const triN = new DataView(stl.buffer).getUint32(80, true);
check("STL: binary size matches triangle count", stl.length === 84 + triN * 50, `${triN} tris, ${stl.length} bytes`);
check("STL: non-empty", triN > 0);

// Save for manual FreeCAD inspection (G1 artifact).
const outDir = tmpdir();
const stepPath = join(outDir, "lathe-reference.step");
const stlPath = join(outDir, "lathe-reference.stl");
writeFileSync(stepPath, step);
writeFileSync(stlPath, stl);
console.log(`\nwrote ${stepPath}\nwrote ${stlPath}`);
console.log(`STEP is ${step.length} bytes, ${entityCount} entities`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
