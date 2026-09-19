"use client";

import { useState } from "react";
import { useAppStore, type QueueItem } from "@/store";
import { DEFAULT_BATCH_OPTIONS, useBatchQueue, type BatchOptions } from "@/lib/useBatchQueue";
import { downloadText } from "@/lib/exportDoc";

const STATUS_LABEL: Record<QueueItem["status"], { text: string; cls: string }> = {
  pending: { text: "待翻译", cls: "text-slate-400" },
  running: { text: "翻译中", cls: "text-blue-600 dark:text-blue-400" },
  done: { text: "完成", cls: "text-emerald-600 dark:text-emerald-400" },
  error: { text: "失败", cls: "text-red-600 dark:text-red-400" },
  cancelled: { text: "已取消", cls: "text-slate-400" },
};

/** 批量队列面板：一次处理几十个文件，完成后打包 zip（见改进建议 #7）。 */
export function QueuePanel() {
  const queue = useAppStore((s) => s.queue);
  const running = useAppStore((s) => s.queueRunning);
  const removeQueueItem = useAppStore((s) => s.removeQueueItem);
  const clearQueue = useAppStore((s) => s.clearQueue);
  const [opts, setOpts] = useState<BatchOptions>(DEFAULT_BATCH_OPTIONS);
  const { runAll, cancel, downloadZip } = useBatchQueue();

  if (queue.length === 0) return null;

  const done = queue.filter((q) => q.status === "done").length;
  const failed = queue.filter((q) => q.status === "error").length;
  const pending = queue.filter((q) => q.status === "pending").length;
  const hasOutputs = queue.some((q) => q.outputs?.length);

  const option = (key: keyof BatchOptions, label: string) => (
    <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
      <input
        type="checkbox"
        checked={opts[key]}
        disabled={running}
        onChange={(e) => setOpts((o) => ({ ...o, [key]: e.target.checked }))}
      />
      {label}
    </label>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            批量队列 · {queue.length} 个文件
            <span className="ml-2 text-xs font-normal text-slate-400">
              完成 {done}
              {failed ? ` · 失败 ${failed}` : ""}
              {pending ? ` · 待翻译 ${pending}` : ""}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <button className="btn-secondary" onClick={cancel}>
                停止批量
              </button>
            ) : (
              <button className="btn-primary" onClick={() => runAll(opts)} disabled={pending === 0}>
                {done > 0 ? "继续批量翻译" : "开始批量翻译"}
              </button>
            )}
            <button className="btn-secondary" onClick={downloadZip} disabled={!hasOutputs}>
              打包下载 ZIP
            </button>
            <button
              className="text-xs text-slate-400 hover:underline"
              onClick={clearQueue}
              disabled={running}
            >
              清空队列
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-4">
          {option("glossaryPerFile", "每部先生成术语表")}
          {option("exportTranslated", "导出仅译文")}
          {option("exportBilingual", "导出双语")}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          队列按当前的翻译参数逐个处理，正在处理的文件会显示在下方表格里；ZIP 内保留原目录结构。
        </p>

        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 text-xs dark:border-slate-700">
          {queue.map((q) => {
            const st = STATUS_LABEL[q.status];
            return (
              <div
                key={q.id}
                className="flex items-center gap-2 border-b border-slate-100 px-2 py-1.5 last:border-0 dark:border-slate-700/60"
              >
                <span className="flex-1 break-all text-slate-700 dark:text-slate-300">{q.path}</span>
                {q.status === "running" && q.total ? (
                  <span className="shrink-0 font-mono text-slate-400">
                    {q.translated ?? 0}/{q.total}
                  </span>
                ) : null}
                {q.error && <span className="shrink-0 text-amber-600 dark:text-amber-400">{q.error}</span>}
                <span className={`w-14 shrink-0 text-right ${st.cls}`}>{st.text}</span>
                {q.outputs?.length ? (
                  <button
                    className="shrink-0 text-slate-400 hover:text-slate-700 hover:underline dark:hover:text-slate-200"
                    onClick={() =>
                      q.outputs!.forEach((o) =>
                        downloadText(o.content, o.path.split("/").pop()!, o.path.endsWith(".ass") ? "ass" : "srt"),
                      )
                    }
                  >
                    下载
                  </button>
                ) : null}
                <button
                  className="shrink-0 px-1 text-slate-400 hover:text-red-500"
                  onClick={() => removeQueueItem(q.id)}
                  disabled={running && q.status === "running"}
                  aria-label="从队列移除"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
