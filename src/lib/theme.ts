"use client";

import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "subtitle-theme";

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveDark(pref: ThemePref): boolean {
  return pref === "dark" || (pref === "system" && systemDark());
}

export function applyTheme(pref: ThemePref) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveDark(pref));
}

/** 主题：默认跟随系统，可切换 系统/浅色/深色，持久化到 localStorage。 */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("system");

  // 首次挂载读取存储值
  useEffect(() => {
    const stored = (localStorage.getItem(KEY) as ThemePref) || "system";
    setPref(stored);
    applyTheme(stored);
  }, []);

  // pref 变化时应用 + 持久化
  useEffect(() => {
    applyTheme(pref);
  }, [pref]);

  // 跟随系统时，监听系统主题变化
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const update = (p: ThemePref) => {
    localStorage.setItem(KEY, p);
    setPref(p);
  };

  return { pref, setPref: update };
}
