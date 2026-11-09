import type { GenerationSettings } from "./config";

export interface ModelPreset {
  id: string;
  label: string;
  /** Only populated when an official source gives an exact release date. */
  releasedAt?: string;
  note?: string;
  generation?: Partial<GenerationSettings>;
}

export interface ServicePreset {
  label: string;
  name: string;
  baseURL: string;
  model: string;
  models: readonly ModelPreset[];
  note?: string;
}

// Verified 2026-11-09. Ordered by generation; same-generation variants put
// the faster option first. Defaults favor subtitle throughput, not flagship size.
// Sources and local deployment boundaries: docs/模型预设来源.md.
export const SERVICE_PRESETS: readonly ServicePreset[] = [
  {
    label: "OpenAI", name: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-6-luna",
    models: [
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", generation: { reasoningEffort: "low", tokenField: "max_completion_tokens" } },
      { id: "gpt-6-luna", label: "GPT-6 Luna · 推荐", generation: { reasoningEffort: "low", tokenField: "max_completion_tokens" } },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", generation: { reasoningEffort: "low", tokenField: "max_completion_tokens" } },
    ],
  },
  {
    label: "DeepSeek", name: "DeepSeek", baseURL: "https://api.deepseek.com", model: "deepseek-flash",
    models: [
      { id: "deepseek-flash", label: "DeepSeek V4.1 Flash · 推荐" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    ],
  },
  {
    label: "Moonshot", name: "Moonshot", baseURL: "https://api.moonshot.ai/v1", model: "kimi-k3.1-pro-highspeed",
    models: [
      { id: "kimi-k3.1-pro-highspeed", label: "Kimi K3.1 Pro 高速 · 推荐", generation: { reasoningEffort: "low", tokenField: "max_completion_tokens" } },
      { id: "kimi-k3.1-pro", label: "Kimi K3.1 Pro", generation: { reasoningEffort: "low", tokenField: "max_completion_tokens" } },
      { id: "kimi-k3", label: "Kimi K3", generation: { reasoningEffort: "low", tokenField: "max_completion_tokens" } },
    ],
  },
  {
    label: "智谱", name: "智谱", baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.3-flash",
    models: [
      { id: "glm-5.3-flashx", label: "GLM-5.3 FlashX · 高速", generation: { reasoningEffort: "low" } },
      { id: "glm-5.3-flash", label: "GLM-5.3 Flash · 推荐", generation: { reasoningEffort: "low" } },
      { id: "glm-5.3", label: "GLM-5.3", generation: { reasoningEffort: "low" } },
    ],
  },
  {
    label: "Ollama", name: "Ollama", baseURL: "http://localhost:11434/v1", model: "qwen3.5:9b",
    note: "需先安装模型并部署可达的 Ollama；API Key 可填 ollama。云端预览无法访问你电脑的 localhost。",
    models: [
      { id: "qwen3.8:27b", label: "Qwen3.8 27B" },
      { id: "qwen3.5:9b", label: "Qwen3.5 9B · 推荐" },
      { id: "qwen3.5:4b", label: "Qwen3.5 4B · 轻量" },
    ],
  },
];
