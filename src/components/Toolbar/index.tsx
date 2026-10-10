"use client";

import { useRef } from "react";
import { useAppStore } from "@/store";
import { useFileIntake } from "@/lib/useFileIntake";
import { useExport } from "@/lib/useExport";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { siteConfig } from "@/config/site";
import { TranslationProgress } from "@/components/TranslationProgress";

export function Toolbar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const hasDoc = useAppStore((s) => s.document != null);
  const { accept } = useFileIntake();
  const { exportTranslated, exportBilingual } = useExport();
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  const canExport = hasDoc;

  return (
    <header className="sticky top-0 z-30 grid h-28 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 border-b border-slate-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 xl:flex xl:h-14 xl:justify-between xl:py-0">
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

      <TranslationProgress />

      <div className="col-span-2 flex min-w-0 items-center gap-2 overflow-x-auto [&>*]:shrink-0">
        <input
          ref={fileInput}
          type="file"
          accept=".srt,.ass,.ssa,.vtt,.lrc"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void accept(files);
            e.target.value = "";
          }}
        />
        {/* 选择文件夹：媒体库里字幕散在各剧集目录下，逐个挑太慢 */}
        <input
          ref={dirInput}
          type="file"
          className="hidden"
          multiple
          // @ts-expect-error 非标准属性，Chromium / Safari / Firefox 均支持
          webkitdirectory=""
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void accept(files);
            e.target.value = "";
          }}
        />
        <button className="btn-secondary" onClick={() => fileInput.current?.click()}>
          打开文件
        </button>
        <button className="btn-secondary" onClick={() => dirInput.current?.click()} title="批量：选择整个文件夹">
          打开文件夹
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
