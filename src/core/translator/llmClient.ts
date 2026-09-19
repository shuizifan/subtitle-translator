// OpenAI 兼容客户端（见规范 §2、§9）。
// 浏览器不直连模型 API，而是走转发路由：浏览器 → /api/translate → 模型 API。
// 这样既绕开 CORS，又让 key 只在请求体里穿过服务端、不进 JS 包。

import type { ChatMessage } from "@/core/translator/prompt";

/**
 * 思考强度。"auto" = 不发送该字段，完全交给供应商默认行为。
 * 字幕以逐条直译为主，但实测关闭思考会让推理型模型把一句话在相邻两条字幕间错误
 * 重新分配（见改进建议 #4），所以默认用 "medium"；追求速度/成本可调回 "none"。
 */
export type ReasoningEffort = "auto" | "none" | "minimal" | "low" | "medium" | "high";

export interface LlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

/** 引擎依赖的调用接口；便于在测试中注入 mock。 */
export type LlmCaller = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;

export type LlmErrorCode = "http" | "bad-json" | "no-content" | "reasoning-budget";

export class LlmError extends Error {
  status: number;
  code: LlmErrorCode;
  constructor(message: string, status: number, code: LlmErrorCode = "http") {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.code = code;
  }
}

/** 开了思考时 max_tokens 的下限：思考 token 与输出共用这个额度。 */
export const REASONING_MIN_MAX_TOKENS = 16384;

/** 思考模式是否真的会消耗额度（"none"=不思考，"auto"=交给服务端，不擅自抬额度）。 */
export function reasoningConsumesBudget(effort?: ReasoningEffort): boolean {
  return effort != null && effort !== "none" && effort !== "auto";
}

/**
 * 实际发送的 max_tokens。
 * 思考型模型的思考 token 从 max_tokens 里扣：8192 很容易被思考吃空，
 * 返回 finish_reason=length 且 content 为空（见改进建议 #4b），所以开思考时抬下限。
 */
export function effectiveMaxTokens(maxTokens?: number, effort?: ReasoningEffort): number | undefined {
  if (maxTokens == null) return undefined;
  return reasoningConsumesBudget(effort) ? Math.max(maxTokens, REASONING_MIN_MAX_TOKENS) : maxTokens;
}

/** 创建一个走 /api/translate 转发路由的调用器（浏览器端使用）。 */
export function createForwardingCaller(config: LlmConfig): LlmCaller {
  return async (messages, signal) => {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseURL: config.baseURL,
        apiKey: config.apiKey,
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: effectiveMaxTokens(config.maxTokens, config.reasoningEffort),
        reasoning_effort:
          config.reasoningEffort && config.reasoningEffort !== "auto"
            ? config.reasoningEffort
            : undefined,
      }),
      signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      let detail = raw;
      try {
        const j = JSON.parse(raw);
        detail = j.error?.message ?? j.error ?? raw;
      } catch {
        /* keep raw */
      }
      throw new LlmError(`模型 API 返回 ${res.status}: ${detail}`.slice(0, 500), res.status);
    }

    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new LlmError("模型返回的不是合法 JSON", 502, "bad-json");
    }
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") {
      throw new LlmError("模型返回缺少 choices[0].message.content", 502, "no-content");
    }
    if (content.trim() === "") {
      // 空内容 + finish_reason=length（或有思考 token 记录）＝ 额度全被思考吃掉了。
      // 这种情况原样重发必然再次失败，必须让上层知道原因（缩批 / 抬 max_tokens / 关思考）。
      const reasoningTokens = data?.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      if (choice?.finish_reason === "length" || reasoningTokens > 0) {
        throw new LlmError(
          `模型只输出了思考、没有输出内容（思考 token 耗尽了 max_tokens 额度${
            reasoningTokens ? `，思考用掉 ${reasoningTokens} token` : ""
          }）。请调高 max tokens、调低思考强度，或减小每批条数。`,
          502,
          "reasoning-budget",
        );
      }
      throw new LlmError("模型返回了空内容", 502, "no-content");
    }
    return content;
  };
}

/** 测试连接（见规范 §9）：发一个极小请求校验端点/密钥/模型可用。 */
export async function testConnection(config: LlmConfig): Promise<{ ok: boolean; message: string }> {
  try {
    // 额度不能太小：思考型模型的思考 token 也占 max_tokens，给 5 会被直接截断成空回复。
    const caller = createForwardingCaller({ ...config, maxTokens: 64 });
    const reply = await caller([
      { role: "user", content: 'Reply with the single word: ok' },
    ]);
    return { ok: true, message: `连接成功，模型响应：${reply.slice(0, 60)}` };
  } catch (e) {
    if (e instanceof LlmError && (e.code === "reasoning-budget" || e.code === "no-content")) {
      return {
        ok: false,
        message:
          "端点可达，但模型返回了空内容（常见于思考型模型思考 token 占满额度）。请在「参数」里把「思考模式」设为「关闭」，或调高 max tokens。",
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}
