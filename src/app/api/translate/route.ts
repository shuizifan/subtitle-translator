import { NextRequest } from "next/server";
import { buildChatCompletionsUrl } from "@/core/translator/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_BODY_BYTES = 512_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const TRUSTED_ORIGINS = ["https://api.openai.com", "https://api.deepseek.com", "https://api.moonshot.cn", "https://api.moonshot.ai", "https://open.bigmodel.cn"];
const json = (data: unknown, status: number) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === "object" && !Array.isArray(v);

async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error("too-large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/** 默认仅信任内置官方 origin。额外 origin 由部署管理员审核，不接受客户端传入白名单。
 * 此策略不宣称对任意域名做 DNS 防重绑定；不要添加不受信任、可由用户控制解析的域名。
 * 私有部署可显式开启本地模式；该模式不得暴露为无认证公网代理。
 */
function validateEndpoint(url: string): string | null {
  const u = new URL(url);
  const localMode = /^(1|true|yes)$/i.test(process.env.ALLOW_PRIVATE_ENDPOINTS ?? "false");
  if (localMode) return null;
  if (u.protocol !== "https:") return "公网模式仅允许 HTTPS 模型端点；本地 Ollama 需要在本地部署应用";
  const configured = (process.env.ALLOWED_API_ORIGINS ?? "").split(",").map(x => x.trim()).filter(Boolean);
  if (![...TRUSTED_ORIGINS, ...configured].includes(u.origin)) return "该端点未获本站部署允许；请由管理员将受信任的 HTTPS origin 加入 ALLOWED_API_ORIGINS";
  return null;
}

function validateBody(body: unknown): string | null {
  if (!object(body)) return "请求体必须是 JSON 对象";
  for (const key of ["baseURL", "model"]) if (typeof body[key] !== "string" || !body[key].trim() || body[key].length > 2048) return `${key} 必须为非空字符串且不超过 2048 字符`;
  if (body.authMode != null && !["bearer", "none"].includes(body.authMode)) return "authMode 无效";
  if (body.apiKey != null && (typeof body.apiKey !== "string" || body.apiKey.length > 4096 || /[\r\n]/.test(body.apiKey))) return "API Key 格式无效";
  if (body.authMode !== "none" && !body.apiKey?.trim()) return "缺少 API Key";
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 200) return "messages 必须包含 1 至 200 条消息";
  let chars = 0;
  for (const m of body.messages) {
    if (!object(m) || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string") return "messages 的 role/content 无效";
    chars += m.content.length;
  }
  if (chars > 100_000) return "消息正文超过 100000 字符上限";
  if (body.temperature != null && (typeof body.temperature !== "number" || !Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2)) return "temperature 必须在 0 至 2 之间";
  for (const key of ["max_tokens", "max_completion_tokens"]) if (body[key] != null && (!Number.isSafeInteger(body[key]) || body[key] < 1 || body[key] > 64000)) return `${key} 必须为 1 至 64000 的整数`;
  if (body.max_tokens != null && body.max_completion_tokens != null) return "只能指定一种输出额度字段";
  if (body.reasoning_effort != null && !["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(body.reasoning_effort)) return "reasoning_effort 无效";
  if (body.response_format != null) {
    const f = body.response_format;
    if (!object(f) || !["json_object", "json_schema"].includes(f.type)) return "response_format 无效";
    if (f.type === "json_schema" && (!object(f.json_schema) || typeof f.json_schema.name !== "string" || !object(f.json_schema.schema) || f.json_schema.strict !== true || JSON.stringify(f).length > 16000)) return "JSON Schema 格式或长度无效";
  }
  return null;
}

function unsupported(detail: string, field: string): boolean {
  return new RegExp(`\\b${field}\\b`, "i").test(detail) && /unsupported|not supported|unknown parameter|unrecognized|not allowed|does not support|not compatible/i.test(detail);
}

export async function POST(req: NextRequest) {
  let body: Record<string, any>;
  try {
    if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return json({ error: { message: "请求体过大" } }, 413);
    const parsed: unknown = JSON.parse(await readLimited(req.body, MAX_BODY_BYTES));
    const invalid = validateBody(parsed);
    if (invalid) return json({ error: { message: invalid } }, 400);
    body = parsed as Record<string, any>;
  } catch (e) { return json({ error: { message: e instanceof Error && e.message === "too-large" ? "请求体过大" : "请求体不是合法 JSON" } }, e instanceof Error && e.message === "too-large" ? 413 : 400); }
  let url: string;
  try { url = buildChatCompletionsUrl(body.baseURL); } catch { return json({ error: { message: "Base URL 无效，不允许账号、查询参数或片段" } }, 400); }
  const invalidEndpoint = validateEndpoint(url);
  if (invalidEndpoint) return json({ error: { message: invalidEndpoint } }, 400);
  const payload: Record<string, unknown> = { model: body.model.trim(), messages: body.messages.map((m: any) => ({ role: m.role, content: m.content })), stream: false };
  for (const key of ["temperature", "max_tokens", "max_completion_tokens", "reasoning_effort", "response_format"]) if (body[key] != null) payload[key] = body[key];
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(55_000)]);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (body.authMode !== "none") headers.Authorization = `Bearer ${body.apiKey}`;
  const changes: string[] = [];
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const upstream = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal, redirect: "error" });
      let text = await readLimited(upstream.body, MAX_RESPONSE_BYTES);
      if (upstream.status === 400 && attempt < 3) {
        // 每次仅根据明确字段错误修改当前 payload；从不移除输出上限。
        let detail = "";
        try { const error = JSON.parse(text)?.error; detail = typeof error?.message === "string" ? error.message : ""; } catch { /* 不对非结构化错误猜测降级 */ }
        if ("reasoning_effort" in payload && unsupported(detail, "reasoning_effort")) { delete payload.reasoning_effort; changes.push("reasoning_effort:omitted"); continue; }
        if ("max_tokens" in payload && /max_completion_tokens/i.test(detail) && unsupported(detail, "max_tokens")) { payload.max_completion_tokens = payload.max_tokens; delete payload.max_tokens; changes.push("max_tokens:max_completion_tokens"); continue; }
        if ("temperature" in payload && unsupported(detail, "temperature")) { delete payload.temperature; changes.push("temperature:omitted"); continue; }
      }
      // 错误响应可能回显请求；仅传经过脱敏的 message，避免泄漏 Key 或上游内部字段。
      if (!upstream.ok) {
        let message = `上游请求失败（${upstream.status}）`;
        try { const error = JSON.parse(text)?.error; if (typeof error?.message === "string") message = error.message; } catch { /* keep generic */ }
        if (body.apiKey) message = message.split(body.apiKey).join("[REDACTED]");
        text = JSON.stringify({ error: { message: message.slice(0, 1000) } });
      }
      const outHeaders: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
      for (const name of ["retry-after", "x-request-id"]) { const value = upstream.headers.get(name); if (value && value.length <= 256) outHeaders[name] = value; }
      if (changes.length) outHeaders["x-api-adjustments"] = changes.join(",");
      return new Response(text, { status: upstream.status, headers: outHeaders });
    }
    return json({ error: { message: "参数兼容处理达到上限" } }, 400);
  } catch (e) {
    const timedOut = e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name);
    return json({ error: { message: timedOut ? "模型 API 超时或请求已取消" : "上游连接失败、响应过大或重定向被拒绝" } }, timedOut ? 504 : 502);
  }
}
