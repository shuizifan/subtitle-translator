// 术语表生成（需要调用模型，故与纯函数部分分开放）。

import type { LlmCaller } from "@/core/translator/llmClient";
import {
  buildGlossaryMessages,
  extractTermCandidates,
  parseGlossaryResponse,
  type GlossaryEntry,
  type TermCandidate,
} from "@/core/glossary";

export interface BuildGlossaryOptions {
  sourceLang: string;
  targetLang: string;
  /** 候选上限，默认 150 */
  limit?: number;
  /** 每次请求最多送多少候选，太多容易被 max_tokens 截断，默认 60 */
  chunkSize?: number;
  signal?: AbortSignal;
}

export interface BuildGlossaryResult {
  entries: GlossaryEntry[];
  candidates: TermCandidate[];
}

/** 扫全片 → 抽候选 → 调模型 → 得到 {原文: 译名} 术语表。 */
export async function buildGlossary(
  texts: string[],
  caller: LlmCaller,
  opts: BuildGlossaryOptions,
): Promise<BuildGlossaryResult> {
  const candidates = extractTermCandidates(texts, { limit: opts.limit ?? 150 });
  if (candidates.length === 0) return { entries: [], candidates };

  const chunkSize = Math.max(10, opts.chunkSize ?? 60);
  const chunks: TermCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += chunkSize) chunks.push(candidates.slice(i, i + chunkSize));

  const entries: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const part of chunks) {
    const content = await caller(buildGlossaryMessages(part, opts), opts.signal);
    for (const e of parseGlossaryResponse(content)) {
      if (seen.has(e.term)) continue;
      seen.add(e.term);
      entries.push(e);
    }
  }
  return { entries, candidates };
}
