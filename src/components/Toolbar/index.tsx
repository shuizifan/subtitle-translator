"use client";

import { useEffect, useRef } from "react";
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
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => document.documentElement.style.setProperty("--toolbar-height", `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--toolbar-height"); };
  }, []);

  return (
    <header ref={headerRef} className="relative z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="workspace-shell flex flex-wrap items-center gap-x-5 gap-y-2 py-2.5 lg:h-16 lg:py-0">

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

      <div className="order-3 flex w-full min-w-0 items-center gap-2 lg:order-2 lg:ml-auto lg:w-auto lg:flex-1">
        <div className="mr-auto min-w-0 flex-1 lg:mx-auto lg:max-w-sm"><TranslationProgress /></div>
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
        <ActionMenu label="打开">
          <button type="button" className={menuItem} onClick={() => fileInput.current?.click()}>打开文件</button>
          <button type="button" className={menuItem} onClick={() => dirInput.current?.click()}>打开文件夹</button>
        </ActionMenu>
        <ActionMenu label="导出" disabled={!canExport}>
          <button type="button" className={menuItem} onClick={exportBilingual} disabled={!canExport}>导出双语</button>
          <button type="button" className={menuItem} onClick={exportTranslated} disabled={!canExport}>导出仅译文</button>
        </ActionMenu>
      </div>
      <div className="order-2 ml-auto flex shrink-0 items-center gap-2 lg:order-3 lg:ml-0">
        <ThemeToggle />
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          onClick={onOpenSettings}
          title="设置"
          aria-label="设置"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m9 3-.6 2.2-2 .9-2.1-.6-2 3.5 1.5 1.6v2.8L2.3 15l2 3.5 2.1-.6 2 .9L9 21h4l.6-2.2 2-.9 2.1.6 2-3.5-1.5-1.6v-2.8L19.7 9l-2-3.5-2.1.6-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></svg>
        </button>
      </div>
      </div>
    </header>
  );
}

const menuItem = "block w-full whitespace-nowrap rounded-md px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none dark:text-slate-200 dark:hover:bg-slate-700 dark:focus-visible:bg-slate-700";

function ActionMenu({ label, disabled, children }: { label: string; disabled?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={ref} className="relative shrink-0" onKeyDown={(event) => {
      if (event.key === "Escape" && ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
    }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && ref.current) ref.current.open = false;
    }}>
      <summary aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault(); }} className={`btn-secondary list-none cursor-pointer [&::-webkit-details-marker]:hidden ${disabled ? "cursor-not-allowed opacity-40" : ""}`}>
        {label}<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4" /></svg>
      </summary>
      <div className="absolute right-0 top-full z-40 mt-2 min-w-36 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-800" onClick={() => { if (ref.current) ref.current.open = false; }}>
        {children}
      </div>
    </details>
  );
}
