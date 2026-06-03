import { describe, expect, it } from "vitest";
import { parseSrt } from "@/core/parsers/srt";
import { serializeSrt } from "@/core/serializers/srt";
import { originalCues } from "@/core/bilingual";

const SAMPLE = [
  "1",
  "00:01:07,440 --> 00:01:16,000",
  "My friend Barry",
  "",
  "2",
  "00:01:29,720 --> 00:01:30,720",
  "I'm telling you,",
  "",
  "3",
  "00:01:30,880 --> 00:01:33,200",
  "<i>that creature's fooling us.</i>",
  "",
].join("\r\n");

describe("SRT parser", () => {
  it("解析条数、时间（毫秒）、文本正确", () => {
    const { document } = parseSrt(SAMPLE, "task-1");
    expect(document.entries).toHaveLength(3);
    expect(document.entries[0].start).toBe(67_440);
    expect(document.entries[0].end).toBe(76_000);
    expect(document.entries[0].originalText).toBe("My friend Barry");
  });

  it("抽离内联标签为纯文本 + tags", () => {
    const { document } = parseSrt(SAMPLE, "task-1");
    const e = document.entries[2];
    expect(e.originalText).toBe("that creature's fooling us.");
    expect(e.tags).toEqual([
      { raw: "<i>", offset: 0 },
      { raw: "</i>", offset: "that creature's fooling us.".length },
    ]);
  });

  it("容错：缺序号、多余空行、LF 混用、末条无空行", () => {
    const messy = "00:00:01,000 --> 00:00:02,000\nHello\n\n\n\n5\n00:00:03,000 --> 00:00:04,000\nWorld";
    const { document } = parseSrt(messy, "t");
    expect(document.entries).toHaveLength(2);
    expect(document.entries[1].originalText).toBe("World");
  });
});

describe("SRT round-trip（往返一致）", () => {
  it("serialize(parse(x)) 与 x 语义等价（时间/文本/条数）", () => {
    const { document } = parseSrt(SAMPLE, "task-1");
    const out = serializeSrt(originalCues(document), { eol: "\r\n" });
    const reparsed = parseSrt(out, "task-2").document;

    expect(reparsed.entries).toHaveLength(document.entries.length);
    for (let i = 0; i < document.entries.length; i++) {
      expect(reparsed.entries[i].start).toBe(document.entries[i].start);
      expect(reparsed.entries[i].end).toBe(document.entries[i].end);
      expect(reparsed.entries[i].originalText).toBe(document.entries[i].originalText);
    }
  });

  it("时间码格式化为 HH:MM:SS,mmm", () => {
    const { document } = parseSrt(SAMPLE, "t");
    const out = serializeSrt(originalCues(document));
    expect(out).toContain("00:01:07,440 --> 00:01:16,000");
  });
});
