import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

// brepjs lazily imports alternative kernels (occt-wasm / brepkit-wasm) that Lathe
// never uses — alias them to a fail-loud stub so the bundler can resolve them.
const disabledKernel = fileURLToPath(new URL("./src/kernel/disabled-kernel.ts", import.meta.url));

// The CAD kernel is a WASM module run in a Web Worker. Vite must:
//  - bundle workers as ES modules (we use `new Worker(url, { type: "module" })`)
//  - NOT pre-bundle the OCCT-WASM package (its .wasm is loaded via ?url at runtime)
//
// CSP: the *shipped* policy lives in public/_headers (Cloudflare Pages). The dev
// server gets a parallel header so we develop against the real posture.
//
// DOCUMENT policy is strict (handoff §8): no 'unsafe-eval'. The thread that holds the
// BYOK key and talks to the network never gets dynamic-eval.
// WORKER policy adds 'unsafe-eval' — the in-browser OCCT kernel (emscripten Embind)
// generates invoker functions via `new Function`, intrinsic to every OCCT-WASM build
// and unremovable without forking the kernel (rule #6). It's confined to the kernel
// worker, which has no DOM, no window, no key, and connect-src 'self' only.
const DOC_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  // BYOK codegen calls the provider directly from the main thread (G4). The worker
  // stays 'self' — it never makes the codegen call and never sees the key.
  "connect-src 'self' ws: wss: https://api.anthropic.com",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const WORKER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

function devCsp(): Plugin {
  return {
    name: "lathe-dev-csp",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // The worker entry is fetched with Vite's ?worker_file marker (and lives at
        // kernel/worker). Its response CSP becomes the worker's policy; sub-imports
        // inherit it, so only the entry needs the permissive header.
        const url = req.url ?? "";
        const isWorker = url.includes("worker_file") || url.includes("kernel/worker");
        res.setHeader("Content-Security-Policy", isWorker ? WORKER_CSP : DOC_CSP);
        next();
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [devCsp()],
  resolve: {
    alias: {
      "occt-wasm": disabledKernel,
      "brepkit-wasm": disabledKernel,
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // The OCCT-WASM build ships a .wasm asset; let Vite serve it as-is.
    exclude: ["brepjs-opencascade", "replicad-opencascadejs"],
  },
  build: {
    target: "esnext", // top-level await + WASM
  },
});
