/**
 * Codegen providers. The "nakli-ai routing" convention realized locally (handoff §12):
 * one prompt → many possible backends. Cloud (BYOK) or fully on-device (WebGPU).
 *
 * - `anthropic` — Anthropic Messages API.
 * - `openai`    — OpenAI Chat Completions API.
 * - `custom`    — any OpenAI-compatible endpoint you type in (OpenRouter, Together, Groq,
 *                 LM Studio, an Ollama server at http://localhost:11434/v1/…). Key optional.
 * - `webgpu`    — a small coder model run on your GPU, in the tab. No key, no network for
 *                 inference (weights download once). The sovereign rung of the ladder.
 */
export type ProviderId = "anthropic" | "openai" | "custom" | "webgpu";
export type ProviderApi = "anthropic" | "openai" | "webgpu";

export interface ModelOption {
  id: string;
  label: string;
}
export interface ProviderDef {
  id: ProviderId;
  label: string;
  api: ProviderApi;
  defaultEndpoint: string; // "" for webgpu
  endpointEditable: boolean;
  needsKey: boolean; // a key is required (Anthropic/OpenAI) vs optional/none
  models: ModelOption[]; // suggestions; the model field is free-text for cloud providers
  note: string;
}

/** Coder models available to the on-device WebGPU engine (WebLLM prebuilt ids). */
export const WEBGPU_MODELS: ModelOption[] = [
  { id: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Coder 0.5B (~0.5 GB · fastest)" },
  { id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Coder 1.5B (~1.0 GB · balanced)" },
  { id: "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Coder 3B (~1.9 GB · best)" },
];

export const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    api: "anthropic",
    defaultEndpoint: "https://api.anthropic.com/v1/messages",
    endpointEditable: false,
    needsKey: true,
    models: [
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
    note: "Key stored in your browser only; sent only to Anthropic.",
  },
  {
    id: "openai",
    label: "OpenAI",
    api: "openai",
    defaultEndpoint: "https://api.openai.com/v1/chat/completions",
    endpointEditable: false,
    needsKey: true,
    models: [
      { id: "gpt-4o", label: "gpt-4o" },
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
    ],
    note: "Key stored in your browser only; sent only to OpenAI.",
  },
  {
    id: "custom",
    label: "Custom / Local (OpenAI-compatible)",
    api: "openai",
    defaultEndpoint: "http://localhost:11434/v1/chat/completions",
    endpointEditable: true,
    needsKey: false,
    models: [
      { id: "qwen2.5-coder", label: "qwen2.5-coder" },
      { id: "llama3.1", label: "llama3.1" },
    ],
    note: "Any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, …). Key optional.",
  },
  {
    id: "webgpu",
    label: "Local (WebGPU, on-device)",
    api: "webgpu",
    defaultEndpoint: "",
    endpointEditable: false,
    needsKey: false,
    models: WEBGPU_MODELS,
    note: "Runs on your GPU, in this tab. No key, no network for inference — weights download once.",
  },
];

export const DEFAULT_PROVIDER: ProviderId = "anthropic";

export function getProvider(id: string): ProviderDef {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** WebGPU availability — checked without loading the (heavy) WebLLM engine. */
export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
