import { beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "@/store";
import type { SubtitleDocument } from "@/core/model";

vi.hoisted(() => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});

const doc: SubtitleDocument = { taskId: "test", sourceFormat: "srt", entries: [], meta: {} };
beforeEach(() => useAppStore.getState().reset());

it("自定义前缀仅用于当前文档，换文件和清空文档恢复默认", () => {
  const store = useAppStore.getState();
  store.setDocument(doc, "Movie.srt", "UTF-8", []);
  store.setExportBaseName("自定义片名");
  expect(useAppStore.getState().exportBaseName).toBe("自定义片名");
  store.setDocument({ ...doc, taskId: "next" }, "Next.srt", "UTF-8", []);
  expect(useAppStore.getState().exportBaseName).toBe("");
  store.setExportBaseName("下一部");
  store.reset();
  expect(useAppStore.getState().exportBaseName).toBe("");
});
