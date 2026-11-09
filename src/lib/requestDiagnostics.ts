"use client";

import { create } from "zustand";
import { createForwardingCaller, type LlmCaller, type LlmConfig, type LlmResult } from "@/core/translator/llmClient";

interface Diagnostics {
  requests: number;
  failedRequests: number;
  unknownUsageRequests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  last?: Pick<LlmResult, "finishReason" | "requestId" | "durationMs" | "sentParameters">;
}
const empty = (): Diagnostics => ({ requests: 0, failedRequests: 0, unknownUsageRequests: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 });
/** 只存脱敏元数据，既不持久化，也不保存正文或密钥。 */
export const useRequestDiagnostics = create<Diagnostics>(() => empty());
export const resetRequestDiagnostics = () => useRequestDiagnostics.setState(empty(), true);

export function createTrackedCaller(config: LlmConfig): LlmCaller {
  return async (messages, signal, options) => {
    let reported = false;
    const caller = createForwardingCaller({ ...config, onResult: (result) => {
      reported = true;
      useRequestDiagnostics.setState((s) => ({
        requests: s.requests + 1,
        unknownUsageRequests: s.unknownUsageRequests + (result.usage?.promptTokens == null || result.usage?.completionTokens == null ? 1 : 0),
        promptTokens: s.promptTokens + (result.usage?.promptTokens ?? 0),
        completionTokens: s.completionTokens + (result.usage?.completionTokens ?? 0),
        reasoningTokens: s.reasoningTokens + (result.usage?.reasoningTokens ?? 0),
        last: { finishReason: result.finishReason, requestId: result.requestId, durationMs: result.durationMs, sentParameters: result.sentParameters },
      }));
      config.onResult?.(result);
    } });
    try { return await caller(messages, signal, options); }
    catch (e) {
      useRequestDiagnostics.setState((s) => ({
        failedRequests: s.failedRequests + 1,
        requests: s.requests + (reported ? 0 : 1),
        unknownUsageRequests: s.unknownUsageRequests + (reported ? 0 : 1),
      }));
      throw e;
    }
  };
}
