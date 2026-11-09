import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PARAMS, migrateSettings, newProfile, profilesForStorage, snapshotSettings, useAppStore } from "@/store";
import { defaultGeneration, resolveLlmConfig } from "@/core/translator/config";
import { buildProfileShareUrl, readSharedProfile, updateProfileSafely } from "@/core/translator/profileSharing";

vi.hoisted(() => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
});

describe("模型配置迁移和密钥保存", () => {
  it("统一旧认证和保存选项，但保留用户已有上下文条数", () => {
    const migrated = migrateSettings({ apiProfiles: [{ id: "old", model: "a", apiKey: "test-key", authMode: "none", rememberKey: false, modelConfigs: {} }], params: { contextLines: 3, trailingContextLines: 2 } });
    expect(migrated.apiProfiles?.[0]).toMatchObject({ authMode: "bearer", rememberKey: true, apiKey: "test-key" });
    expect(migrated.params).toMatchObject({ contextLines: 3, trailingContextLines: 2 });
    expect(DEFAULT_PARAMS).toMatchObject({ contextLines: 10, trailingContextLines: 5 });
  });
  it("保留旧显式 none、8192 和双轨，迁移不重复改值", () => {
    const old = {
      apiProfiles: [{ id: "old", name: "old", model: "model-a", baseURL: "https://a.test/v1", apiKey: "test-only-secret" }],
      params: { ...DEFAULT_PARAMS, temperature: 0, reasoningEffort: "none", maxTokens: 8192 },
      bilingual: { layout: "dual-entry" },
    };
    const migrated = migrateSettings(old);
    expect(migrated.params).toEqual(old.params);
    expect(migrated.bilingual).toEqual(old.bilingual);
    expect(migrated.apiProfiles?.[0].rememberKey).toBe(true);
    expect(migrated.apiProfiles?.[0].modelConfigs?.["model-a"]).toMatchObject({
      temperature: 0, reasoningEffort: "none", outputBudget: { mode: "manual", limit: 8192 },
    });
    expect(migrateSettings(migrated)).toEqual(migrated);
    expect(old.apiProfiles[0]).not.toHaveProperty("modelConfigs");
  });

  it("不同模型独立恢复参数，未配置的新模型不继承旧全局参数", () => {
    const profile = newProfile({ model: "a", modelConfigs: {
      a: { ...defaultGeneration(), temperature: 0 },
      b: { ...defaultGeneration(), temperature: 0.5 },
    } });
    expect(resolveLlmConfig(profile, DEFAULT_PARAMS).generation?.temperature).toBe(0);
    expect(resolveLlmConfig({ ...profile, model: "b" }, DEFAULT_PARAMS).generation?.temperature).toBe(0.5);
    expect(resolveLlmConfig({ ...profile, model: "new" }, DEFAULT_PARAMS).generation).toEqual(defaultGeneration());
  });

  it("草稿深复制，取消时嵌套配置不修改已保存设置", () => {
    const profile = newProfile({ model: "a", modelConfigs: { a: defaultGeneration() } });
    const state = { ...useAppStore.getState(), apiProfiles: [profile] };
    const draft = snapshotSettings(state);
    draft.apiProfiles[0].modelConfigs!.a.outputBudget.limit = 999;
    expect(profile.modelConfigs!.a.outputBudget.limit).toBe(16384);
  });

  it("新密钥默认保存，旧不记住选项不再影响保存", () => {
    const profile = newProfile({ apiKey: "test-only-secret" });
    expect(profile.rememberKey).toBe(true);
    expect(profilesForStorage([profile])[0].apiKey).toBe("test-only-secret");
    expect(profile.apiKey).toBe("test-only-secret");
    expect(profilesForStorage([{ ...profile, rememberKey: false }])[0].apiKey).toBe("test-only-secret");
  });

  it("读取模型名 __proto__ 不取原型对象", () => {
    const profile = newProfile({ model: "__proto__" });
    expect(resolveLlmConfig(profile).generation).toEqual(defaultGeneration());
  });

  it("实际 Zustand 持久化会写入密钥", () => {
    const state = useAppStore.getState();
    const profile = newProfile({ apiKey: "session-secret", model: "a" });
    state.applySettings({ ...snapshotSettings(state), apiProfiles: [profile], activeProfileId: profile.id });
    const saved = JSON.parse(localStorage.getItem("subtitle-translator")!);
    expect(saved.state.apiProfiles[0].apiKey).toBe("session-secret");
    expect(useAppStore.getState().apiProfiles[0].apiKey).toBe("session-secret");
  });

  it("载入新文件和重置均清理待确认候选", () => {
    useAppStore.getState().setGlossaryCandidates([{ term: "Alice", translation: "艾丽丝" }]);
    useAppStore.getState().setDocument({ taskId: "doc", sourceFormat: "srt", entries: [], meta: {} }, "a.srt", "UTF-8", []);
    expect(useAppStore.getState().glossaryCandidates).toEqual([]);
    useAppStore.getState().setGlossaryCandidates([{ term: "Bob", translation: "鲍勃" }]);
    useAppStore.getState().reset();
    expect(useAppStore.getState().glossaryCandidates).toEqual([]);
  });
});

describe("分享与端点变更", () => {
  const profile = newProfile({ name: "示例", baseURL: "https://api.example.com/v1", model: "a", apiKey: "test-only-secret" });
  it("分享片段包含所选服务密钥和模型参数，不继承原地址", () => {
    const shared = buildProfileShareUrl("https://app.test/?apiKey=old-key#secret", profile);
    expect(new URL(shared).search).toBe("");
    expect(new URLSearchParams(new URL(shared).hash.slice(1)).get("apiKey")).toBe(profile.apiKey);
    expect(shared).not.toContain("old-key");
    expect(readSharedProfile(new URLSearchParams(new URL(shared).hash.slice(1)))?.modelConfigs?.a).toEqual(defaultGeneration());
  });
  it("旧链接可导入密钥，凭据嵌入端点 URL 被拒绝", () => {
    const data = readSharedProfile(new URLSearchParams("baseURL=https%3A%2F%2Fapi.example.com%2Fv1&apiKey=old-secret&model=a"));
    expect(data?.apiKey).toBe("old-secret");
    expect(() => readSharedProfile(new URLSearchParams("baseURL=https%3A%2F%2Fuser%3Apass%40api.example.com"))).toThrow();
  });
  it("特殊字符密钥和中文服务名完整往返，不泄露其他模型配置", () => {
    const source = { ...profile, apiKey: "test-+/=&?#中文", modelConfigs: { a: { ...defaultGeneration(), reasoningEffort: "high" as const }, other: { ...defaultGeneration(), temperature: 1 } } };
    const url = new URL(buildProfileShareUrl("https://app.test/", source));
    const imported = readSharedProfile(new URLSearchParams(url.hash.slice(1)));
    expect(imported?.apiKey).toBe(source.apiKey);
    expect(imported?.name).toBe(source.name);
    expect(imported?.modelConfigs).toEqual({ a: source.modelConfigs.a });
    expect(url.search).toBe("");
  });
  it("改 origin 清密钥，改路径保留密钥但使参数覆盖失效", () => {
    const original = { ...profile, modelConfigs: { a: defaultGeneration() } };
    expect(updateProfileSafely(original, { baseURL: "https://other.test/v1" }).apiKey).toBe("");
    const sameOrigin = updateProfileSafely(original, { baseURL: "https://api.example.com/v2" });
    expect(sameOrigin.apiKey).toBe(profile.apiKey);
    expect(sameOrigin.modelConfigs).toEqual({});
    expect(original.modelConfigs).toHaveProperty("a");
  });
});
