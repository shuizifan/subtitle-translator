import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptNewGlossaryEntries, parseGlossaryResponse, selectGlossaryFor } from "@/core/glossary";
import { buildGlossary } from "@/core/glossary/build";
import { LlmError } from "@/core/translator/llmClient";
import { parseSrt } from "@/core/parsers/srt";
import { newProfile, snapshotSettings, useAppStore } from "@/store";
import { DEFAULT_BATCH_OPTIONS, runOne } from "@/lib/useBatchQueue";

const mock = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/requestDiagnostics", () => ({ createTrackedCaller: () => mock.call, resetRequestDiagnostics: () => {} }));
vi.mock("@/lib/SubtitleLoaderContext", () => ({ useSubtitleLoaderContext: () => ({}) }));
const source = "1\n00:00:01,000 --> 00:00:02,000\nI saw Robert today.\n\n2\n00:00:03,000 --> 00:00:04,000\nWe waited for Robert again.\n";

describe("术语候选审核", () => {
  it("批量接受新词不覆盖已有词条，大小写变体也属于冲突", () => {
    const existing = [{ term: "Robert", translation: "人工译名" }];
    expect(acceptNewGlossaryEntries(existing, [{ term: "ROBERT", translation: "自动译名" }, { term: "Alice", translation: "艾丽丝" }])).toEqual([...existing, { term: "Alice", translation: "艾丽丝" }]);
    expect(existing).toEqual([{ term: "Robert", translation: "人工译名" }]);
  });
  it("兼容新对象协议，英文词条不会误命中长词内部", () => {
    expect(parseGlossaryResponse('{"items":[{"term":"Robert","translation":"罗伯特"}]}')).toEqual([{ term: "Robert", translation: "罗伯特" }]);
    expect(selectGlossaryFor([{ term: "Ann", translation: "安" }], ["Anna, come here."])).toEqual([]);
    expect(selectGlossaryFor([{ term: "Robert", translation: "罗伯特" }], ["ROBERT!"])).toHaveLength(1);
  });
  it("认证错误保留错误类型且不继续后续术语批次", async () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima"];
    const caller = vi.fn(async () => { throw new LlmError("认证失败", 401); });
    await expect(buildGlossary(names.flatMap((n) => [`I met ${n}.`, `We waited for ${n}.`]), caller, { sourceLang: "English", targetLang: "Chinese", chunkSize: 10, concurrency: 1 })).rejects.toMatchObject({ status: 401 });
    expect(caller).toHaveBeenCalledTimes(1);
  });
});

describe("批量术语审核与队列终止", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    const profile = newProfile({ baseURL: "https://api.openai.com/v1", model: "test", apiKey: "test-only-not-a-real-key" });
    useAppStore.setState({ apiProfiles: [profile], activeProfileId: profile.id, queue: [{ id: "q1", name: "sample.srt", path: "sample.srt", bytes: new TextEncoder().encode(source), size: source.length, status: "pending" }] });
    mock.call.mockReset();
  });
  const load = () => {
    useAppStore.getState().setDocument(parseSrt(source, "task1").document, "sample.srt", "utf-8", []);
    useAppStore.getState().setGlossary([{ term: "Robert", translation: "人工译名" }]);
  };
  it("先暂停审核，确认后继续，不重新载入或覆盖人工词条", async () => {
    const settings = snapshotSettings(useAppStore.getState());
    mock.call.mockImplementation(async (_messages, _signal, options) => options?.purpose === "glossary"
      ? '{"items":[{"term":"Robert","translation":"自动译名"}]}'
      : '{"items":[{"id":1,"text":"我今天见到他。"},{"id":2,"text":"我们又等了他。"}]}');
    const loader = vi.fn(load);
    const opts = { ...DEFAULT_BATCH_OPTIONS, glossaryPerFile: true };
    expect(await runOne(useAppStore.getState().queue[0], opts, new AbortController().signal, loader, settings)).toBe("pause");
    expect(useAppStore.getState().queue[0].status).toBe("review");
    expect(useAppStore.getState().glossary[0].translation).toBe("人工译名");
    expect(useAppStore.getState().document!.entries[0].translatedText).toBeUndefined();
    useAppStore.getState().setGlossaryCandidates([]); // 用户选择保留已确认词条
    expect(await runOne(useAppStore.getState().queue[0], opts, new AbortController().signal, loader, settings)).toBe("continue");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().queue[0].status).toBe("done");
    expect(useAppStore.getState().glossary[0].translation).toBe("人工译名");
  });
  it("翻译认证错误停止队列，不导出伪完成文件", async () => {
    mock.call.mockRejectedValue(new LlmError("认证失败", 401));
    expect(await runOne(useAppStore.getState().queue[0], DEFAULT_BATCH_OPTIONS, new AbortController().signal, load, snapshotSettings(useAppStore.getState()))).toBe("stop");
    expect(useAppStore.getState().queue[0]).toMatchObject({ status: "error" });
    expect(useAppStore.getState().queue[0].outputs).toBeUndefined();
  });
  it("部分条目失败时不能把队列文件标成全部完成", async () => {
    mock.call.mockResolvedValue('{"items":[{"id":1,"text":"只完成第一条"}]}');
    const settings = snapshotSettings(useAppStore.getState());
    settings.params.maxRetries = 0;
    await runOne(useAppStore.getState().queue[0], DEFAULT_BATCH_OPTIONS, new AbortController().signal, load, settings);
    expect(useAppStore.getState().queue[0]).toMatchObject({ status: "error", error: "有 1 条未翻译" });
    expect(useAppStore.getState().document!.entries[0].translatedText).toBe("只完成第一条");
  });
});
