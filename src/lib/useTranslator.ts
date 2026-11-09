"use client";

import { useRef, useState } from "react";
import { getActiveProfile, useAppStore } from "@/store";
import { createTrackedCaller } from "@/lib/requestDiagnostics";
import { resolveLlmConfig } from "@/core/translator/config";
import { translateDocument, type EngineOptions } from "@/core/translator/engine";
import { buildGlossary } from "@/core/glossary/build";

/** 从 store 里取当前激活服务，拼一个调用器；配置不全时返回 null。 */
function makeCaller(s = useAppStore.getState()) {
  const profile = getActiveProfile(s);
  if (!profile || !profile.baseURL || (profile.authMode !== "none" && !profile.apiKey) || !profile.model) return null;
  return createTrackedCaller(resolveLlmConfig(profile, s.params));
}

/** 组装引擎参数（术语表按「是否启用」决定带不带）。 */
function engineOptions(s = useAppStore.getState()): EngineOptions {
  return {
    sourceLang: s.params.sourceLang,
    targetLang: s.params.targetLang,
    targetLocale: s.params.targetLocale,
    customStyle: s.params.customStyle,
    systemPrompt: s.params.systemPrompt,
    batchSize: s.params.batchSize,
    concurrency: s.params.concurrency,
    maxRetries: s.params.maxRetries,
    contextLines: s.params.contextLines,
    trailingContextLines: s.params.trailingContextLines,
    maxCharsPerBatch: s.params.maxCharsPerBatch,
    glossary: s.params.useGlossary ? s.glossary.map((e) => ({ ...e })) : [],
  };
}

/** 翻译编排：客户端循环驱动批次（见规范 §6），支持取消与断点续传。 */
export function useTranslator() {
  const abortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    const s = useAppStore.getState();
    if (s.phase === "translating" || s.queueRunning || s.glossaryStatus === "building") return;
    const doc = s.document;
    if (!doc) return;
    const caller = makeCaller(s);
    if (!caller) {
      setError("请先在设置里配置并选择一个翻译服务");
      return;
    }

    setError(null);
    s.setProgress(null);
    s.setPhase("translating");
    s.setFailedIds([]);
    const controller = new AbortController();
    abortRef.current = controller;
    const isCurrent = () => useAppStore.getState().document?.taskId === doc.taskId;

    let lastBump = 0;
    try {
      const result = await translateDocument(doc, caller, engineOptions(s), {
        signal: controller.signal,
        onProgress: (p) => { if (isCurrent()) useAppStore.getState().setProgress(p); else controller.abort(); },
        onFailed: (ids, error) => { if (isCurrent()) useAppStore.getState().setFailedIds(ids, error); },
        onEntry: () => {
          if (!isCurrent()) return;
          const now = Date.now();
          if (now - lastBump > 500) {
            lastBump = now;
            useAppStore.getState().bumpDocVersion();
          }
        },
      });
      if (!isCurrent()) return;
      useAppStore.getState().setFailedIds(result.failedIds, result.lastError ?? null);
      useAppStore.getState().bumpDocVersion();
      useAppStore.getState().setPhase("done");
      if (result.terminalError) setError(`任务已停止：${result.terminalError}；${result.unprocessedIds.length} 条尚未处理`);
      else if (result.lastError) setError(`有 ${result.failedIds.length} 条未翻译：${result.lastError}`);
    } catch (e) {
      if (!isCurrent()) return;
      setError(e instanceof Error ? e.message : String(e));
      useAppStore.getState().setPhase("parsed");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  /** 重译指定条目（先清空译文再走一遍常规流程，复用断点续传逻辑）。 */
  const retranslate = async (ids: number[]) => {
    if (ids.length === 0 || useAppStore.getState().phase === "translating" || useAppStore.getState().queueRunning || useAppStore.getState().glossaryStatus === "building") return;
    useAppStore.getState().clearTranslations(ids);
    await start();
  };

  const cancel = () => abortRef.current?.abort();

  return { start, retranslate, cancel, error };
}

/** 术语候选生成：可分批请求，结果需审核后才加入生效表。 */
export function useGlossaryBuilder() {
  const abortRef = useRef<AbortController | null>(null);

  const build = async () => {
    const s = useAppStore.getState();
    if (s.phase === "translating" || s.queueRunning || s.glossaryStatus === "building") return;
    const doc = s.document;
    if (!doc) return;
    const caller = makeCaller(s);
    if (!caller) {
      s.setGlossaryStatus("error", "请先在设置里配置并选择一个翻译服务");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    s.setGlossaryStatus("building");
    s.setGlossaryCandidates([]);
    s.setGlossaryProgress({ phase: "scanning", done: 0, total: 0, candidates: 0, terms: 0 });
    try {
      const texts = doc.entries.filter((e) => !e.excluded).map((e) => e.originalText);
      const { entries, candidates, failedChunks, lastError } = await buildGlossary(texts, caller, {
        sourceLang: s.params.sourceLang,
        targetLang: s.params.targetLang,
        signal: controller.signal,
        onProgress: (p) => {
          if (useAppStore.getState().document?.taskId === doc.taskId) useAppStore.getState().setGlossaryProgress(p);
        },
        // 边生成边展示：长片分几批请求，不必等全部回来才看到结果
        onPartial: (partial) => {
          if (useAppStore.getState().document?.taskId === doc.taskId) useAppStore.getState().setGlossaryCandidates(partial);
        },
      });
      if (useAppStore.getState().document?.taskId !== doc.taskId) return;
      useAppStore.getState().setGlossaryCandidates(entries);
      const note =
        candidates.length === 0
          ? "没有从这份字幕里抽到专名候选（候选靠首字母大写等线索，中日韩源语言通常抽不到），可手动添加。"
          : failedChunks > 0
            ? `有 ${failedChunks} 批请求失败，已保留其余结果。最后一次失败原因：${lastError ?? "未知"}`
            : entries.length === 0
              ? "模型没有认定任何专名，可手动添加。"
              : null;
      useAppStore.getState().setGlossaryStatus("ready", note);
    } catch (e) {
      if (useAppStore.getState().document?.taskId !== doc.taskId) return;
      const aborted = e instanceof DOMException && e.name === "AbortError";
      const msg = e instanceof Error ? e.message : String(e);
      useAppStore.getState().setGlossaryStatus(aborted ? "idle" : "error", aborted ? null : msg);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  return { build, cancel };
}
