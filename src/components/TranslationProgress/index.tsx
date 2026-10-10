"use client";

import { useAppStore } from "@/store";
import { translationStatus } from "@/core/progress";
import { getFailedEntryIds } from "@/core/navigation";

const TONES = {
  blue: { text: "text-blue-600 dark:text-blue-400", fill: "bg-blue-500 dark:bg-blue-400", current: "bg-blue-200 dark:bg-blue-500/40" },
  success: { text: "text-emerald-600 dark:text-emerald-400", fill: "bg-emerald-500 dark:bg-emerald-400", current: "bg-emerald-200 dark:bg-emerald-500/40" },
  warning: { text: "text-amber-600 dark:text-amber-400", fill: "bg-amber-500 dark:bg-amber-400", current: "bg-amber-200 dark:bg-amber-500/40" },
  muted: { text: "text-slate-500 dark:text-slate-400", fill: "bg-slate-400 dark:bg-slate-500", current: "bg-slate-300 dark:bg-slate-600" },
};

export function TranslationProgress() {
  const document = useAppStore((s) => s.document);
  const phase = useAppStore((s) => s.phase);
  const progress = useAppStore((s) => s.progress);
  const failedIds = useAppStore((s) => s.failedIds);
  useAppStore((s) => s.docVersion);
  if (!document) return null;

  const entries = document.entries.filter((entry) => !entry.excluded && entry.originalText.trim());
  const status = translationStatus(phase, progress, {
    total: entries.length,
    translated: entries.filter((entry) => entry.translatedText?.trim()).length,
    failed: getFailedEntryIds(entries, failedIds).length,
  });
  const tone = TONES[status.tone];
  const filled = Math.floor(status.percent / 5);

  return (
    <div className="ml-auto w-full max-w-[280px] min-w-0 xl:mx-4 xl:w-[260px] xl:shrink-0" data-translation-status={status.tone}>
      <div className={`flex items-center justify-between gap-2 text-xs font-semibold ${tone.text}`}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.fill} ${status.active ? "motion-safe:animate-pulse" : ""}`} />
          <span className="truncate" role="status">{status.label}</span>
        </span>
        <span className="shrink-0 text-base font-bold tabular-nums">{status.indeterminate ? "…" : `${status.percent}%`}</span>
      </div>
      <div
        className="mt-1 flex gap-[3px]"
        role="progressbar"
        aria-label="翻译处理进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={status.indeterminate ? undefined : status.percent}
        aria-valuetext={`${status.label}，${status.detail}`}
      >
        {Array.from({ length: 20 }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={`h-1.5 min-w-0 flex-1 rounded-[2px] transition-colors motion-reduce:transition-none ${index < filled ? tone.fill : status.active && index === filled ? `${tone.current} motion-safe:animate-pulse` : "bg-slate-200 dark:bg-slate-700"}`}
          />
        ))}
      </div>
      <div className="mt-1 truncate text-[10px] leading-tight tabular-nums text-slate-500 dark:text-slate-400" title={status.detail}>{status.detail}</div>
    </div>
  );
}
