"use client";

import { useRef, useState } from "react";
import { getActiveProfile, useAppStore } from "@/store";
import { createForwardingCaller } from "@/core/translator/llmClient";
import { translateDocument, type EngineOptions } from "@/core/translator/engine";
import { buildGlossary } from "@/core/glossary/build";

/** 从 store 里取当前激活服务，拼一个调用器；配置不全时返回 null。 */
function makeCaller() {
  const s = useAppStore.getState();
  const profile = getActiveProfile(s);
  if (!profile || !profile.baseURL || !profile.apiKey || !profile.model) return null;
  return createForwardingCaller({
    baseURL: profile.baseURL,
    apiKey: profile.apiKey,
    model: profile.model,
    temperature: s.params.temperature,
    maxTokens: s.params.maxTokens,
    reasoningEffort: s.params.reasoningEffort,
  });
}

/** 组装引擎参数（术语表按「是否启用」决定带不带）。 */
function engineOptions(): EngineOptions {
  const s = useAppStore.getState();
  return {
    sourceLang: s.params.sourceLang,
    targetLang: s.params.targetLang,
    customStyle: s.params.customStyle,
    systemPrompt: s.params.systemPrompt,
    batchSize: s.params.batchSize,
    concurrency: s.params.concurrency,
    maxRetries: s.params.maxRetries,
    contextLines: s.params.contextLines,
    trailingContextLines: s.params.trailingContextLines,
    maxCharsPerBatch: s.params.maxCharsPerBatch,
    glossary: s.params.useGlossary ? s.glossary : [],
  };
}

/** 翻译编排：客户端循环驱动批次（见规范 §6），支持取消与断点续传。 */
export function useTranslator() {
  const abortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    const s = useAppStore.getState();
    const doc = s.document;
    if (!doc) return;
    const caller = makeCaller();
    if (!caller) {
      setError("请先在设置里配置并选择一个翻译服务");
      return;
    }

    setError(null);
    s.setPhase("translating");
    const controller = new AbortController();
    abortRef.current = controller;

    let lastBump = 0;
    try {
      const result = await translateDocument(doc, caller, engineOptions(), {
        signal: controller.signal,
        onProgress: (p) => useAppStore.getState().setProgress(p),
        onEntry: () => {
          const now = Date.now();
          if (now - lastBump > 500) {
            lastBump = now;
            useAppStore.getState().bumpDocVersion();
          }
        },
      });
      useAppStore.getState().setFailedIds(result.failedIds, result.lastError ?? null);
      useAppStore.getState().bumpDocVersion();
      useAppStore.getState().setPhase("done");
      if (result.lastError) setError(`有 ${result.failedIds.length} 条未翻译：${result.lastError}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      useAppStore.getState().setPhase("parsed");
    } finally {
      abortRef.current = null;
    }
  };

  /** 重译指定条目（先清空译文再走一遍常规流程，复用断点续传逻辑）。 */
  const retranslate = async (ids: number[]) => {
    if (ids.length === 0) return;
    useAppStore.getState().clearTranslations(ids);
    await start();
  };

  const cancel = () => abortRef.current?.abort();

  return { start, retranslate, cancel, error };
}

/** 术语表生成：扫全片专名 → 调一次模型 → 得到可编辑的 {原文: 译名}。 */
export function useGlossaryBuilder() {
  const abortRef = useRef<AbortController | null>(null);

  const build = async () => {
    const s = useAppStore.getState();
    const doc = s.document;
    if (!doc) return;
    const caller = makeCaller();
    if (!caller) {
      s.setGlossaryStatus("error", "请先在设置里配置并选择一个翻译服务");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    s.setGlossaryStatus("building");
    try {
      const texts = doc.entries.filter((e) => !e.excluded).map((e) => e.originalText);
      const { entries, candidates } = await buildGlossary(texts, caller, {
        sourceLang: s.params.sourceLang,
        targetLang: s.params.targetLang,
        signal: controller.signal,
      });
      useAppStore.getState().setGlossary(entries);
      useAppStore
        .getState()
        .setGlossaryStatus(
          "ready",
          entries.length === 0 && candidates.length > 0 ? "模型没有认定任何专名，可手动添加" : null,
        );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useAppStore.getState().setGlossaryStatus("error", msg);
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  return { build, cancel };
}
