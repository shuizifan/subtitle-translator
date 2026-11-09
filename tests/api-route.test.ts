import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/translate/route";

const valid = { baseURL: "https://api.openai.com/v1", apiKey: "test-secret", model: "test", messages: [{ role: "user", content: "hi" }], max_tokens: 1024 };
const request = (body: unknown) => new NextRequest("http://localhost/api/translate", { method: "POST", body: JSON.stringify(body) });
const failure = (message: string) => new Response(JSON.stringify({ error: { message } }), { status: 400 });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("转发运行时校验与端点边界", () => {
  it.each([null, [], { ...valid, baseURL: 123 }, { ...valid, messages: "bad" }, { ...valid, temperature: 3 }, { ...valid, max_tokens: 0 }, { ...valid, max_completion_tokens: 100 }, { ...valid, apiKey: "\r\nfoo" }])("非法输入返回400且不访问上游: %j", async body => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await POST(request(body))).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it("默认拒绝私网/未知origin，管理员显式配置允许新origin", async () => {
    vi.stubEnv("ALLOW_PRIVATE_ENDPOINTS", "false"); vi.stubEnv("ALLOWED_API_ORIGINS", "");
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}"))); vi.stubGlobal("fetch", fetch);
    expect((await POST(request({ ...valid, baseURL: "http://127.0.0.1/v1" }))).status).toBe(400);
    expect((await POST(request({ ...valid, baseURL: "https://custom.example/v1" }))).status).toBe(400);
    vi.stubEnv("ALLOWED_API_ORIGINS", "https://custom.example");
    expect((await POST(request({ ...valid, baseURL: "https://custom.example/v1" }))).status).toBe(200);
    expect(fetch.mock.calls[0][1].redirect).toBe("error");
  });
  it("显式本地模式允许无认证Ollama，不附加Bearer", async () => {
    vi.stubEnv("ALLOW_PRIVATE_ENDPOINTS", "true");
    const fetch = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetch);
    expect((await POST(request({ ...valid, baseURL: "http://localhost:11434/v1", authMode: "none", apiKey: "" }))).status).toBe(200);
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });
  it("按实际流限制请求体长度", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await POST(request({ ...valid, padding: "x".repeat(512001) }))).status).toBe(413); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("参数降级和响应", () => {
  it("多字段降级不复活已移除字段且始终保留额度", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(failure("Unsupported parameter: reasoning_effort"))
      .mockResolvedValueOnce(failure("Unsupported parameter: max_tokens; use max_completion_tokens"))
      .mockResolvedValueOnce(new Response('{"choices":[]}'));
    vi.stubGlobal("fetch", fetch);
    const res = await POST(request({ ...valid, reasoning_effort: "medium" }));
    expect(res.status).toBe(200); expect(fetch).toHaveBeenCalledTimes(3);
    const third = JSON.parse(fetch.mock.calls[2][1].body);
    expect(third).not.toHaveProperty("reasoning_effort"); expect(third).not.toHaveProperty("max_tokens"); expect(third.max_completion_tokens).toBe(1024);
    expect(res.headers.get("x-api-adjustments")).toContain("reasoning_effort:omitted");
  });
  it.each(["Invalid request content", "max_tokens must be <= 512", "Unsupported parameter: max_tokens"])('%s 不删掉上限重发', async message => {
    const fetch = vi.fn().mockResolvedValue(failure(message)); vi.stubGlobal("fetch", fetch);
    expect((await POST(request(valid))).status).toBe(400); expect(fetch).toHaveBeenCalledOnce();
  });
  it("仅明确不支持temperature时移除并记录", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(failure("temperature is not supported" )).mockResolvedValueOnce(new Response("{}")); vi.stubGlobal("fetch", fetch);
    const res = await POST(request({ ...valid, temperature: 0 }));
    expect(res.status).toBe(200); expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty("temperature");
    expect(res.headers.get("x-api-adjustments")).toBe("temperature:omitted");
  });
  it("限流元数据保留且错误中的Key被脱敏", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: `limited ${valid.apiKey}` } }), { status: 429, headers: { "retry-after": "4", "x-request-id": "req-123", "set-cookie": "private" } })); vi.stubGlobal("fetch", fetch);
    const res = await POST(request(valid));
    expect(res.status).toBe(429); expect(res.headers.get("retry-after")).toBe("4"); expect(res.headers.get("x-request-id")).toBe("req-123"); expect(res.headers.get("set-cookie")).toBeNull(); expect(await res.text()).not.toContain(valid.apiKey);
  });
});
