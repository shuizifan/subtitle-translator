import { describe, expect, it } from "vitest";
import { getFailedEntryIds, adjacentFailedId } from "@/core/navigation";
import type { SubtitleEntry } from "@/core/model";

const entries: SubtitleEntry[] = [1, 3, 7, 9, 12].map((id) => ({ id, start: 0, end: 1000, originalText: "Hello" }));

describe("失败行导航", () => {
  it("按字幕顺序列出失败行，排除已修复、空原文、已排除和不存在的行", () => {
    const doc = entries.map((entry) => ({ ...entry }));
    doc[1].translatedText = "已修复";
    doc[2].excluded = true;
    doc[3].originalText = " ";
    expect(getFailedEntryIds(doc, [12, 9, 7, 3, 1, 99, 1])).toEqual([1, 12]);
  });

  it("初次定位和首尾循环", () => {
    expect(adjacentFailedId([1, 7, 12], null, 1)).toBe(1);
    expect(adjacentFailedId([1, 7, 12], null, -1)).toBe(12);
    expect(adjacentFailedId([1, 7, 12], 1, -1)).toBe(12);
    expect(adjacentFailedId([1, 7, 12], 12, 1)).toBe(1);
    expect(adjacentFailedId([1, 7, 12], 7, 1)).toBe(12);
  });

  it("当前行修复后从其位置继续，单行与零行也可处理", () => {
    expect(adjacentFailedId([1, 12], 7, 1)).toBe(12);
    expect(adjacentFailedId([1, 12], 7, -1)).toBe(1);
    expect(adjacentFailedId([12], 12, 1)).toBe(12);
    expect(adjacentFailedId([], 12, -1)).toBeNull();
  });
});
