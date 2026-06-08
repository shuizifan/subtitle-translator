import { describe, expect, it } from "vitest";
import { parseAss, extractAssText } from "@/core/parsers/ass";
import { serializeAss } from "@/core/serializers/ass";
import { looksAlreadyBilingual } from "@/core/bilingual";
import { assTimecodeToMs, msToAssTimecode } from "@/core/time";
import { hexToAssColor, pctToAssFs, DEFAULT_STYLE, DEFAULT_ASS_STYLE } from "@/core/styling";

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
  it("3 位简写正确展开（#FFF→白，非橙）", () => {
    expect(hexToAssColor("#FFF")).toBe("&HFFFFFF&");
    expect(hexToAssColor("#F00")).toBe("&H0000FF&"); // 红 → BGR
  });
});

describe("ASS time 进位", () => {
  it("厘秒进位不溢出（995ms→1.00 而非 0.100）", () => {
    expect(msToAssTimecode(995)).toBe("0:00:01.00");
    expect(msToAssTimecode(1999)).toBe("0:00:02.00");
    expect(msToAssTimecode(59_995)).toBe("0:01:00.00");
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

  it("默认（保留模式）：不加 {\\fs}、不注入、源样式照旧", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    document.entries[1].translatedText = "第二行";
    const out = serializeAss(
      document,
      { layout: "stacked", order: "translation-first", collapseLines: true },
      undefined,
      DEFAULT_ASS_STYLE, // forceStyle 默认 false
    );
    const line = out.split("\r\n").find((l) => l.includes("第二行"))!;
    expect(line).not.toContain("\\fs");
    expect(document.entries[0].tags).toBeTruthy(); // 源标签仍在
  });

  it("强制统一：译文大、原文小，按 PlayResY 折算 {\\fs}", () => {
    const { document } = parseAss(SAMPLE, "task-ass"); // SAMPLE PlayResY=1080
    document.entries[1].translatedText = "第二行";
    const out = serializeAss(
      document,
      { layout: "stacked", order: "translation-first", collapseLines: true },
      undefined,
      { ...DEFAULT_ASS_STYLE, forceStyle: true }, // 译文 5.5% / 原文 4.2% → 59 / 45
    );
    const line = out.split("\r\n").find((l) => l.includes("第二行"))!;
    expect(line).toContain(`{\\fs${pctToAssFs(DEFAULT_ASS_STYLE.translationPct, 1080)}}第二行`);
    expect(line).toContain(`{\\fs${pctToAssFs(DEFAULT_ASS_STYLE.originalPct, 1080)}}Second line`);
    expect(pctToAssFs(DEFAULT_ASS_STYLE.translationPct, 1080)).toBeGreaterThan(pctToAssFs(DEFAULT_ASS_STYLE.originalPct, 1080)); // 译文 > 原文
  });

  it("强制统一：剥离源对白的装饰标签（如 {\\i1}），让我方字号真正生效", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    document.entries[0].translatedText = "你好世界";
    const out = serializeAss(
      document,
      { layout: "stacked", order: "translation-first", collapseLines: true },
      undefined,
      { ...DEFAULT_ASS_STYLE, forceStyle: true },
    );
    const line = out.split("\r\n").find((l) => l.includes("你好世界"))!;
    expect(line).not.toContain("{\\i1}"); // 源装饰标签被剥离
    expect(line).toContain(`{\\fs${pctToAssFs(DEFAULT_ASS_STYLE.originalPct, 1080)}}Hello world`); // 我方字号生效
  });

  it("强制统一：混合块 {\\an8\\fs30\\c..} 只保留结构标签、剥离其中装饰标签", () => {
    const src = [
      "[Script Info]",
      "PlayResX: 1920",
      "PlayResY: 1080",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8\\fs30\\1c&HFF0000&}标题文字",
    ].join("\r\n");
    const { document } = parseAss(src, "t");
    document.entries[0].translatedText = "Title";
    const out = serializeAss(document, { layout: "translated-only", order: "translation-first", collapseLines: true }, undefined, { ...DEFAULT_ASS_STYLE, forceStyle: true });
    const line = out.split("\r\n").find((l) => l.startsWith("Dialogue:"))!;
    expect(line).toContain("\\an8"); // 结构（定位）保留
    expect(line).not.toContain("\\fs30"); // 源装饰字号被剥离
    expect(line).not.toContain("\\1c&HFF0000&"); // 源装饰颜色被剥离
    expect(line).toContain(`\\fs${pctToAssFs(DEFAULT_ASS_STYLE.translationPct, 1080)}`); // 我方字号生效
  });

  it("只声明 PlayResX 时不注入重复 PlayResX，仅补 PlayResY", () => {
    const src = [
      "[Script Info]",
      "PlayResX: 1920",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello",
    ].join("\r\n");
    const { document } = parseAss(src, "t");
    const out = serializeAss(document, { layout: "translated-only", order: "translation-first", collapseLines: false }, undefined, { ...DEFAULT_ASS_STYLE, forceStyle: true });
    expect(out.match(/PlayResX/g)!.length).toBe(1); // 不重复
    expect(out).toContain("PlayResY: 1080"); // 按 16:9 从 1920 推导补齐
  });

  it("字号随 PlayResY 等比缩放（720p 比 1080p 小）", () => {
    expect(pctToAssFs(5.5, 720)).toBeLessThan(pctToAssFs(5.5, 1080));
    expect(pctToAssFs(5.5, 720)).toBe(40);
  });

  it("缺 PlayRes：折算基准为 288；强制样式时注入 384×288（非 1080）", () => {
    const noRes = SAMPLE.replace("PlayResX: 1920\r\n", "").replace("PlayResY: 1080\r\n", "");
    const { document } = parseAss(noRes, "task-ass");
    expect((document.meta.ass as { playResY: number }).playResY).toBe(288);
    const out = serializeAss(document, { layout: "translated-only", order: "translation-first", collapseLines: false }, undefined, { ...DEFAULT_ASS_STYLE, forceStyle: true });
    expect(out).toContain("PlayResX: 384");
    expect(out).toContain("PlayResY: 288");
    expect(out).not.toContain("PlayResY: 1080");
  });

  it("保留模式缺 PlayRes 时不注入、不改文件结构", () => {
    const noRes = SAMPLE.replace("PlayResX: 1920\r\n", "").replace("PlayResY: 1080\r\n", "");
    const { document } = parseAss(noRes, "task-ass");
    const out = serializeAss(document, { layout: "translated-only", order: "translation-first", collapseLines: false }, undefined, DEFAULT_ASS_STYLE);
    expect(out).not.toContain("PlayResX");
    expect(out).toBe(noRes); // 无译文 + 保留 → 原样
  });

  it("强制 + 启用 SRT 颜色：译文/原文各加主色覆盖", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    document.entries[0].translatedText = "你好世界";
    const style = { ...DEFAULT_STYLE, enableSrtColor: true, original: { primaryColor: "#FFCC00" }, translation: { primaryColor: "#FFFFFF" } };
    const out = serializeAss(document, { layout: "stacked", order: "translation-first", collapseLines: true }, style, { ...DEFAULT_ASS_STYLE, forceStyle: true });
    const line = out.split("\r\n").find((l) => l.includes("你好世界"))!;
    expect(line).toContain("\\c&HFFFFFF&"); // 译文白
    expect(line).toContain("\\c&H00CCFF&"); // 原文金黄（BGR）
  });

  it("保留模式 + 启用 SRT 颜色：不加颜色（忠实源样式）", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    document.entries[0].translatedText = "你好世界";
    const style = { ...DEFAULT_STYLE, enableSrtColor: true, translation: { primaryColor: "#FFFFFF" } };
    const out = serializeAss(document, { layout: "stacked", order: "translation-first", collapseLines: true }, style, DEFAULT_ASS_STYLE);
    const line = out.split("\r\n").find((l) => l.includes("你好世界"))!;
    expect(line).not.toContain("\\c&H");
  });
});

