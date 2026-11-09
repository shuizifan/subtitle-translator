import type { ApiProfile } from "@/store";
import { buildChatCompletionsUrl, defaultGeneration, type GenerationSettings } from "./config";

/** 密钥仅写入片段，不随打开链接的 HTTP 请求发送。 */
export function buildProfileShareUrl(pageUrl: string, profile: ApiProfile): string {
  buildChatCompletionsUrl(profile.baseURL);
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = "";
  const params = new URLSearchParams({ baseURL: profile.baseURL, model: profile.model, name: profile.name, apiKey: profile.apiKey });
  const generation = profile.modelConfigs && Object.hasOwn(profile.modelConfigs, profile.model)
    ? profile.modelConfigs[profile.model] : defaultGeneration();
  params.set("generation", JSON.stringify(generation));
  url.hash = params.toString();
  return url.toString();
}

export function readSharedProfile(params: URLSearchParams): Partial<ApiProfile> | null {
  const baseURL = params.get("baseURL") ?? params.get("base_url") ?? params.get("base") ?? "";
  if (!baseURL) return null;
  buildChatCompletionsUrl(baseURL);
  const model = params.get("model") ?? "";
  const name = params.get("name") || new URL(baseURL).hostname;
  if (baseURL.length > 2048 || model.length > 200 || name.length > 200) throw new Error("分享配置字段过长");
  const apiKey = params.get("apiKey") ?? params.get("api_key") ?? "";
  if (apiKey.length > 16384) throw new Error("分享配置字段过长");
  const raw = params.get("generation");
  const generation = raw ? parseGeneration(raw) : defaultGeneration();
  return { baseURL, model, name, apiKey, rememberKey: true, authMode: "bearer", modelConfigs: { [model]: generation } };
}

function parseGeneration(raw: string): GenerationSettings {
  if (raw.length > 4096) throw new Error("模型参数过长");
  const value = JSON.parse(raw);
  const validNumber = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (!value || typeof value !== "object" ||
    !(value.temperature === null || validNumber(value.temperature, 0, 2)) ||
    !["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value.reasoningEffort) ||
    !["auto", "manual", "provider-default"].includes(value.outputBudget?.mode) ||
    !validNumber(value.outputBudget?.limit, 64, 131072) ||
    !["max_tokens", "max_completion_tokens"].includes(value.tokenField) ||
    !["text", "json_object", "json_schema"].includes(value.outputFormat) ||
    !validNumber(value.reasoningReserve, 0, 131072)) throw new Error("模型参数无效");
  return {
    temperature: value.temperature, reasoningEffort: value.reasoningEffort,
    outputBudget: { mode: value.outputBudget.mode, limit: value.outputBudget.limit },
    tokenField: value.tokenField, outputFormat: value.outputFormat, reasoningReserve: value.reasoningReserve,
  };
}

/** 改变服务器 origin 清除旧 Key；改变端点使旧能力/参数覆盖失效。 */
export function updateProfileSafely(profile: ApiProfile, patch: Partial<ApiProfile>): ApiProfile {
  const next = { ...profile, ...patch };
  if (patch.baseURL !== undefined && patch.baseURL !== profile.baseURL) {
    let sameOrigin = false;
    try { sameOrigin = new URL(patch.baseURL).origin === new URL(profile.baseURL).origin; } catch { /* 无效地址不复用密钥 */ }
    if (!sameOrigin) next.apiKey = "";
    next.modelConfigs = {};
  }
  return next;
}
