/**
 * brepjs can auto-load alternative geometry kernels (`occt-wasm`, `brepkit-wasm`) via
 * dynamic `import()`. Lathe injects its kernel explicitly — `initFromOC()` with the
 * `brepjs-opencascade` WASM build — so those auto-loaders never run. We alias both
 * specifiers to this stub so the bundler has something to resolve. If one is ever
 * actually imported, fail loud rather than silently pull a second kernel.
 */
function disabled(name: string): () => never {
  return () => {
    throw new Error(
      `Lathe does not bundle the '${name}' kernel; the OCCT kernel is provided via initFromOC().`,
    );
  };
}

export const OcctKernel = { init: disabled("occt-wasm") };
export const BrepkitKernel = { init: disabled("brepkit-wasm") };
export default { OcctKernel, BrepkitKernel };
