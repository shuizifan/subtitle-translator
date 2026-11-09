import { afterEach, describe, expect, it, vi } from "vitest";
import { createForwardingCaller, effectiveMaxTokens, LlmError, outputBudget, parseRetryAfter, testConnection } from "@/core/translator/llmClient";
import { buildChatCompletionsUrl, defaultGeneration, resolveLlmConfig } from "@/core/translator/config";

const profile = { baseURL: "https://api.openai.com/v1", apiKey: "test-secret", model: "test-model" };
const messages = [{ role: "user" as const, content: "hello" }];
const response = (content = "ok", finish_reason = "stop", extra = {}) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }], ...extra }), { headers: { "x-request-id": "req-test" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("API 客户端预算和配置", () => {
  it("旧无认证配置也统一使用 API Key", async () => {
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetch);
    const legacy = { ...profile, authMode: "none" as const };
    expect(resolveLlmConfig(legacy).authMode).toBe("bearer");
    await createForwardingCaller(legacy)(messages);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.authMode).toBe("bearer");
    expect(body.apiKey).toBe(profile.apiKey);
  });
  it("不擅自提高手动上限，未知模型不发送温度/思考参数", async () => {
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetch);
    await createForwardingCaller({ ...profile, generation: defaultGeneration() })(messages);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.temperature).toBeUndefined(); expect(body.reasoning_effort).toBeUndefined();
    expect(body.max_tokens).toBe(16384);
    expect(effectiveMaxTokens(64, "high")).toBe(64);
  });
  it("自动预算只估计目标而不是上下文，并拒绝突破上限", () => {
    const g = defaultGeneration(); g.reasoningEffort = "none"; g.outputBudget.limit = 1024;
    expect(outputBudget([{ role: "user", content: "x".repeat(10000) }], g, [{ id: 1, text: "Hi" }])).toBe(512);
    expect(() => outputBudget([{ role: "user", content: "x".repeat(10000) }], g)).toThrowError(expect.objectContaining({ code: "budget" }));
    g.outputBudget.mode = "manual"; expect(outputBudget(messages, g)).toBe(1024);
    g.outputBudget.mode = "provider-default"; expect(outputBudget(messages, g)).toBeUndefined();
  });
  it("自动及思考模式使用完整上限，缩批也不压缩推理空间", () => {
    for (const reasoningEffort of ["auto", "low", "medium", "high"] as const) {
      const g = { ...defaultGeneration(), reasoningEffort };
      expect(outputBudget(messages, g, [{ id: 1, text: "Hi" }])).toBe(16384);
      g.outputBudget.limit = 4096;
      expect(outputBudget(messages, g, [])).toBe(4096);
    }
  });
  it("从自动切手动后忽略自动模式的推理预留", () => {
    const g = { ...defaultGeneration(), reasoningReserve: 4096, outputBudget: { mode: "manual" as const, limit: 2048 } };
    expect(outputBudget(messages, g)).toBe(2048);
  });
  it("新模型不继承全局旧值，旧profile仍兼容且不读取原型属性", () => {
    const legacy = { temperature: 0, maxTokens: 8192, reasoningEffort: "none" as const };
    expect(resolveLlmConfig(profile, legacy).generation?.outputBudget).toEqual({ mode: "manual", limit: 8192 });
    expect(resolveLlmConfig({ ...profile, modelConfigs: {} }, legacy).generation).toEqual(defaultGeneration());
    expect(resolveLlmConfig({ ...profile, model: "constructor", modelConfigs: {} }, legacy).generation).toEqual(defaultGeneration());
    expect(resolveLlmConfig({ ...profile, generation: { ...defaultGeneration(), temperature: 1 }, modelConfigs: {} }, legacy).generation).toEqual(defaultGeneration());
  });
  it("规范化地址但不强补v1，拒绝带query的地址", () => {
    expect(buildChatCompletionsUrl(" https://open.bigmodel.cn/api/paas/v4/ ")).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(buildChatCompletionsUrl("https://example.com/v1/chat/completions/")).toBe("https://example.com/v1/chat/completions");
    expect(() => buildChatCompletionsUrl("https://example.com/v1?key=secret")).toThrow();
  });
});

