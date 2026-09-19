import { describe, expect, it } from "vitest";
import { analyzeCleanup, applyCleanup, DEFAULT_CLEANUP } from "@/core/cleanup";
import type { SubtitleDocument } from "@/core/model";

function doc(texts: string[]): SubtitleDocument {
  return {
    taskId: "t",
    sourceFormat: "srt",
    entries: texts.map((t, i) => ({ id: i + 1, start: i * 1000, end: i * 1000 + 900, originalText: t, tags: [] })),
    meta: {},
  };
}

describe("源字幕清理", () => {
  it("片头压制组问候语判为水印", () => {
    const d = doc([
      "Greetz to all other respected RG's out there. Let the Legend Killing Continue...",
      "Good morning.",
    ]);
    const marks = analyzeCleanup(d, DEFAULT_CLEANUP);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ id: 1, action: "drop" });
  });

  it("域名水印在片中也算", () => {
    const d = doc(Array.from({ length: 20 }, (_, i) => (i === 10 ? "www.opensubtitles.org" : `line ${i}`)));
    const marks = analyzeCleanup(d, DEFAULT_CLEANUP);
    expect(marks.map((m) => m.id)).toEqual([11]);
  });

  it("正常台词里的 by 不会误伤", () => {
    const d = doc(["Stand by me.", "Sing a song."]);
    expect(analyzeCleanup(d, DEFAULT_CLEANUP)).toHaveLength(0);
  });

  it("纯符号占位条被剔除，真音符保留", () => {
    const d = doc(["**", "*", "♪", "- Hello", "..."]);
    const marks = analyzeCleanup(d, DEFAULT_CLEANUP);
    expect(marks.map((m) => m.id)).toEqual([1, 2]);
  });

  it("半角 ? 冒充音符：有真音符佐证时还原", () => {
    const d = doc([
      "? Somewhere over the rainbow ?",
      "? Way up high ?",
      "♪ Real note here ♪",
      "Are you sure?",
    ]);
    const marks = analyzeCleanup(d, DEFAULT_CLEANUP);
    expect(marks.map((m) => m.id)).toEqual([1, 2]);
    expect(marks[0].after).toBe("♪ Somewhere over the rainbow ♪");
    // 普通疑问句不动
    expect(marks.find((m) => m.id === 4)).toBeUndefined();
  });

  it("孤立的行尾问号不会被当成音符", () => {
    const d = doc(["Vraiment ?", "Tu viens ?", "Oui."]);
    expect(analyzeCleanup(d, DEFAULT_CLEANUP)).toHaveLength(0);
  });

  it("剥离 <font> 标签（可选项）", () => {
    const d = doc(["Hello"]);
    d.entries[0].tags = [
      { raw: '<font face="sans-serif" size="68">', offset: 0 },
      { raw: "</font>", offset: 5 },
    ];
    const marks = analyzeCleanup(d, { ...DEFAULT_CLEANUP, stripFontTags: true });
    expect(marks.map((m) => m.action)).toEqual(["strip-tags"]);
    applyCleanup(d, marks);
    expect(d.entries[0].tags).toEqual([]);
  });

  it("应用清理：drop 标记 excluded、rewrite 改写原文", () => {
    const d = doc(["www.subscene.com", "? La la la ?", "? Lo lo lo ?", "? Li li li ?", "Hello"]);
    const marks = analyzeCleanup(d, DEFAULT_CLEANUP);
    applyCleanup(d, marks);
    expect(d.entries[0].excluded).toBe(true);
    expect(d.entries[0].excludedReason).toBeTruthy();
    expect(d.entries[1].originalText).toBe("♪ La la la ♪");
    expect(d.entries[4].excluded).toBeUndefined();
  });

  it("关掉某项就不再产生该类标记", () => {
    const d = doc(["**", "www.opensubtitles.org"]);
    const marks = analyzeCleanup(d, { ...DEFAULT_CLEANUP, removeSymbolOnly: false, removeWatermarks: false });
    expect(marks).toHaveLength(0);
  });
});

describe("被排除的条目不进导出", () => {
  it("SRT 组装跳过 excluded", async () => {
    const { assemble } = await import("@/core/bilingual");
    const d = doc(["www.opensubtitles.org", "Hello"]);
    d.entries[0].excluded = true;
    d.entries[1].translatedText = "你好";
    const cues = assemble(d, { layout: "single-entry", order: "translation-first" });
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("你好\nHello");
  });
});
