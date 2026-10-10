import type { Progress } from "@/core/translator/engine";
import type { Phase } from "@/store";

interface Counts {
  total: number;
  translated: number;
  failed: number;
}

/** 批次百分比表示处理进度；成功、失败和停止状态由当前文档决定。 */
export function translationStatus(phase: Phase, progress: Progress | null, counts: Counts) {
  const active = phase === "translating";
  const indeterminate = active && (!progress || progress.totalBatches === 0);
  const complete = !active && counts.total > 0 && counts.translated === counts.total;
  const percent = complete ? 100 : progress && progress.totalBatches > 0
    ? Math.min(100, Math.max(0, Math.round(progress.completedBatches / progress.totalBatches * 100)))
    : 0;
  const stopped = !active && !complete && progress && progress.completedBatches < progress.totalBatches;
  const label = indeterminate ? "准备翻译" : active
    ? `正在翻译${counts.failed ? ` · ${counts.failed} 行失败` : ""}`
    : complete ? "翻译完成"
    : stopped ? "翻译已停止"
    : phase === "done" ? counts.failed ? `翻译结束 · ${counts.failed} 行失败` : "翻译已停止"
    : "未翻译";
  const tone: "blue" | "success" | "warning" | "muted" = counts.failed ? "warning" : complete ? "success" : active ? "blue" : "muted";
  const format = (n: number) => n.toLocaleString("en-US");
  const detail = `已译 ${format(counts.translated)} / ${format(counts.total)} 行${progress && progress.totalBatches > 0 ? ` · 批次 ${progress.completedBatches} / ${progress.totalBatches}` : ""}`;
  return { label, percent, detail, tone, active, indeterminate };
}
