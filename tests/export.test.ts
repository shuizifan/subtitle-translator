import { describe, expect, it } from "vitest";
import { buildExport, exportName, exportSuffix, type ExportSettings } from "@/lib/exportDoc";
import { DEFAULT_STYLE, DEFAULT_ASS_STYLE } from "@/core/styling";
import type { SubtitleDocument } from "@/core/model";
import { parseAss } from "@/core/parsers/ass";

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
  it("后缀预览与实际导出一致，随格式、标签和语言码变化", () => {
    expect(exportSuffix("translated", "srt", settings)).toBe(".AI中文.chs.srt");
    expect(exportSuffix("bilingual", "ass", settings)).toBe(".AI中英双语.chs.ass");
    const custom = { ...settings, exportBaseName: "新名字", bilingual: { ...settings.bilingual, langCode: "zh", bilingualLabel: "自定义双语" } };
    expect(exportSuffix("bilingual", "ass", custom)).toBe(".自定义双语.zh.ass");
    expect(exportName("Movie.ass", "bilingual", "ass", custom)).toBe(`新名字${exportSuffix("bilingual", "ass", custom)}`);
  });

  it("自定义前缀同时用于文件名预览和两种实际导出", () => {
    const custom = { ...settings, exportBaseName: " 新片名 (2026).eng " };
    for (const type of ["translated", "bilingual"] as const) {
      const out = buildExport(doc, "Movie.eng.srt", type, custom);
      expect(out.filename).toBe(exportName("Movie.eng.srt", type, "srt", custom));
      expect(out.filename.startsWith("新片名 (2026).eng.")).toBe(true);
    }
    const ass = parseAss("[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello", "ass-test").document;
    expect(buildExport(ass, "Movie.ass", "bilingual", custom).filename).toBe("新片名 (2026).eng.AI中英双语.chs.ass");
  });

  it("空前缀恢复默认，非法文件名字符不会生成路径", () => {
    expect(exportName("Movie.eng.srt", "translated", "srt", { ...settings, exportBaseName: "   " })).toBe("Movie.AI中文.chs.srt");
    expect(exportName("Movie.srt", "translated", "srt", { ...settings, exportBaseName: '片名/季:1\\集?*"<>|\u0000' })).toBe("片名_季_1_集_______.AI中文.chs.srt");
  });

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
