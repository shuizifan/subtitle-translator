// LLM 转发路由（见规范 §1、§2、§9）——这是整个项目唯一的后端。
// 无状态：只把请求转发给用户配置的 OpenAI 兼容端点。
// key 在请求体里穿过服务端，不落库、不写进源码、不打进前端包。

import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ForwardBody {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  messages?: unknown;
  temperature?: number;
  max_tokens?: number;
}

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 规范化 baseURL：去尾部斜杠，确保以 /v1 形态拼接 /chat/completions。 */
function buildUrl(baseURL: string): string {
  let b = baseURL.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(b)) return b; // 用户直接给了完整端点
  return `${b}/chat/completions`;
}

export async function POST(req: NextRequest) {
  let body: ForwardBody;
  try {
    body = (await req.json()) as ForwardBody;
  } catch {
    return json({ error: { message: "请求体不是合法 JSON" } }, 400);
  }

  const { baseURL, apiKey, model, messages, temperature, max_tokens } = body;
  if (!baseURL || !apiKey || !model || !messages) {
    return json(
      { error: { message: "缺少必要参数：baseURL / apiKey / model / messages" } },
      400,
    );
  }

  const url = buildUrl(baseURL);
  const payload: Record<string, unknown> = { model, messages, stream: false };
  if (typeof temperature === "number") payload.temperature = temperature;
  if (typeof max_tokens === "number") payload.max_tokens = max_tokens;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    // 原样回传上游状态码与响应体，前端按需解析
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: { message: `转发到模型 API 失败：${message}` } }, 502);
  }
}
