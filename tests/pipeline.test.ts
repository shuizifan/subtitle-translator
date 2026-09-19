// 端到端串一遍：解析 → 清理 → 语种判定 → 术语表 → 翻译 → 体检 → 导出。
import { describe, expect, it } from "vitest";
import { parseSrt } from "@/core/parsers/srt";
import { analyzeCleanup, applyCleanup, DEFAULT_CLEANUP } from "@/core/cleanup";
import { detectLanguage } from "@/core/detect";
import { buildGlossary } from "@/core/glossary/build";
import { translateDocument } from "@/core/translator/engine";
import { inspectDocument } from "@/core/qa";
import { buildExport, type ExportSettings } from "@/lib/exportDoc";
import { DEFAULT_ASS_STYLE, DEFAULT_STYLE } from "@/core/styling";
import type { LlmCaller } from "@/core/translator/llmClient";

const SRT = `1
00:00:01,000 --> 00:00:03,000
Greetz to all other respected RG's out there.

2
00:00:04,000 --> 00:00:06,000
Robert, are you coming?

3
00:00:07,000 --> 00:00:09,000
I told Robert to wait for us
at the station.

4
00:00:10,000 --> 00:00:12,000
**

5
00:00:13,000 --> 00:00:15,000
Where is Robert now?
`;

const TRANSLATIONS: Record<string, string> = {
  "Robert, are you coming?": "罗伯特，你来吗？",
  "I told Robert to wait for us\nat the station": "我叫罗伯特在车站\n等我们",
  "Where is Robert now?": "罗伯特现在在哪儿？",
};

/** 假模型：术语表请求返回固定译名，翻译请求按表回译。 */
const caller: LlmCaller = async (messages) => {
  const user = messages[1].content;
  if (messages[0].content.includes("building a glossary")) {
    return '[{"term":"Robert","translation":"罗伯特"}]';
  }
  const batch = JSON.parse(user.slice(user.lastIndexOf("["))) as { id: number; text: string }[];
  return JSON.stringify(
    batch.map((b) => ({
      id: b.id,
      text: TRANSLATIONS[b.text.replace(/\.$/, "")] ?? TRANSLATIONS[b.text] ?? b.text,
    })),
  );
};

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

describe("整条链路", () => {
  it("清理 → 判定 → 术语表 → 翻译 → 体检 → 导出", async () => {
    const { document } = parseSrt(SRT, "task");
    expect(document.entries).toHaveLength(5);

    // 清理：水印 + 纯符号条被排除
    const marks = analyzeCleanup(document, DEFAULT_CLEANUP);
    applyCleanup(document, marks);
    expect(document.entries.filter((e) => e.excluded).map((e) => e.id)).toEqual([1, 4]);

    // 语种判定
    const texts = document.entries.filter((e) => !e.excluded).map((e) => e.originalText);
    expect(detectLanguage(texts).lang).toBe("English");

    // 术语表
    const { entries: glossary } = await buildGlossary(texts, caller, {
      sourceLang: "English",
      targetLang: "Simplified Chinese",
    });
    expect(glossary).toEqual([{ term: "Robert", translation: "罗伯特" }]);

    // 翻译（被排除的条目不参与）
    const result = await translateDocument(document, caller, {
      sourceLang: "English",
      targetLang: "Simplified Chinese",
      batchSize: 2,
      concurrency: 2,
      maxRetries: 1,
      contextLines: 2,
      trailingContextLines: 2,
      glossary,
    });
    expect(result.failedIds).toEqual([]);
    expect(document.entries[0].translatedText).toBeUndefined(); // 水印条
    expect(document.entries[1].translatedText).toBe("罗伯特，你来吗？");

    // 体检：全部通过
    expect(inspectDocument(document, "Simplified Chinese")).toEqual([]);

    // 导出：排除条不出现，中文换行合并不加空格，双语两行
    const out = buildExport(document, "Movie.2019.eng.srt", "bilingual", settings);
    expect(out.filename).toBe("Movie.2019.AI中英双语.chs.srt");
    expect(out.content).not.toContain("Greetz");
    expect(out.content).not.toContain("**");
    expect(out.content).toContain("我叫罗伯特在车站等我们");
    expect(out.content).toContain("I told Robert to wait for us at the station.");
    // 3 条有效字幕 → 3 个 cue（源文件用 \n 换行，导出沿用）
    expect(out.content.trim().split("\n\n")).toHaveLength(3);
  });
});
