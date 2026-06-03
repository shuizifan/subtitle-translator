import { describe, expect, it } from "vitest";
import { extractTags, reinsertTags } from "@/core/tags";

describe("内联标签抽离与回填", () => {
  it("抽离整行斜体包裹", () => {
    const { plain, tags } = extractTags("<i>Hello world</i>");
    expect(plain).toBe("Hello world");
    expect(tags).toEqual([
      { raw: "<i>", offset: 0 },
      { raw: "</i>", offset: 11 },
    ]);
  });

  it("抽离 font 与 ASS 大括号标签", () => {
    const { plain, tags } = extractTags('{\\an8}<font color="#fff">hi</font>');
    expect(plain).toBe("hi");
    expect(tags.map((t) => t.raw)).toEqual(["{\\an8}", '<font color="#fff">', "</font>"]);
  });

  it("回填后还原原文", () => {
    const src = "<i>Hello world</i>";
    const { plain, tags } = extractTags(src);
    expect(reinsertTags(plain, tags)).toBe(src);
  });

  it("译文变长后整行包裹仍正确（offset 夹紧到末尾）", () => {
    const { tags } = extractTags("<i>Hello</i>");
    // 模拟翻译：Hello -> 你好世界
    expect(reinsertTags("你好世界", tags)).toBe("<i>你好世界</i>");
  });

  it("保留 cue 内换行", () => {
    const { plain } = extractTags("-I'm coming!\n-We got him!");
    expect(plain).toBe("-I'm coming!\n-We got him!");
  });
});
