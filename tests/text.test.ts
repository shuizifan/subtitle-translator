import { describe, expect, it } from "vitest";
import { collapseLines, hasCjk, joinSmart } from "@/core/text";

describe("合并多行（CJK 接缝不加空格）", () => {
  it("中文之间不插空格", () => {
    expect(collapseLines("法国人已经向法郎\n说了再见。")).toBe("法国人已经向法郎说了再见。");
  });
  it("英文之间插空格", () => {
    expect(collapseLines("The Germans have said\nAuf Wiedersehen")).toBe("The Germans have said Auf Wiedersehen");
  });
  it("中英交界保留空格", () => {
    expect(collapseLines("德国人已经说了\nAuf Wiedersehen")).toBe("德国人已经说了 Auf Wiedersehen");
    expect(collapseLines("Auf Wiedersehen\n德国马克")).toBe("Auf Wiedersehen 德国马克");
  });
  it("全角标点也算 CJK", () => {
    expect(collapseLines("男孩：\n法国人来了")).toBe("男孩：法国人来了");
  });
  it("丢空行、去首尾空白", () => {
    expect(collapseLines("  甲  \n\n 乙 ")).toBe("甲乙");
    expect(joinSmart([])).toBe("");
  });
  it("hasCjk", () => {
    expect(hasCjk("hello")).toBe(false);
    expect(hasCjk("hello 世界")).toBe(true);
  });
});
