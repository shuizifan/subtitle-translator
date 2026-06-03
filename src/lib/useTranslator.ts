"use client";

import { useRef, useState } from "react";
import { getActiveProfile, useAppStore } from "@/store";
import { createForwardingCaller } from "@/core/translator/llmClient";
import { translateDocument, type EngineOptions } from "@/core/translator/engine";

/** 翻译编排：客户端循环驱动批次（见规范 §6），支持取消与断点续传。 */
export function useTranslator() {
  const abortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    const s = useAppStore.getState();
    const doc = s.document;
    const profile = getActiveProfile(s);
    if (!doc) return;
    if (!profile || !profile.baseURL || !profile.apiKey || !profile.model) {
      setError("请先在设置里配置并选择一个翻译服务");
      return;
    }

    setError(null);
    s.setPhase("translating");
    const controller = new AbortController();
    abortRef.current = controller;

    const caller = createForwardingCaller({
      baseURL: profile.baseURL,
      apiKey: profile.apiKey,
      model: profile.model,
      temperature: s.params.temperature,
      maxTokens: s.params.maxTokens,
    });

    const opts: EngineOptions = {
      sourceLang: s.params.sourceLang,
      targetLang: s.params.targetLang,
      customStyle: s.params.customStyle,
      systemPrompt: s.params.systemPrompt,
      batchSize: s.params.batchSize,
      concurrency: s.params.concurrency,
      maxRetries: s.params.maxRetries,
      contextLines: s.params.contextLines,
    };

    let lastBump = 0;
    try {
      const result = await translateDocument(doc, caller, opts, {
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
      useAppStore.getState().setFailedIds(result.failedIds);
      useAppStore.getState().bumpDocVersion();
      useAppStore.getState().setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      useAppStore.getState().setPhase("parsed");
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  return { start, cancel, error };
}
