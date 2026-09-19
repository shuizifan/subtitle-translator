import { describe, expect, it } from "vitest";
import { parseVtt } from "@/core/parsers/vtt";
import { parseLrc } from "@/core/parsers/lrc";
import { parseSrt } from "@/core/parsers/srt";

describe("WebVTT 解析", () => {
  it("解析标准 cue（含标识行、布局设置、NOTE 段）", () => {
    const vtt = `WEBVTT - Some title

NOTE
这是一段注释，不该被当成字幕

cue-1
00:00:01.000 --> 00:00:04.000 line:90% align:middle
Hello there
second line

2
00:01:02.500 --> 00:01:05.000
<v Roger>Bye`;
    const { document } = parseVtt(vtt, "t");
    expect(document.sourceFormat).toBe("vtt");
    expect(document.entries).toHaveLength(2);
    expect(document.entries[0]).toMatchObject({ start: 1000, end: 4000, originalText: "Hello there\nsecond line" });
    expect(document.entries[1].start).toBe(62500);
    // 内联标签被抽离保护
    expect(document.entries[1].originalText).toBe("Bye");
  });

  it("省略小时位的时间码", () => {
    const { document } = parseVtt("WEBVTT\n\n00:05.000 --> 00:09.000\nHi", "t");
    expect(document.entries[0]).toMatchObject({ start: 5000, end: 9000 });
  });

  it("非法文件抛错", () => {
    expect(() => parseVtt("not a subtitle at all", "t")).toThrow();
  });
});

describe("LRC 解析", () => {
  it("行结束时间取下一行开始，末行给默认时长", () => {
    const lrc = `[ar:Someone]
[ti:Song]
[00:12.00]First line
[00:15.30]Second line`;
    const { document } = parseLrc(lrc, "t");
    expect(document.entries).toHaveLength(2);
    expect(document.entries[0]).toMatchObject({ start: 12000, end: 15300, originalText: "First line" });
    expect(document.entries[1]).toMatchObject({ start: 15300, end: 19300 });
  });

  it("一行多个时间标签展开成多条", () => {
    const { document } = parseLrc("[00:10.00][00:40.00]Chorus\n[00:20.00]Verse", "t");
    expect(document.entries.map((e) => [e.start, e.originalText])).toEqual([
      [10000, "Chorus"],
      [20000, "Verse"],
      [40000, "Chorus"],
    ]);
  });

  it("空正文行用于结束上一句，不产生条目", () => {
    const { document } = parseLrc("[00:10.00]Line\n[00:12.00]", "t");
    expect(document.entries).toHaveLength(1);
    expect(document.entries[0].end).toBe(12000);
  });
});

describe("SRT 超长时间轴", () => {
  it("小时位三位也能解析", () => {
    const { document } = parseSrt("1\n100:00:01,000 --> 100:00:04,000\nHi\n", "t");
    expect(document.entries[0].start).toBe(360001000);
  });
});
