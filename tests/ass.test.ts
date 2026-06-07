import { describe, expect, it } from "vitest";
import { parseAss, extractAssText } from "@/core/parsers/ass";
import { serializeAss } from "@/core/serializers/ass";
import { assTimecodeToMs, msToAssTimecode } from "@/core/time";
import { hexToAssColor } from "@/core/styling";
import { DEFAULT_STYLE } from "@/core/styling";

const SAMPLE = [
  "[Script Info]",
  "; sample",
  "Title: Demo",
  "ScriptType: v4.00+",
  "PlayResX: 1920",
  "PlayResY: 1080",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello {\\i1}world{\\i0}",
  "Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,Second line",
  "Comment: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,a translator comment",
  "Dialogue: 0,0:00:08.00,0:00:09.00,Sign,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}",
  "Dialogue: 0,0:00:10.00,0:00:11.00,Default,,0,0,0,,{\\an8}Top sign",
].join("\r\n");

describe("ASS time", () => {
  it("时间码 H:MM:SS.cc ↔ 毫秒", () => {
    expect(assTimecodeToMs("0:00:03.50")).toBe(3500);
    expect(assTimecodeToMs("1:02:03.04")).toBe(3_723_040);
    expect(msToAssTimecode(3500)).toBe("0:00:03.50");
  });
});

describe("ASS color", () => {
  it("#RRGGBB → &HBBGGRR&（BGR 倒序）", () => {
    expect(hexToAssColor("#FFCC00")).toBe("&H00CCFF&");
    expect(hexToAssColor("#FFFFFF")).toBe("&HFFFFFF&");
  });
});

describe("extractAssText", () => {
  it("抽离 {} 覆盖块、\\N→换行", () => {
    const r = extractAssText("Hello {\\i1}world{\\i0}\\Nsecond");
    expect(r.plain).toBe("Hello world\nsecond");
    expect(r.tags.map((t) => t.raw)).toEqual(["{\\i1}", "{\\i0}"]);
  });
});

describe("ASS parser", () => {
  it("只把可翻译 Dialogue 收为条目（跳过 Comment / 绘图 / 纯定位无文字之外的有文字定位仍收）", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    // 可翻译：Hello world / Second line / Top sign（{\an8} 仅定位，仍有文字）
    expect(document.entries).toHaveLength(3);
    expect(document.entries[0].originalText).toBe("Hello world");
    expect(document.entries[0].start).toBe(1000);
    expect(document.entries[0].end).toBe(3500);
    expect(document.entries[2].originalText).toBe("Top sign");
    expect(document.sourceFormat).toBe("ass");
  });

  it("内联标签抽离正确", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    expect(document.entries[0].tags).toEqual([
      { raw: "{\\i1}", offset: "Hello ".length },
      { raw: "{\\i0}", offset: "Hello world".length },
    ]);
  });
});

describe("ASS serializer", () => {
  it("无损往返：仅译文 + 不合并 + 无译文 → 完整还原原文件", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    const out = serializeAss(document, { layout: "translated-only", order: "translation-first", collapseLines: false });
    expect(out).toBe(SAMPLE);
  });

  it("双语堆叠：译文在前，用 \\N 连接，原文保留", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    document.entries[1].translatedText = "第二行"; // 用无中段标签的条目断言核心行为
    const out = serializeAss(document, { layout: "stacked", order: "translation-first", collapseLines: true });
    const line = out.split("\r\n").find((l) => l.includes("第二行"))!;
    expect(line).toContain("第二行\\NSecond line"); // 译文在前、\N 连接、原文保留
    // Comment 与绘图行原样保留
    expect(out).toContain("Comment: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,a translator comment");
    expect(out).toContain("{\\p1}m 0 0 l 10 10{\\p0}");
  });

  it("中段内联标签：原文部分完整保留（译文按 offset 回填，与 SRT 行为一致）", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    document.entries[0].translatedText = "你好世界";
    const out = serializeAss(document, { layout: "stacked", order: "translation-first", collapseLines: true });
    const line = out.split("\r\n").find((l) => l.includes("你好世界"))!;
    expect(line).toContain("\\NHello {\\i1}world{\\i0}"); // 原文行内标签原位还原
  });

  it("启用 SRT 颜色时译文/原文各加 {\\c} 覆盖标签", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    document.entries[0].translatedText = "你好世界";
    const style = { ...DEFAULT_STYLE, enableSrtColor: true, original: { primaryColor: "#FFCC00" }, translation: { primaryColor: "#FFFFFF" } };
    const out = serializeAss(document, { layout: "stacked", order: "translation-first", collapseLines: true }, style);
    const line = out.split("\r\n").find((l) => l.includes("你好世界"))!;
    expect(line).toContain("{\\c&HFFFFFF&}你好世界");
    expect(line).toContain("{\\c&H00CCFF&}Hello");
  });
});
