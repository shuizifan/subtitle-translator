"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store";
import { clearTask, loadTask, saveTask, taskProgress, type SavedTask } from "@/lib/docStore";

/** 存盘节流：翻译过程中每秒都在变，攒一攒再写。 */
const SAVE_DEBOUNCE_MS = 1500;
/** 但也不能一直被新变化推迟：翻译期间变化是连续的，最长这么久必须落一次盘。 */
const SAVE_MAX_WAIT_MS = 15_000;

/**
 * 未完成任务的自动存档与恢复（见改进建议 #6）。
 * - 有文档时：把文档 + 术语表节流写进 IndexedDB；
 * - 首次进站没有文档、但有存档时：提示「继续上次的翻译？」。
 */
export function ResumeBanner() {
  const [saved, setSaved] = useState<SavedTask | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(0);

  // 进站检查存档（当前没有打开任何文档时才提示）
  useEffect(() => {
    let alive = true;
    if (useAppStore.getState().document) return;
    loadTask().then((task) => {
      if (alive && task && !useAppStore.getState().document) setSaved(task);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 订阅文档变化并节流存档
  useEffect(() => {
    const flush = () => {
      const s = useAppStore.getState();
      if (!s.document || !s.fileName) return;
      lastSaved.current = Date.now();
      void saveTask({
        fileName: s.fileName,
        encoding: s.detectedEncoding,
        document: s.document,
        glossary: s.glossary,
        cleanupMarks: s.cleanupMarks,
        detectedLang: s.detectedLang,
        sourceLang: s.params.sourceLang,
        targetLang: s.params.targetLang,
        savedAt: Date.now(),
      });
    };

    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.document == null) {
        // 文档被清空（reset）：连存档一起清掉，避免下次误恢复
        if (prev.document != null) void clearTask();
        return;
      }
      if (state.docVersion === prev.docVersion && state.document === prev.document && state.glossary === prev.glossary) {
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      // 翻译期间变化不断，纯防抖会一直被推迟到翻译结束；超过上限就立刻落盘
      if (Date.now() - lastSaved.current > SAVE_MAX_WAIT_MS) flush();
      else timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    });

    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!saved || dismissed) return null;

  const { translated, total } = taskProgress(saved);
  const when = new Date(saved.savedAt).toLocaleString();

  const restore = () => {
    const s = useAppStore.getState();
    s.setDocument(saved.document, saved.fileName, saved.encoding ?? "utf-8", [], {
      cleanupMarks: saved.cleanupMarks,
      detectedLang: saved.detectedLang,
    });
    s.setGlossary(saved.glossary ?? []);
    s.setSourceLang(saved.sourceLang);
    s.setTargetLang(saved.targetLang);
    s.setPhase(total > 0 && translated >= total ? "done" : "parsed");
    setDismissed(true);
  };

  const discard = () => {
    void clearTask();
    setDismissed(true);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-sky-50 px-4 py-2.5 text-sm text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">
      <span className="break-all">
        💾 上次还有未完成的翻译：<strong>{saved.fileName}</strong>（已译 {translated}/{total} 行 · {when}）
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button className="btn-primary" onClick={restore}>
          继续上次的翻译
        </button>
        <button className="btn-secondary" onClick={discard}>
          丢弃
        </button>
      </span>
    </div>
  );
}
