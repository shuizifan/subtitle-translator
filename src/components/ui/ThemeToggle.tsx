"use client";

import { useTheme, type ThemePref } from "@/lib/theme";

const LABELS = { system: "跟随系统", light: "浅色", dark: "深色" };

export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <label className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700" title={`外观：${LABELS[pref]}`}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {pref === "system" ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></> : pref === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z" />}
      </svg>
      <select aria-label="外观主题" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={pref} onChange={(event) => setPref(event.target.value as ThemePref)}>
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
    </label>
  );
}
