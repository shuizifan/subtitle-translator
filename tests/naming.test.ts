import { describe, expect, it } from "vitest";
import { buildExportName, deriveBaseName } from "@/core/naming";

describe("基础名提取", () => {
  it("去扩展名与已有语言尾标", () => {
    expect(deriveBaseName("Movie.2024.AVC-TM.机翻中英.chs.srt")).toBe("Movie.2024.AVC-TM");
    expect(deriveBaseName("Show.S01E01.eng.srt")).toBe("Show.S01E01");
    expect(deriveBaseName("plain.srt")).toBe("plain");
  });

  it("剥离中英文语言标记并保留空格（匹配视频名）", () => {
    // .英 与 .en 两段语言尾标都应剥离，空格、括号、连字符保留
    expect(deriveBaseName("换精计划 (2010) - 1080p.英.en.ass")).toBe("换精计划 (2010) - 1080p");
    expect(deriveBaseName("片名.简体.ass")).toBe("片名");
    expect(deriveBaseName("片名.中英.srt")).toBe("片名");
    // 不误伤：1080p、(2010) 不是语言标记
    expect(deriveBaseName("换精计划 (2010) - 1080p.ass")).toBe("换精计划 (2010) - 1080p");
    // 防过度剥离：短名不被剥光
    expect(deriveBaseName("3.德.srt")).toBe("3.德");
  });

  it("导出名保留原始空格（如浏览器把空格改成下划线，属浏览器行为）", () => {
    expect(
      buildExportName({
        fileName: "换精计划 (2010) - 1080p.英.en.ass",
        type: "bilingual",
        sourceLang: "auto",
        targetLang: "Simplified Chinese",
        ext: "ass",
      }),
    ).toBe("换精计划 (2010) - 1080p.AI中文双语.chs.ass");
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
