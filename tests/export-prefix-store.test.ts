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

it("载入原文件基础名作为可编辑前缀，换文件恢复新文件的基础名", () => {
  const store = useAppStore.getState();
  store.setDocument(doc, "Movie.2026.eng.srt", "UTF-8", []);
  expect(useAppStore.getState().exportBaseName).toBe("Movie.2026");
  store.setExportBaseName("自定义片名");
  expect(useAppStore.getState().exportBaseName).toBe("自定义片名");
  store.setDocument({ ...doc, taskId: "next" }, "Next.srt", "UTF-8", []);
  expect(useAppStore.getState().exportBaseName).toBe("Next");
  store.setExportBaseName("下一部");
  store.reset();
  expect(useAppStore.getState().exportBaseName).toBe("");
});
