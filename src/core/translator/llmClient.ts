import type { ChatMessage } from "./prompt";
import { defaultGeneration, type GenerationSettings } from "./config";

export type ReasoningEffort = "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface LlmConfig {
  baseURL: string; apiKey: string; model: string;
  authMode?: "bearer" | "none";
  temperature?: number | null; maxTokens?: number; reasoningEffort?: ReasoningEffort;
  generation?: GenerationSettings;
  onResult?: (result: LlmResult) => void;
}
export interface LlmResult {
  content: string;
  finishReason: string | null;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number; reasoningTokens?: number };
  requestId?: string;
  refusal?: string | null;
  durationMs?: number;
  sentParameters?: Record<string, unknown>;
  adjustments?: string[];
}
export interface LlmCallOptions { purpose?: "translation" | "glossary" | "test"; targetItems?: { id: number; text: string }[] }
export type LlmCaller = (messages: ChatMessage[], signal?: AbortSignal, options?: LlmCallOptions) => Promise<LlmResult | string>;
export type LlmErrorCode = "http" | "bad-json" | "no-content" | "reasoning-budget" | "truncated" | "refusal" | "invalid-config" | "request-budget" | "budget";
export class LlmError extends Error {
  constructor(message: string, public status: number, public code: LlmErrorCode = "http", public retryAfterMs?: number, public partialResult?: LlmResult) { super(message); this.name = "LlmError"; }
}
/** 兼容旧导入；不再提高用户额度。 */
export function reasoningConsumesBudget(effort?: ReasoningEffort): boolean { return effort != null && effort !== "none" && effort !== "auto"; }
export function effectiveMaxTokens(maxTokens?: number, _effort?: ReasoningEffort): number | undefined { return maxTokens; }
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}
const cooldowns = new Map<string, number>();
async function waitForCooldown(key: string, signal?: AbortSignal) {
  for (;;) {
    signal?.throwIfAborted();
    const remaining = (cooldowns.get(key) ?? 0) - Date.now();
    if (remaining <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, Math.min(remaining, 60_000));
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
/** 字符级保守估计，不是供应商 tokenizer；超出配置上限交由引擎缩批。 */
export function outputBudget(messages: ChatMessage[], g: GenerationSettings, targetItems?: LlmCallOptions["targetItems"]): number | undefined {
  if (g.outputBudget.mode === "provider-default") return undefined;
  const ceiling = g.outputBudget.limit;
  if (!Number.isSafeInteger(ceiling) || ceiling < 1 || ceiling > 64000) throw new LlmError("输出额度无效", 400, "invalid-config");
  if (g.outputBudget.mode === "manual") return ceiling;
  if (!Number.isSafeInteger(g.reasoningReserve) || g.reasoningReserve < 0 || g.reasoningReserve >= ceiling) throw new LlmError("自动预算的推理预留无效", 400, "invalid-config");
  const chars = targetItems ? JSON.stringify(targetItems).length : messages.filter(m => m.role === "user").reduce((n, m) => n + m.content.length, 0);
  const estimate = Math.max(512, Math.ceil(chars * 2) + 256 + g.reasoningReserve);
  if (estimate > ceiling) throw new LlmError("估计输出超过当前预算上限，请缩批或调整上限", 400, "budget");
  return estimate;
}
function responseFormat(format: GenerationSettings["outputFormat"], purpose: LlmCallOptions["purpose"]) {
  if (format === "text") return undefined;
  if (format === "json_object") return { type: "json_object" };
  const properties = purpose === "glossary" ? { term: { type: "string" }, translation: { type: "string" } } : { id: { type: "integer" }, text: { type: "string" } };
  return { type: "json_schema", json_schema: { name: purpose === "glossary" ? "glossary" : "translation", strict: true, schema: { type: "object", properties: { items: { type: "array", items: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } } }, required: ["items"], additionalProperties: false } } };
}
export function createForwardingCaller(config: LlmConfig): LlmCaller {
  const g = config.generation ?? { ...defaultGeneration(), temperature: config.temperature ?? null, reasoningEffort: config.reasoningEffort ?? "auto", ...(config.maxTokens != null ? { outputBudget: { mode: "manual" as const, limit: config.maxTokens } } : {}) };
  const serviceKey = config.baseURL.replace(/\/+$/, "");
  let requestCount = 0;
  return async (messages, signal, options) => {
    await waitForCooldown(serviceKey, signal);
    if (++requestCount > 10000) throw new LlmError("本次调用器已达到 10000 次请求上限，请检查任务规模或重试设置", 400, "request-budget");
    const budget = outputBudget(messages, g, options?.targetItems);
    const parameters = { ...(g.temperature !== null ? { temperature: g.temperature } : {}), ...(budget != null ? { [g.tokenField]: budget } : {}), ...(g.reasoningEffort !== "auto" ? { reasoning_effort: g.reasoningEffort } : {}), ...(g.outputFormat !== "text" ? { response_format: responseFormat(g.outputFormat, options?.purpose) } : {}) };
    const started = Date.now();
    const res = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ baseURL: config.baseURL, apiKey: config.apiKey, authMode: config.authMode ?? "bearer", model: config.model, messages, ...parameters }),
    });
    const raw = await res.text();
    if (!res.ok) {
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      if (res.status === 429) cooldowns.set(serviceKey, Math.max(cooldowns.get(serviceKey) ?? 0, Date.now() + (retryAfterMs ?? 1000)));
      let detail = "请求失败";
      try { const j = JSON.parse(raw); if (typeof j.error?.message === "string") detail = j.error.message; } catch { /* 不回显任意上游 HTML */ }
      if (config.apiKey) detail = detail.split(config.apiKey).join("[REDACTED]");
      throw new LlmError(`模型 API 返回 ${res.status}: ${detail}`.slice(0, 500), res.status, "http", retryAfterMs);
    }
    let data: any;
    try { data = JSON.parse(raw); } catch { throw new LlmError("模型返回的不是合法 JSON", 502, "bad-json"); }
    const choice = data?.choices?.[0];
    const usage = data?.usage;
    const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
    const adjustments = res.headers.get("x-api-adjustments")?.split(",") ?? [];
    const sentParameters: Record<string, unknown> = { ...parameters };
    for (const adjustment of adjustments) {
      if (adjustment === "reasoning_effort:omitted") delete sentParameters.reasoning_effort;
      if (adjustment === "temperature:omitted") delete sentParameters.temperature;
      if (adjustment === "max_tokens:max_completion_tokens") { sentParameters.max_completion_tokens = sentParameters.max_tokens; delete sentParameters.max_tokens; }
    }
    const result: LlmResult = { content: typeof choice?.message?.content === "string" ? choice.message.content : "", finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
      requestId: res.headers.get("x-request-id") ?? undefined, refusal: typeof choice?.message?.refusal === "string" ? choice.message.refusal : null, durationMs: Date.now() - started, sentParameters, adjustments,
      ...(usage && typeof usage === "object" ? { usage: { promptTokens: number(usage.prompt_tokens), completionTokens: number(usage.completion_tokens), totalTokens: number(usage.total_tokens), reasoningTokens: number(usage.completion_tokens_details?.reasoning_tokens) } } : {}),
    };
    config.onResult?.(result);
    if (result.refusal || result.finishReason === "content_filter") throw new LlmError("模型拒绝输出或触发内容过滤；请检查原文，不自动重试", 422, "refusal");
    if (result.finishReason === "length") throw new LlmError("模型输出达到额度上限，结果可能被截断", 502, "truncated", undefined, result);
    if (!result.content.trim()) throw new LlmError("模型未返回正文；可能与推理额度或模型响应格式有关", 502, "no-content", undefined, result);
    return result;
  };
}
export async function testConnection(config: LlmConfig, mode: "connectivity" | "protocol" = "connectivity"): Promise<{ ok: boolean; message: string }> {
  try {
    const generation = config.generation ?? { ...defaultGeneration(), temperature: config.temperature ?? null, reasoningEffort: config.reasoningEffort ?? "auto", outputBudget: { mode: "manual" as const, limit: config.maxTokens ?? 16384 } };
    const testGeneration = mode === "connectivity" ? { ...generation, outputFormat: "text" as const, reasoningReserve: 0, outputBudget: { mode: "manual" as const, limit: Math.min(1024, generation.outputBudget.limit) } } : generation;
    const result = await createForwardingCaller({ ...config, generation: testGeneration })([{ role: "user", content: mode === "connectivity" ? "Reply with the single word: ok" : 'Translate these entries into Simplified Chinese: [{"id":3,"text":"Hello"},{"id":9,"text":"Good night"}]. Output ONLY a JSON object {"items":[{"id":3,"text":"translation"},{"id":9,"text":"translation"}]}, with exactly those ids and one nonempty translation each.' }], undefined, { purpose: "test" });
    const content = typeof result === "string" ? result : result.content;
    if (mode === "protocol") {
      let parsed: any; try { parsed = JSON.parse(content); } catch { throw new Error("接口有响应，但未通过 JSON 协议测试"); }
      if (!Array.isArray(parsed?.items) || parsed.items.length !== 2 || new Set(parsed.items.map((i: any) => i?.id)).size !== 2 || !parsed.items.every((i: any) => [3, 9].includes(i?.id) && typeof i?.text === "string" && i.text.trim())) throw new Error("接口有响应，但未通过 ID/译文协议测试");
    }
    return { ok: true, message: mode === "protocol" ? "当前参数及 JSON 协议测试通过；不代表翻译质量通过" : "连接成功，模型已返回正文；可继续验证当前参数与输出协议" };
  } catch (e) { return { ok: false, message: (e instanceof Error ? e.message : String(e)) + (mode === "connectivity" && e instanceof LlmError && ["truncated", "no-content"].includes(e.code) ? "；轻量测试上限为 1024 token，部分推理模型可能不足，可使用当前参数协议测试" : "") }; }
}
