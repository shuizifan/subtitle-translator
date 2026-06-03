"use client";

import { useTheme, type ThemePref } from "@/lib/theme";

const OPTIONS: { value: ThemePref; icon: string; title: string }[] = [
  { value: "system", icon: "🖥", title: "跟随系统" },
  { value: "light", icon: "☀", title: "浅色" },
  { value: "dark", icon: "🌙", title: "深色" },
];

/** 三态主题切换：系统 / 浅色 / 深色。 */
export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  return (
    <div className="flex items-center rounded-lg border border-slate-300 p-0.5 dark:border-slate-600">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          title={o.title}
          aria-label={o.title}
          onClick={() => setPref(o.value)}
          className={`flex h-7 w-7 items-center justify-center rounded-md text-sm transition ${
            pref === o.value
              ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
          }`}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
