"use client";

import { useCallback } from "react";
import { useAppStore } from "@/store";
import { useSubtitleLoaderContext } from "@/lib/SubtitleLoaderContext";
import { SUPPORTED_EXT } from "@/lib/useSubtitleLoader";

export interface IntakeResult {
  accepted: number;
  skipped: number;
  queued: boolean;
}

/**
 * 统一的文件接收口：单个文件直接打开，多个文件（含拖文件夹）进批量队列。
 * 媒体库场景一次几十部起步，逐个「上传→等→下载→改名」实在太慢（见改进建议 #7）。
 */
export function useFileIntake() {
  const { loadFile, MAX_SIZE } = useSubtitleLoaderContext();
  const enqueueFiles = useAppStore((s) => s.enqueueFiles);

  const accept = useCallback(
    async (files: File[]): Promise<IntakeResult> => {
      const usable = files.filter((f) => SUPPORTED_EXT.test(f.name) && f.size <= MAX_SIZE);
      const skipped = files.length - usable.length;
      if (usable.length === 0) return { accepted: 0, skipped, queued: false };

      if (usable.length === 1) {
        await loadFile(usable[0]);
        return { accepted: 1, skipped, queued: false };
      }

      const items = await Promise.all(
        usable.map(async (f) => ({
          name: f.name,
          // webkitRelativePath 只有「选择文件夹」时才有值，用来在 zip 里还原目录结构
          path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
          size: f.size,
          bytes: new Uint8Array(await f.arrayBuffer()),
        })),
      );
      enqueueFiles(items);
      // 顺手把第一个载入主界面，让用户能先确认解析/清理结果；
      // 但当前文件已经有译文时不能静默顶掉，交由用户点「开始批量翻译」再切换。
      const cur = useAppStore.getState().document;
      const hasWork = !!cur?.entries.some((e) => e.translatedText);
      if (!hasWork) await loadFile(usable[0]);
      return { accepted: usable.length, skipped, queued: true };
    },
    [enqueueFiles, loadFile, MAX_SIZE],
  );

  return { accept };
}
