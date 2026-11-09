import { beforeEach, expect, it, vi } from "vitest";
import { parseSrt } from "@/core/parsers/srt";
import { newProfile, snapshotSettings, useAppStore } from "@/store";
import { DEFAULT_BATCH_OPTIONS, runOne } from "@/lib/useBatchQueue";

const mock = vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  vi.stubGlobal("window", { localStorage: storage });
  return { call: vi.fn() };
});
vi.mock("@/lib/requestDiagnostics", () => ({ createTrackedCaller: () => mock.call, resetRequestDiagnostics: () => {} }));
vi.mock("@/lib/SubtitleLoaderContext", () => ({ useSubtitleLoaderContext: () => ({}) }));
const source = "1\n00:00:01,000 --> 00:00:02,000\nI saw Robert today.\n\n2\n00:00:03,000 --> 00:00:04,000\nWe waited for Robert again.\n";

beforeEach(() => {
  useAppStore.getState().reset();
  const profile = newProfile({ baseURL: "https://api.openai.com/v1", model: "test", apiKey: "not-a-real-key" });
  useAppStore.setState({ apiProfiles: [profile], activeProfileId: profile.id, queue: [{ id: "q1", name: "sample.srt", path: "sample.srt", bytes: new TextEncoder().encode(source), size: source.length, status: "pending" }] });
  mock.call.mockReset();
});

it("候选生成期间文档被替换，旧任务结果不写入新文档候选", async () => {
  let resolve!: (text: string) => void;
  mock.call.mockImplementation(() => new Promise<string>((r) => { resolve = r; }));
  const loader = () => useAppStore.getState().setDocument(parseSrt(source, "old-task").document, "sample.srt", "utf-8", []);
  const run = runOne(useAppStore.getState().queue[0], { ...DEFAULT_BATCH_OPTIONS, glossaryPerFile: true }, new AbortController().signal, loader, snapshotSettings(useAppStore.getState()));
  expect(mock.call).toHaveBeenCalledTimes(1);
  useAppStore.getState().setDocument(parseSrt(source, "new-task").document, "new.srt", "utf-8", []);
  // 模拟新文档任务已开始，旧任务收尾不得重置其状态。
  useAppStore.getState().setPhase("translating");
  resolve('{"items":[{"term":"Robert","translation":"罗伯特"}]}');
  await run;
  expect(useAppStore.getState().document?.taskId).toBe("new-task");
  expect(useAppStore.getState().glossaryCandidates).toEqual([]);
  expect(useAppStore.getState().glossaryStatus).toBe("idle");
  expect(useAppStore.getState().phase).toBe("translating");
  expect(useAppStore.getState().queue[0].status).not.toBe("review");
});

it("批量解析收到启动时快照，实时清理设置不影响后续文件", async () => {
  const settings = snapshotSettings(useAppStore.getState());
  settings.cleanup.removeWatermarks = false;
  useAppStore.getState().setCleanup({ removeWatermarks: true });
  mock.call.mockResolvedValue('{"items":[{"id":1,"text":"我今天见到罗伯特。"},{"id":2,"text":"我们又等了罗伯特。"}]}');
  const loader = vi.fn(() => useAppStore.getState().setDocument(parseSrt(source, "snapshot-task").document, "sample.srt", "utf-8", []));
  const item = useAppStore.getState().queue[0];
  await runOne(item, DEFAULT_BATCH_OPTIONS, new AbortController().signal, loader, settings);
  expect(loader).toHaveBeenCalledWith(item.bytes, item.name, "auto", settings);
});
