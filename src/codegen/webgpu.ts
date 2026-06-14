/**
 * On-device codegen via WebGPU (WebLLM / MLC). A small coder model runs on the user's
 * GPU, in the tab — no key, and no network for inference (weights download once, then
 * cache in the browser). This is the sovereign rung of the inference ladder: the prompt,
 * the code, and the geometry all stay on the machine.
 *
 * Loaded lazily (dynamic import from generate.ts) so WebLLM stays out of the main bundle.
 * Runs the engine on the main thread — the heavy compute is on the GPU; this keeps the
 * model's weight fetch under the document CSP (the kernel worker stays egress-locked).
 */
import { CreateMLCEngine } from "@mlc-ai/web-llm";

type Engine = Awaited<ReturnType<typeof CreateMLCEngine>>;
let engine: Engine | null = null;
let loadedModel = "";

interface WebGPUOptions {
  prompt: string;
  system: string;
  model: string;
  onProgress?: (message: string) => void;
}

export async function generateWebGPU({ prompt, system, model, onProgress }: WebGPUOptions): Promise<string> {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU isn't available here. Use Chrome/Edge with hardware acceleration, or pick a cloud provider.");
  }

  if (!engine || loadedModel !== model) {
    if (engine) await engine.unload().catch(() => {});
    onProgress?.(`Loading ${shortName(model)} onto your GPU…`);
    engine = await CreateMLCEngine(model, {
      initProgressCallback: (r) => onProgress?.(`${shortName(model)} — ${r.text}`),
    });
    loadedModel = model;
  }

  onProgress?.(`Generating with ${shortName(model)} on your GPU…`);
  const reply = await engine.chat.completions.create({
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    max_tokens: 2048,
  });
  return reply.choices[0]?.message?.content ?? "";
}

function shortName(model: string): string {
  return model.replace(/-q4f16_1-MLC$/, "").replace(/-Instruct$/, "");
}
