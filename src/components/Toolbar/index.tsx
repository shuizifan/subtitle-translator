"use client";

import { useRef } from "react";
import { useAppStore } from "@/store";
import { useSubtitleLoader } from "@/lib/useSubtitleLoader";
import { useExport } from "@/lib/useExport";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { siteConfig } from "@/config/site";

export function Toolbar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const phase = useAppStore((s) => s.phase);
  const progress = useAppStore((s) => s.progress);
  const hasDoc = useAppStore((s) => s.document != null);
  const { loadFile } = useSubtitleLoader();
  const { exportTranslated, exportBilingual } = useExport();
  const fileInput = useRef<HTMLInputElement>(null);

  const canExport = hasDoc;

  const status = (() => {
    if (!hasDoc) return null;
    if (phase === "translating") {
      const pct = progress && progress.totalBatches ? Math.round((progress.completedBatches / progress.totalBatches) * 100) : 0;
      return { text: `翻译中 ${pct}%`, cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" };
    }
    if (phase === "done") return { text: "已完成翻译 ✅", cls: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300" };
    return { text: "未翻译", cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300" };
  })();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
      <div className="flex items-center gap-3">
        {siteConfig.logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={siteConfig.logoSrc} alt={siteConfig.name} className="h-7 w-7 rounded-lg object-contain" />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white dark:bg-slate-100 dark:text-slate-900">
            {siteConfig.logoText}
          </span>
        )}
        <span className="text-base font-semibold text-slate-900 dark:text-slate-100">{siteConfig.name}</span>
      </div>

      {status && (
        <div className={`hidden rounded-full px-3 py-1 text-xs font-medium sm:block ${status.cls}`}>{status.text}</div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".srt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = "";
          }}
        />
        <button className="btn-secondary" onClick={() => fileInput.current?.click()}>
          打开新文件
        </button>
        <button className="btn-secondary" onClick={exportTranslated} disabled={!canExport}>
          导出仅译文
        </button>
        <button className="btn-primary" onClick={exportBilingual} disabled={!canExport}>
          导出双语
        </button>
        <ThemeToggle />
        <button
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          onClick={onOpenSettings}
          title="设置"
          aria-label="设置"
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