// 回归：还原"YYeTs 双语 fansub"那次崩坏的结构（无 PlayRes、Default fs20、英文行内 {\fs14}）
const YYETS = [
  "[Script Info]",
  "ScriptType: v4.00+",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  "Style: Default,方正黑体简体,20,&H00FFFFFF,&HF0000000,&H00000000,&H32000000,0,0,0,0,100,100,0,0.00,1,2,1,2,5,5,2,134",
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  "Dialogue: 0,0:00:53.13,0:00:59.38,Default,NTP,0000,0000,0000,,看看我们\\N{\\fn微软雅黑}{\\b0}{\\fs14}{\\3c&H202020&}{\\shad1}Look at us.",
].join("\r\n");

describe("YYeTs 双语 fansub 回归（默认保留模式不再崩坏）", () => {
  it("默认导出不注入 PlayRes、不改字号、保留源内联 {\\fs14}", () => {
    const { document } = parseAss(YYETS, "task-y");
    const out = serializeAss(
      document,
      { layout: "translated-only", order: "translation-first", collapseLines: false },
      undefined,
      DEFAULT_ASS_STYLE, // 默认 forceStyle=false
    );
    expect(out).not.toContain("PlayResX"); // 不再注入 1080 → 不会整体缩小
    expect(out).toContain("Fontsize"); // Styles 段原样保留
    expect(out).toContain("Style: Default,方正黑体简体,20,"); // fs20 未被改动
    expect(out).not.toContain("\\fs59"); // 未强加我方字号
  });
});

describe("already-bilingual detection", () => {
  it("中英堆叠的字幕被识别为已双语", () => {
    const bi = [
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,你好世界\\NHello world",
      "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,再见朋友\\NGoodbye my friend",
      "Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,谢谢你\\NThank you very much",
    ].join("\r\n");
    const { document } = parseAss(bi, "task-bi");
    expect(looksAlreadyBilingual(document)).toBe(true);
  });

  it("纯英文字幕不会被误判", () => {
    const { document } = parseAss(SAMPLE, "task-ass");
    expect(looksAlreadyBilingual(document)).toBe(false);
  });
});
