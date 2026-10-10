import { describe, expect, it } from "vitest";
import { translationStatus } from "@/core/progress";

const progress = { completedBatches: 16, totalBatches: 25, translatedEntries: 640, totalEntries: 1000, failedEntries: 0 };
const counts = { total: 1000, translated: 640, failed: 0 };

describe("翻译状态展示", () => {
  it("按已处理批次计算进度，使用实时文档行数", () => {
    const status = translationStatus("translating", progress, { ...counts, translated: 645 });
    expect(status.percent).toBe(64);
    expect(status.label).toBe("正在翻译");
    expect(status.detail).toBe("已译 645 / 1,000 行 · 批次 16 / 25");
    expect(status.active).toBe(true);
  });

  it("准备阶段未知批次数不产生无效百分比", () => {
    expect(translationStatus("translating", null, counts)).toMatchObject({ percent: 0, label: "准备翻译", indeterminate: true });
    expect(translationStatus("translating", { ...progress, totalBatches: 0, completedBatches: 0 }, counts).percent).toBe(0);
  });

  it("取消或出错后不会显示已完成", () => {
    for (const phase of ["done", "parsed"] as const) {
      expect(translationStatus(phase, progress, counts)).toMatchObject({ label: "翻译已停止", percent: 64, tone: "muted", active: false });
    }
  });

  it("处理完所有批次仍有失败行时显示警示状态", () => {
    const result = translationStatus("done", { ...progress, completedBatches: 25 }, { ...counts, translated: 996, failed: 4 });
    expect(result).toMatchObject({ percent: 100, label: "翻译结束 · 4 行失败", tone: "warning" });
    expect(result.detail).toContain("已译 996 / 1,000 行");
  });

  it("失败行手动补好后转为完成，停止且无失败行时不误报完成", () => {
    expect(translationStatus("done", progress, { ...counts, translated: 1000 })).toMatchObject({ label: "翻译完成", percent: 100, tone: "success" });
    expect(translationStatus("parsed", null, counts)).toMatchObject({ label: "未翻译", percent: 0, tone: "muted" });
  });
});
