// OpenAI 兼容客户端（见规范 §2、§9）。
// 浏览器不直连模型 API，而是走转发路由：浏览器 → /api/translate → 模型 API。
// 这样既绕开 CORS，又让 key 只在请求体里穿过服务端、不进 JS 包。

import type { ChatMessage } from "@/core/translator/prompt";

export interface LlmConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/** 引擎依赖的调用接口；便于在测试中注入 mock。 */
export type LlmCaller = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;

export class LlmError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
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
        max_tokens: config.maxTokens,
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
      throw new LlmError("模型返回的不是合法 JSON", 502);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new LlmError("模型返回缺少 choices[0].message.content", 502);
    }
    return content;
  };
}

/** 测试连接（见规范 §9）：发一个极小请求校验端点/密钥/模型可用。 */
export async function testConnection(config: LlmConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const caller = createForwardingCaller({ ...config, maxTokens: 5 });
    const reply = await caller([
      { role: "user", content: 'Reply with the single word: ok' },
    ]);
    return { ok: true, message: `连接成功，模型响应：${reply.slice(0, 60)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}
