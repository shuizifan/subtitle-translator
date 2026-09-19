"use client";

import { useRef } from "react";
import { useAppStore, type QueueItem } from "@/store";
import { useSubtitleLoaderContext } from "@/lib/SubtitleLoaderContext";
import { getActiveProfile } from "@/store";
import { createForwardingCaller } from "@/core/translator/llmClient";
import { translateDocument, type EngineOptions } from "@/core/translator/engine";
import { buildGlossary } from "@/core/glossary/build";
import { buildExport } from "@/lib/exportDoc";
import { buildZipBlob } from "@/core/zip";
import { downloadBlob } from "@/lib/exportDoc";

export interface BatchOptions {
  /** 每部片子先生成一次术语表（更准，但每部多一次请求） */
  glossaryPerFile: boolean;
  exportTranslated: boolean;
  exportBilingual: boolean;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
  glossaryPerFile: true,
  exportTranslated: true,
  exportBilingual: true,
};

/** zip 内路径：保留原目录结构，省掉手工归位。 */
function outputPath(item: QueueItem, filename: string): string {
  const dir = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/") + 1) : "";
  return dir + filename;
}

/**
 * 批量队列（见改进建议 #7）。
 * 逐个文件走「解析 → （可选）术语表 → 翻译 → 生成导出内容」，
 * 当前处理的文件同时显示在主界面表格里，进度可见；全部完成后打包 zip。
 */
export function useBatchQueue() {
  const abortRef = useRef<AbortController | null>(null);
  const { loadBytes } = useSubtitleLoaderContext();

  const runAll = async (opts: BatchOptions) => {
    const controller = new AbortController();
    abortRef.current = controller;
    useAppStore.getState().setQueueRunning(true);

    try {
      for (;;) {
        if (controller.signal.aborted) break;
        const next = useAppStore.getState().queue.find((q) => q.status === "pending");
        if (!next) break;
        await runOne(next, opts, controller.signal, loadBytes);
      }
    } finally {
      abortRef.current = null;
      useAppStore.getState().setQueueRunning(false);
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    const s = useAppStore.getState();
    for (const q of s.queue) {
      if (q.status === "running") s.updateQueueItem(q.id, { status: "cancelled" });
    }
  };

  /** 把所有已完成文件打包成一个 zip 下载。 */
  const downloadZip = async () => {
    const done = useAppStore.getState().queue.filter((q) => q.status === "done" && q.outputs?.length);
    if (done.length === 0) return;
    const files = done.flatMap((q) => q.outputs!.map((o) => ({ path: o.path, content: o.content })));
    const blob = await buildZipBlob(files);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `字幕翻译_${done.length}个文件_${stamp}.zip`);
  };

  return { runAll, cancel, downloadZip };
}

async function runOne(
  item: QueueItem,
  opts: BatchOptions,
  signal: AbortSignal,
  loadBytes: (bytes: Uint8Array, name: string, forced?: string) => void,
): Promise<void> {
  const store = useAppStore.getState();
  store.updateQueueItem(item.id, { status: "running", error: undefined });

  try {
    // 解析并显示在主界面（清理、语种判定与单文件流程完全一致）
    loadBytes(item.bytes, item.name, "auto");
    const s = useAppStore.getState();
    const doc = s.document;
    if (!doc || s.fileName !== item.name) {
      throw new Error("解析失败，已跳过");
    }

    const profile = getActiveProfile(s);
    if (!profile || !profile.baseURL || !profile.apiKey || !profile.model) {
      throw new Error("请先在设置里配置并选择一个翻译服务");
    }
    const caller = createForwardingCaller({
      baseURL: profile.baseURL,
      apiKey: profile.apiKey,
      model: profile.model,
      temperature: s.params.temperature,
      maxTokens: s.params.maxTokens,
      reasoningEffort: s.params.reasoningEffort,
    });

    // 术语表：每部片子的人名各不相同，必须逐部生成
    if (opts.glossaryPerFile && s.params.useGlossary) {
      useAppStore.getState().setGlossaryStatus("building");
      useAppStore.getState().setGlossaryProgress({ phase: "scanning", done: 0, total: 0, candidates: 0, terms: 0 });
      try {
        const texts = doc.entries.filter((e) => !e.excluded).map((e) => e.originalText);
        const { entries } = await buildGlossary(texts, caller, {
          sourceLang: useAppStore.getState().params.sourceLang,
          targetLang: s.params.targetLang,
          signal,
          onProgress: (p) => useAppStore.getState().setGlossaryProgress(p),
          onPartial: (partial) => useAppStore.getState().setGlossary(partial),
        });
        useAppStore.getState().setGlossary(entries);
        useAppStore.getState().setGlossaryStatus("ready");
      } catch (e) {
        // 术语表失败不该拖垮整部片子的翻译
        useAppStore.getState().setGlossaryStatus("error", e instanceof Error ? e.message : String(e));
      }
    }

    if (signal.aborted) {
      useAppStore.getState().updateQueueItem(item.id, { status: "cancelled" });
      return;
    }

    const cur = useAppStore.getState();
    const engineOpts: EngineOptions = {
      sourceLang: cur.params.sourceLang,
      targetLang: cur.params.targetLang,
      customStyle: cur.params.customStyle,
      systemPrompt: cur.params.systemPrompt,
      batchSize: cur.params.batchSize,
      concurrency: cur.params.concurrency,
      maxRetries: cur.params.maxRetries,
      contextLines: cur.params.contextLines,
      trailingContextLines: cur.params.trailingContextLines,
      maxCharsPerBatch: cur.params.maxCharsPerBatch,
      glossary: cur.params.useGlossary ? cur.glossary : [],
    };

    cur.setPhase("translating");
    let lastBump = 0;
    const result = await translateDocument(doc, caller, engineOpts, {
      signal,
      onProgress: (p) => {
        useAppStore.getState().setProgress(p);
        useAppStore
          .getState()
          .updateQueueItem(item.id, { translated: p.translatedEntries, total: p.totalEntries });
      },
      onEntry: () => {
        const now = Date.now();
        if (now - lastBump > 500) {
          lastBump = now;
          useAppStore.getState().bumpDocVersion();
        }
      },
    });

    const after = useAppStore.getState();
    after.setFailedIds(result.failedIds, result.lastError ?? null);
    after.bumpDocVersion();
    after.setPhase("done");

    if (result.cancelled) {
      after.updateQueueItem(item.id, { status: "cancelled" });
      return;
    }

    const settings = { params: after.params, bilingual: after.bilingual, style: after.style, assStyle: after.assStyle };
    const outputs: { path: string; content: string }[] = [];
    if (opts.exportTranslated) {
      const out = buildExport(doc, item.name, "translated", settings);
      outputs.push({ path: outputPath(item, out.filename), content: out.content });
    }
    if (opts.exportBilingual) {
      const out = buildExport(doc, item.name, "bilingual", settings);
      outputs.push({ path: outputPath(item, out.filename), content: out.content });
    }

    after.updateQueueItem(item.id, {
      status: "done",
      outputs,
      error: result.failedIds.length > 0 ? `有 ${result.failedIds.length} 条未翻译` : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = e instanceof DOMException && e.name === "AbortError";
    useAppStore.getState().setPhase("parsed");
    useAppStore.getState().updateQueueItem(item.id, {
      status: aborted ? "cancelled" : "error",
      error: aborted ? undefined : msg,
    });
  }
}
