"use client";

import { useRef } from "react";
import { useAppStore, snapshotSettings, type SettingsSnapshot, type QueueItem } from "@/store";
import { useSubtitleLoaderContext } from "@/lib/SubtitleLoaderContext";
import { LlmError } from "@/core/translator/llmClient";
import { resolveLlmConfig } from "@/core/translator/config";
import { createTrackedCaller } from "@/lib/requestDiagnostics";
import { translateDocument, type EngineOptions } from "@/core/translator/engine";
import { buildGlossary } from "@/core/glossary/build";
import { buildExport } from "@/lib/exportDoc";
import { buildZipBlob } from "@/core/zip";
import { downloadBlob } from "@/lib/exportDoc";

export interface BatchOptions {
  /** 每部生成术语候选并暂停审核；会额外分批请求。 */
  glossaryPerFile: boolean;
  exportTranslated: boolean;
  exportBilingual: boolean;
}

export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
  glossaryPerFile: false,
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
  const settingsRef = useRef<SettingsSnapshot | null>(null);
  const { loadBytes } = useSubtitleLoaderContext();

  const runAll = async (opts: BatchOptions) => {
    const current = useAppStore.getState();
    if (current.queueRunning || current.phase === "translating" || current.glossaryStatus === "building") return;
    if (!current.queue.some((q) => q.status === "review") || !settingsRef.current) {
      settingsRef.current = snapshotSettings(current);
    }
    const settings = settingsRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    useAppStore.getState().setQueueRunning(true);

    try {
      for (;;) {
        if (controller.signal.aborted) break;
        const queue = useAppStore.getState().queue;
        const next = queue.find((q) => q.status === "review") ?? queue.find((q) => q.status === "pending");
        if (!next) break;
        const action = await runOne(next, opts, controller.signal, loadBytes, settings);
        if (action !== "continue") break;
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
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

export async function runOne(
  item: QueueItem,
  opts: BatchOptions,
  signal: AbortSignal,
  loadBytes: (bytes: Uint8Array, name: string, forced?: string, settings?: SettingsSnapshot) => void,
  settings: SettingsSnapshot,
): Promise<"continue" | "pause" | "stop"> {
  const store = useAppStore.getState();
  let taskId: string | undefined;
  store.updateQueueItem(item.id, { status: "running", error: undefined });

  try {
    // 解析并显示在主界面（清理、语种判定与单文件流程完全一致）
    if (item.status !== "review") loadBytes(item.bytes, item.name, "auto", settings);
    const s = useAppStore.getState();
    const doc = s.document;
    if (!doc || s.fileName !== item.name || (item.status === "review" && doc.taskId !== item.reviewDocumentId)) {
      throw new Error("当前文件已变化，请重新加入队列；未继续使用其他文件的术语");
    }
    taskId = doc.taskId;
    const isCurrent = () => useAppStore.getState().document?.taskId === doc.taskId;

    const profile = settings.apiProfiles.find((p) => p.id === settings.activeProfileId);
    if (!profile || !profile.baseURL || (profile.authMode !== "none" && !profile.apiKey) || !profile.model) {
      throw new LlmError("请先在设置里配置并选择一个翻译服务", 400, "invalid-config");
    }
    const caller = createTrackedCaller(resolveLlmConfig(profile, settings.params));
    const params = { ...settings.params, sourceLang: settings.params.autoDetectSource && s.detectedLang && s.detectedLang !== "auto" ? s.detectedLang : settings.params.sourceLang };

    // 生成结果只进入当前文件候选表，不覆盖人工词条，也不直接用于翻译。
    if (item.status !== "review" && opts.glossaryPerFile && params.useGlossary) {
      s.setGlossaryStatus("building");
      s.setGlossaryCandidates([]);
      s.setGlossaryProgress({ phase: "scanning", done: 0, total: 0, candidates: 0, terms: 0 });
      try {
        const texts = doc.entries.filter((e) => !e.excluded).map((e) => e.originalText);
        const { entries, failedChunks, lastError } = await buildGlossary(texts, caller, {
          sourceLang: params.sourceLang, targetLang: params.targetLang, signal,
          onProgress: (p) => { if (isCurrent()) useAppStore.getState().setGlossaryProgress(p); },
          onPartial: (partial) => { if (isCurrent()) useAppStore.getState().setGlossaryCandidates(partial); },
        });
        if (!isCurrent()) throw new DOMException("当前文件已变化", "AbortError");
        s.setGlossaryCandidates(entries);
        s.setGlossaryStatus("ready", failedChunks ? `部分候选未生成：${lastError ?? "未知原因"}` : null);
        if (entries.length > 0) {
          s.updateQueueItem(item.id, { status: "review", reviewDocumentId: doc.taskId, error: "请在术语表接受或忽略候选，再继续批量翻译" });
          return "pause";
        }
      } catch (e) {
        if (isCurrent()) s.setGlossaryStatus("error", e instanceof Error ? e.message : String(e));
        throw e;
      }
    }
    if (item.status === "review" && s.glossaryCandidates.length > 0) {
      s.updateQueueItem(item.id, { status: "review", error: "仍有待审核候选，请接受或忽略后继续" });
      return "pause";
    }
    if (signal.aborted) {
      s.updateQueueItem(item.id, { status: "cancelled" });
      return "stop";
    }

    const cur = useAppStore.getState();
    const engineOpts: EngineOptions = {
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      targetLocale: params.targetLocale,
      customStyle: params.customStyle,
      systemPrompt: params.systemPrompt,
      batchSize: params.batchSize,
      concurrency: params.concurrency,
      maxRetries: params.maxRetries,
      contextLines: params.contextLines,
      trailingContextLines: params.trailingContextLines,
      maxCharsPerBatch: params.maxCharsPerBatch,
      glossary: params.useGlossary ? cur.glossary.map((e) => ({ ...e })) : [],
    };

    cur.setProgress(null);
    cur.setPhase("translating");
    cur.setFailedIds([]);
    let lastBump = 0;
    const result = await translateDocument(doc, caller, engineOpts, {
      signal,
      onFailed: (ids, error) => { if (isCurrent()) useAppStore.getState().setFailedIds(ids, error); },
      onProgress: (p) => {
        if (isCurrent()) useAppStore.getState().setProgress(p);
        useAppStore
          .getState()
          .updateQueueItem(item.id, { translated: p.translatedEntries, total: p.totalEntries });
      },
      onEntry: () => {
        if (!isCurrent()) return;
        const now = Date.now();
        if (now - lastBump > 500) {
          lastBump = now;
          useAppStore.getState().bumpDocVersion();
        }
      },
    });
    if (!isCurrent()) throw new DOMException("当前文件已变化", "AbortError");

    const after = useAppStore.getState();
    after.setFailedIds(result.failedIds, result.lastError ?? null);
    after.bumpDocVersion();
    after.setPhase("done");

    if (result.cancelled) {
      after.updateQueueItem(item.id, { status: "cancelled" });
      return "stop";
    }
    if (result.terminalError) {
      after.updateQueueItem(item.id, { status: "error", error: result.terminalError });
      return "stop";
    }

    const exportSettings = { ...settings, params };
    const outputs: { path: string; content: string }[] = [];
    if (opts.exportTranslated) {
      const out = buildExport(doc, item.name, "translated", exportSettings);
      outputs.push({ path: outputPath(item, out.filename), content: out.content });
    }
    if (opts.exportBilingual) {
      const out = buildExport(doc, item.name, "bilingual", exportSettings);
      outputs.push({ path: outputPath(item, out.filename), content: out.content });
    }

    after.updateQueueItem(item.id, {
      status: result.failedIds.length > 0 ? "error" : "done",
      outputs,
      error: result.failedIds.length > 0 ? `有 ${result.failedIds.length} 条未翻译` : undefined,
    });
    return "continue";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = e instanceof DOMException && e.name === "AbortError";
    if (taskId && useAppStore.getState().document?.taskId === taskId) useAppStore.getState().setPhase("parsed");
    useAppStore.getState().updateQueueItem(item.id, {
      status: aborted ? "cancelled" : "error",
      error: aborted ? undefined : msg,
    });
    return aborted || (e instanceof LlmError && e.status >= 400 && e.status < 500 && e.status !== 429) ? "stop" : "continue";
  }
}
