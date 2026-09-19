import { describe, expect, it } from "vitest";
import { inspectDocument, inspectEntry, targetIsCjk } from "@/core/qa";
import type { SubtitleDocument, SubtitleEntry } from "@/core/model";

const entry = (p: Partial<SubtitleEntry>): SubtitleEntry => ({
  id: 1,
  start: 0,
  end: 1000,
  originalText: "",
  ...p,
});

describe("译文体检", () => {
  it("未翻译", () => {
    expect(inspectEntry(entry({ originalText: "Hello there" }), "Simplified Chinese")).toContain("untranslated");
  });
  it("原样返回原文", () => {
    const codes = inspectEntry(
      entry({ originalText: "Auf Wiedersehen, mein Freund", translatedText: "Auf Wiedersehen, mein Freund" }),
      "Simplified Chinese",
    );
    expect(codes).toContain("same-as-source");
    expect(codes).toContain("missing-target-script");
  });
  it("单个专名原样保留不算问题", () => {
    expect(inspectEntry(entry({ originalText: "Robert", translatedText: "Robert" }), "Simplified Chinese")).toEqual([]);
  });
  it("纯符号条目不参与判定", () => {
    expect(inspectEntry(entry({ originalText: "♪", translatedText: "♪" }), "Simplified Chinese")).toEqual([]);
  });
  it("长度比异常", () => {
    const codes = inspectEntry(
      entry({ originalText: "Where do you think you are going tonight?", translatedText: "去哪" }),
      "Simplified Chinese",
    );
    expect(codes).toContain("length-outlier");
  });
  it("正常译文没有问题", () => {
    expect(inspectEntry(entry({ originalText: "Where are you going?", translatedText: "你要去哪儿？" }), "Simplified Chinese")).toEqual([]);
  });
  it("被排除的条目跳过体检", () => {
    expect(inspectEntry(entry({ originalText: "www.opensubtitles.org", excluded: true }), "Simplified Chinese")).toEqual([]);
  });
  it("整篇体检返回命中条目", () => {
    const doc: SubtitleDocument = {
      taskId: "t",
      sourceFormat: "srt",
      entries: [
        entry({ id: 1, originalText: "Hello", translatedText: "你好" }),
        entry({ id: 2, originalText: "Good morning everyone", translatedText: "Good morning everyone" }),
      ],
      meta: {},
    };
    const findings = inspectDocument(doc, "Simplified Chinese");
    expect(findings.map((f) => f.id)).toEqual([2]);
  });
  it("目标语种判定", () => {
    expect(targetIsCjk("Simplified Chinese")).toBe(true);
    expect(targetIsCjk("English")).toBe(false);
  });
});
