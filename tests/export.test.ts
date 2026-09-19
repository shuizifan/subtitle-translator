import { describe, expect, it } from "vitest";
import { buildExport, exportName, type ExportSettings } from "@/lib/exportDoc";
import { DEFAULT_STYLE, DEFAULT_ASS_STYLE } from "@/core/styling";
import type { SubtitleDocument } from "@/core/model";

const settings: ExportSettings = {
  params: { sourceLang: "English", targetLang: "Simplified Chinese" },
  bilingual: {
    layout: "single-entry",
    order: "translation-first",
    langCode: "",
    translatedLabel: "",
    bilingualLabel: "",
    collapseLines: true,
  },
  style: DEFAULT_STYLE,
  assStyle: DEFAULT_ASS_STYLE,
};

const doc: SubtitleDocument = {
  taskId: "t",
  sourceFormat: "srt",
  entries: [
    { id: 1, start: 1000, end: 4000, originalText: "Hello there", translatedText: "你好啊", tags: [] },
    { id: 2, start: 5000, end: 6000, originalText: "www.opensubtitles.org", excluded: true, tags: [] },
  ],
  meta: { eol: "\n" },
};

describe("导出组装", () => {
  it("双语：单轨两行、跳过被排除条目", () => {
    const out = buildExport(doc, "Movie.2019.eng.srt", "bilingual", settings);
    expect(out.filename).toBe("Movie.2019.AI中英双语.chs.srt");
    expect(out.content).toContain("你好啊\nHello there");
    expect(out.content).not.toContain("opensubtitles");
    // 只有一条 cue
    expect(out.content.trim().split("\n\n")).toHaveLength(1);
  });

  it("仅译文：文件名与内容", () => {
    const out = buildExport(doc, "Movie.2019.eng.srt", "translated", settings);
    expect(out.filename).toBe("Movie.2019.AI中文.chs.srt");
    expect(out.content).toContain("你好啊");
    expect(out.content).not.toContain("Hello there");
  });

  it("源语言未知时退化成「AI中文双语」", () => {
    const s = { ...settings, params: { sourceLang: "auto", targetLang: "Simplified Chinese" } };
    expect(exportName("Movie.srt", "bilingual", "srt", s)).toBe("Movie.AI中文双语.chs.srt");
  });

  it("VTT 解析结果按 SRT 导出", () => {
    const vttDoc: SubtitleDocument = { ...doc, sourceFormat: "vtt" };
    const out = buildExport(vttDoc, "Movie.vtt", "bilingual", settings);
    expect(out.ext).toBe("srt");
    expect(out.filename.endsWith(".srt")).toBe(true);
  });
});
