// LLM 转发路由（见规范 §1、§2、§9）——这是整个项目唯一的后端。
// 无状态：只把请求转发给用户配置的 OpenAI 兼容端点。
// key 在请求体里穿过服务端，不落库、不写进源码、不打进前端包。

import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 一批字幕的生成可能要几十秒（尤其思考型模型），别让平台默认时限把请求砍成 504。
export const maxDuration = 60;

/** 上游超时：留一点余量给响应回传，避免被平台的 maxDuration 拦腰斩断成 504。 */
const UPSTREAM_TIMEOUT_MS = 55_000;

interface ForwardBody {
  baseURL?: string;
  apiKey?: string;
  model?: string;
  messages?: unknown;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: string;
}

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 规范化 baseURL：去尾部斜杠，确保以 /v1 形态拼接 /chat/completions。 */
function buildUrl(baseURL: string): string {
  const b = baseURL.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(b)) return b; // 用户直接给了完整端点
  return `${b}/chat/completions`;
}

/** 内网/回环地址。公网部署时要挡住，否则这个路由就成了打内网的跳板（SSRF）。 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "0.0.0.0" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // 云厂商 metadata 服务
  }
  return false;
}

/**
 * 校验用户填的端点。
 * 默认允许内网地址（本地跑 Ollama 是常见用法），公网部署时把
 * ALLOW_PRIVATE_ENDPOINTS 设为 0/false 即可关掉。
 */
function validateEndpoint(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Base URL 不是合法的地址";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Base URL 只支持 http/https";
  const allowPrivate = !/^(0|false|no)$/i.test(process.env.ALLOW_PRIVATE_ENDPOINTS ?? "1");
  if (!allowPrivate && isPrivateHost(u.hostname)) {
    return "本站点不允许转发到内网地址；请填写公网可访问的模型端点";
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: ForwardBody;
  try {
    body = (await req.json()) as ForwardBody;
  } catch {
    return json({ error: { message: "请求体不是合法 JSON" } }, 400);
  }

  const { baseURL, apiKey, model, messages, temperature, max_tokens, reasoning_effort } = body;
  if (!baseURL || !apiKey || !model || !messages) {
    return json(
      { error: { message: "缺少必要参数：baseURL / apiKey / model / messages" } },
      400,
    );
  }

  const url = buildUrl(baseURL);
  const invalid = validateEndpoint(url);
  if (invalid) return json({ error: { message: invalid } }, 400);

  const payload: Record<string, unknown> = { model, messages, stream: false };
  if (typeof temperature === "number") payload.temperature = temperature;
  if (typeof max_tokens === "number") payload.max_tokens = max_tokens;
  if (typeof reasoning_effort === "string" && reasoning_effort) {
    payload.reasoning_effort = reasoning_effort;
  }

  // 浏览器取消翻译时连上游请求一起断掉；同时给上游一个自己的超时。
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const signal =
    typeof AbortSignal.any === "function" ? AbortSignal.any([req.signal, timeout]) : timeout;

  const send = (p: Record<string, unknown>) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(p),
      signal,
    });

  try {
    let upstream = await send(payload);

    // 不是所有 OpenAI 兼容端点都认这些调优字段（有的直接 400）。
    // 按「摘掉一个字段再试一次」的顺序降级，保证不会因为一个参数彻底不可用。
    if (upstream.status === 400 && "reasoning_effort" in payload) {
      const { reasoning_effort: _dropped, ...withoutEffort } = payload;
      upstream = await send(withoutEffort);
      if (upstream.status !== 400) Reflect.deleteProperty(payload, "reasoning_effort");
    }

    if (upstream.status === 400 && "max_tokens" in payload) {
      const detail = (await upstream.clone().text()).slice(0, 2000);
      const { max_tokens: mt, ...rest } = payload;
      // 新版 OpenAI 系模型改叫 max_completion_tokens；其余情况直接不带额度上限
      if (/max_completion_tokens/i.test(detail)) {
        upstream = await send({ ...rest, max_completion_tokens: mt });
      } else if (/max_tokens/i.test(detail)) {
        upstream = await send(rest);
      }
    }

    const text = await upstream.text();
    // 原样回传上游状态码与响应体，前端按需解析
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return json({ error: { message: "模型 API 超时或请求已取消" } }, 504);
    }
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: { message: `转发到模型 API 失败：${message}` } }, 502);
  }
}
