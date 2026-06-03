import { describe, expect, it } from "vitest";
import { assemble } from "@/core/bilingual";
import type { SubtitleDocument } from "@/core/model";

const doc: SubtitleDocument = {
  taskId: "t",
  sourceFormat: "srt",
  entries: [
    { id: 1, start: 1000, end: 4000, originalText: "Hello", translatedText: "你好", tags: [] },
  ],
  meta: {},
};

describe("双语组装", () => {
  it("双条目同时间轴：原文在前、译文在后、共用时间轴", () => {
    const cues = assemble(doc, { layout: "dual-entry", order: "original-first" });
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1000, end: 4000, text: "Hello" });
    expect(cues[1]).toEqual({ start: 1000, end: 4000, text: "你好" });
  });

  it("单条目双行：可调语言顺序", () => {
    const cues = assemble(doc, { layout: "single-entry", order: "translation-first" });
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("你好\nHello");
  });

  it("合并多行：原文 3 行 + 译文 → 双语仅 2 条单行（默认开启）", () => {
    const d: SubtitleDocument = {
      taskId: "t",
      sourceFormat: "srt",
      entries: [
        {
          id: 1,
          start: 0,
          end: 3000,
          originalText: "line one\nline two\nline three",
          translatedText: "第一行\n第二行\n第三行",
          tags: [],
        },
      ],
      meta: {},
    };
    const cues = assemble(d, { layout: "dual-entry", order: "translation-first", collapseLines: true });
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("第一行 第二行 第三行");
    expect(cues[1].text).toBe("line one line two line three");
  });

  it("关闭合并：保留 cue 内换行", () => {
    const d: SubtitleDocument = {
      taskId: "t",
      sourceFormat: "srt",
      entries: [{ id: 1, start: 0, end: 3000, originalText: "a\nb", translatedText: "甲\n乙", tags: [] }],
    meta: {},
    };
    const cues = assemble(d, { layout: "single-entry", order: "original-first", collapseLines: false });
    expect(cues[0].text).toBe("a\nb\n甲\n乙");
  });

  it("仅译文", () => {
    const cues = assemble(doc, { layout: "translated-only", order: "original-first" });
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("你好");
  });

  it("启用 SRT 颜色时套用 font 标签", () => {
    const cues = assemble(
      doc,
      { layout: "single-entry", order: "original-first" },
      {
        scheme: "自定义",
        enableSrtColor: true,
        original: { primaryColor: "#AAAAAA" },
        translation: { primaryColor: "#FFFFFF" },
      },
    );
    expect(cues[0].text).toBe('<font color="#AAAAAA">Hello</font>\n<font color="#FFFFFF">你好</font>');
  });
});
