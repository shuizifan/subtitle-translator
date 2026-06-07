"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSubtitleLoader } from "@/lib/useSubtitleLoader";

type LoaderValue = ReturnType<typeof useSubtitleLoader>;

const SubtitleLoaderContext = createContext<LoaderValue | null>(null);

/** 全应用共享一个字幕加载器实例，使「整页拖拽 / 上传区 / 顶部打开」共享同一份 error / 编码状态。 */
export function SubtitleLoaderProvider({ children }: { children: ReactNode }) {
  const loader = useSubtitleLoader();
  return <SubtitleLoaderContext.Provider value={loader}>{children}</SubtitleLoaderContext.Provider>;
}

export function useSubtitleLoaderContext(): LoaderValue {
  const ctx = useContext(SubtitleLoaderContext);
  if (!ctx) throw new Error("useSubtitleLoaderContext 必须在 <SubtitleLoaderProvider> 内使用");
  return ctx;
}
