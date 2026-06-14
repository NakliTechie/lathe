/**
 * Codegen — a prompt → a Lathe model module, via the selected provider (see providers.ts).
 * Cloud calls go straight from the browser to the provider with the user's key (no Lathe
 * server). WebGPU runs fully on-device. The generated code is written into the editor and
 * run through the worker path — never eval'd here (rule #5); a bad generation fails loud
 * via the G2 compile/build path.
 */
import { getProvider, type ProviderId } from "./providers";

const SYSTEM_PROMPT = `You write parametric CAD models for Lathe, a browser CAD tool where "the code is the model".

Output a JavaScript module with exactly two exports — nothing else:
  export const params = { ... };        // flat object of numbers/booleans/strings; these become UI controls
  export function build(p) { ... }       // receives the params, returns ONE shape (or an array of shapes)

The CAD API is available as globals — DO NOT import anything. All distances are millimetres.
Available functions (a shape is opaque; pass it around):
  box(width, depth, height)              // a box; its near-lower corner sits at the origin, extending +X/+Y/+Z
  cylinder(radius, height)               // axis along +Z, centred on the origin in XY, from z=0 to z=height
  sphere(radius)
  fuse(a, b)                             // union
  cut(base, tool)                        // subtract tool from base (e.g. drilling holes)
  intersect(a, b)
  fillet(shape, edges, radius)           // round edges; or fillet(shape, radius) for all edges
  chamfer(shape, edges, distance)        // bevel edges; or chamfer(shape, distance)
  translate(shape, [x, y, z])            // move a shape
  rotate(shape, angleDegrees, { axis: [x,y,z], center: [x,y,z] })
  scale(shape, factor)
  edgeFinder()                           // build an edge selector for fillet/chamfer; chain .inDirection([x,y,z])
  faceFinder()                           // face selector; chain .inDirection([x,y,z])

Rules:
- Booleans throw on bad geometry (no Result objects) — just call them directly.
- To round the vertical edges of a box: fillet(solid, edgeFinder().inDirection([0, 0, 1]), r).
- To drill a hole straight down through a plate of height h, centred at (x, y):
    cut(plate, translate(cylinder(r, h + 2), [x, y, -1]))     // over-length so it clears both faces
- "M4 hole" etc. = a clearance hole for an M-number metric bolt; use a radius slightly over half the M-number
  (e.g. M4 → ~2.2 mm radius, M3 → ~1.7 mm, M5 → ~2.7 mm).
- Make sensible parameters (sizes, counts, radii) so the part is adjustable from the panel.

Respond with ONLY one fenced \`\`\`js code block containing the module. No prose, no explanation.

Example — a 40×30×12 mounting bracket with a centred M5 hole and rounded corners:
\`\`\`js
export const params = { width: 40, depth: 30, height: 12, holeRadius: 2.7, cornerFillet: 3 };
export function build(p) {
  let solid = box(p.width, p.depth, p.height);
  if (p.cornerFillet > 0) solid = fillet(solid, edgeFinder().inDirection([0, 0, 1]), p.cornerFillet);
  const drill = translate(cylinder(p.holeRadius, p.height + 2), [p.width / 2, p.depth / 2, -1]);
  return cut(solid, drill);
}
\`\`\``;

export interface GenerateConfig {
  provider: ProviderId;
  endpoint: string;
  model: string;
  key: string | null;
  onProgress?: (message: string) => void;
}

/** Generate a model module from a natural-language prompt. Returns the code (no fences). */
export async function generateModel(prompt: string, cfg: GenerateConfig): Promise<string> {
  const api = getProvider(cfg.provider).api;
  let text: string;
  if (api === "anthropic") text = await callAnthropic(prompt, cfg);
  else if (api === "openai") text = await callOpenAI(prompt, cfg);
  else text = await callWebGPU(prompt, cfg);

  const code = extractCode(text).trim();
  if (!code) throw new Error("The model returned no code. Try rephrasing, or a stronger model.");
  return code;
}

async function callAnthropic(prompt: string, cfg: GenerateConfig): Promise<string> {
  if (!cfg.key) throw new Error("No API key set for Anthropic.");
  const data = (await fetchJSON(cfg.endpoint, {
    "content-type": "application/json",
    "x-api-key": cfg.key,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  }, {
    model: cfg.model,
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  })) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

async function callOpenAI(prompt: string, cfg: GenerateConfig): Promise<string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.key) headers["authorization"] = `Bearer ${cfg.key}`;
  const data = (await fetchJSON(cfg.endpoint, headers, {
    model: cfg.model,
    max_tokens: 4096,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  })) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function callWebGPU(prompt: string, cfg: GenerateConfig): Promise<string> {
  const { generateWebGPU } = await import("./webgpu"); // lazy — keeps web-llm out of the main chunk
  return generateWebGPU({ prompt, system: SYSTEM_PROMPT, model: cfg.model, onProgress: cfg.onProgress });
}

async function fetchJSON(endpoint: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new Error("Could not reach the endpoint — check the URL, your network, and that it's reachable (CORS / connect-src).");
  }
  if (!res.ok) throw new Error(await describeError(res));
  return res.json();
}

/** Pull the first fenced code block; fall back to the whole text if unfenced. */
function extractCode(text: string): string {
  const fenced = /```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/i.exec(text);
  return fenced ? fenced[1] : text;
}

async function describeError(res: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    detail = message ? ` — ${message}` : "";
  } catch {
    /* non-JSON error body */
  }
  switch (res.status) {
    case 401:
      return "Invalid or missing API key (401).";
    case 403:
      return "Key lacks permission for this model (403).";
    case 404:
      return `Endpoint or model not found (404)${detail}`;
    case 429:
      return "Rate limited (429). Wait a moment and retry.";
    case 529:
      return "The provider is overloaded (529). Retry shortly.";
    default:
      return `Generation failed (${res.status})${detail}`;
  }
}
