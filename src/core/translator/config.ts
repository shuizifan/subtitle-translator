import type { LlmConfig, ReasoningEffort } from "./llmClient";

export interface GenerationSettings {
  temperature: number | null;
  reasoningEffort: ReasoningEffort;
  outputBudget: { mode: "auto" | "manual" | "provider-default"; limit: number };
  tokenField: "max_tokens" | "max_completion_tokens";
  outputFormat: "text" | "json_object" | "json_schema";
  reasoningReserve: number;
}
export function defaultGeneration(): GenerationSettings {
  return { temperature: null, reasoningEffort: "auto", outputBudget: { mode: "auto", limit: 16384 }, tokenField: "max_tokens", outputFormat: "text", reasoningReserve: 0 };
}
interface ProfileConfig {
  baseURL: string; apiKey: string; model: string;
  authMode?: "bearer" | "none";
  generation?: GenerationSettings;
  modelConfigs?: Record<string, GenerationSettings>;
}
export function resolveLlmConfig(profile: ProfileConfig, legacy?: { temperature?: number | null; maxTokens?: number; reasoningEffort?: ReasoningEffort }): LlmConfig {
  const saved = profile.modelConfigs !== undefined
    ? (Object.hasOwn(profile.modelConfigs, profile.model) ? profile.modelConfigs[profile.model] : undefined)
    : profile.generation;
  const generation = saved ?? (profile.modelConfigs !== undefined ? defaultGeneration() : { ...defaultGeneration(), temperature: legacy?.temperature ?? null, reasoningEffort: legacy?.reasoningEffort ?? "auto", ...(legacy?.maxTokens != null ? { outputBudget: { mode: "manual" as const, limit: legacy.maxTokens } } : {}) });
  return { baseURL: profile.baseURL, apiKey: profile.apiKey, model: profile.model, authMode: "bearer", generation: { ...generation, outputBudget: { ...generation.outputBudget } } };
}
export function buildChatCompletionsUrl(baseURL: string): string {
  const u = new URL(baseURL.trim());
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error("Base URL 需为不含账号、查询参数或片段的 http/https 地址");
  u.pathname = u.pathname.replace(/\/+$/, "");
  if (!u.pathname.endsWith("/chat/completions")) u.pathname += "/chat/completions";
  return u.toString();
}
