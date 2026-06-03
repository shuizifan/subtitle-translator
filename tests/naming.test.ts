import { describe, expect, it } from "vitest";
import { buildExportName, deriveBaseName } from "@/core/naming";

describe("基础名提取", () => {
  it("去扩展名与已有语言尾标", () => {
    expect(deriveBaseName("Movie.2024.AVC-TM.机翻中英.chs.srt")).toBe("Movie.2024.AVC-TM");
    expect(deriveBaseName("Show.S01E01.eng.srt")).toBe("Show.S01E01");
    expect(deriveBaseName("plain.srt")).toBe("plain");
  });
});

describe("导出文件名", () => {
  it("仅译文：xxx.AI中文.chs.srt", () => {
    expect(
      buildExportName({
        fileName: "Movie.2024.srt",
        type: "translated",
        sourceLang: "English",
        targetLang: "Simplified Chinese",
      }),
    ).toBe("Movie.2024.AI中文.chs.srt");
  });

  it("双语（源语言已知）：xxx.AI中英双语.chs.srt", () => {
    expect(
      buildExportName({
        fileName: "Movie.2024.srt",
        type: "bilingual",
        sourceLang: "English",
        targetLang: "Simplified Chinese",
      }),
    ).toBe("Movie.2024.AI中英双语.chs.srt");
  });

  it("双语（源语言自动检测）退化为 AI中文双语", () => {
    expect(
      buildExportName({
        fileName: "Movie.srt",
        type: "bilingual",
        sourceLang: "auto",
        targetLang: "Simplified Chinese",
      }),
    ).toBe("Movie.AI中文双语.chs.srt");
  });

  it("可覆盖语言码", () => {
    expect(
      buildExportName({
        fileName: "Movie.srt",
        type: "translated",
        sourceLang: "auto",
        targetLang: "Simplified Chinese",
        langCode: "zh",
      }),
    ).toBe("Movie.AI中文.zh.srt");
  });
});