describe("API 响应与协议", () => {
  it("保留usage/request ID及实际降级参数，不包含密钥", async () => {
    const res = response("ok", "stop", { usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 4 } } });
    res.headers.set("x-api-adjustments", "reasoning_effort:omitted,max_tokens:max_completion_tokens");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
    const onResult = vi.fn();
    const result = await createForwardingCaller({ ...profile, maxTokens: 512, reasoningEffort: "medium", onResult })(messages);
    expect(result).toMatchObject({ requestId: "req-test", usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 4 }, sentParameters: { max_completion_tokens: 512 } });
    expect(onResult).toHaveBeenCalledOnce(); expect(JSON.stringify((result as any).sentParameters)).not.toContain(profile.apiKey);
    expect((result as any).sentParameters).not.toHaveProperty("reasoning_effort");
  });
  it("非空length抛截断错误并保留完整条目供上层抢救", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response('[{"id":1,"text":"你好"}]', "length")));
    await expect(createForwardingCaller(profile)(messages)).rejects.toMatchObject({ code: "truncated", partialResult: { content: '[{"id":1,"text":"你好"}]', finishReason: "length" } });
  });
  it("拒绝/content_filter不可当正常译文", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("blocked", "content_filter")));
    await expect(createForwardingCaller(profile)(messages)).rejects.toMatchObject({ code: "refusal" });
  });
  it("术语schema与翻译schema分离", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response())); vi.stubGlobal("fetch", fetch);
    const caller = createForwardingCaller({ ...profile, generation: { ...defaultGeneration(), outputFormat: "json_schema" } });
    await caller(messages, undefined, { purpose: "glossary" });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.response_format.json_schema.schema.properties.items.items.required).toEqual(["term", "translation"]);
  });
  it("连接测试保持温度但独立轻量额度；协议测试使用不同ID", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response('{"items":[{"id":9,"text":"晚安"},{"id":3,"text":"你好"}]}')); vi.stubGlobal("fetch", fetch);
    expect((await testConnection({ ...profile, temperature: 0, reasoningEffort: "medium", maxTokens: 16384 })).ok).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ temperature: 0, max_tokens: 1024, reasoning_effort: "medium" });
    expect((await testConnection(profile, "protocol")).ok).toBe(true);
  });
  it("协议测试拒绝重复ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response('{"items":[{"id":3,"text":"你好"},{"id":3,"text":"晚安"}]}')));
    expect((await testConnection(profile, "protocol")).ok).toBe(false);
  });
  it("Retry-After兼容秒和日期，429同服务不同模型共享冷却且可取消", async () => {
    expect(parseRetryAfter("2")).toBe(2000); expect(parseRetryAfter("invalid")).toBeUndefined();
    expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("Wed, 21 Oct 2015 07:27:59 GMT"))).toBe(1000);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "retry-after": "30" } })); vi.stubGlobal("fetch", fetch);
    const baseURL = "https://cooldown-test.example/v1";
    await expect(createForwardingCaller({ ...profile, baseURL })(messages)).rejects.toMatchObject({ retryAfterMs: 30000 });
    const controller = new AbortController();
    const pending = createForwardingCaller({ ...profile, baseURL, model: "other" })(messages, controller.signal);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(fetch).toHaveBeenCalledOnce();
  });
  it("错误信息脱敏", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: `Invalid key: ${profile.apiKey}` } }), { status: 401 })));
    try { await createForwardingCaller(profile)(messages); expect.fail(); } catch (e) { expect(e).toBeInstanceOf(LlmError); expect((e as Error).message).not.toContain(profile.apiKey); }
  });
});
