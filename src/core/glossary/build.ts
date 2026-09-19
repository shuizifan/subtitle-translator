// 术语表生成（需要调用模型，故与纯函数部分分开放）。
//
// 一部长片会抽出上百个候选，要分几批请求；整个过程可能几十秒，
// 因此全程回报进度与已得到的部分结果，避免界面看起来像卡死。

import type { LlmCaller } from "@/core/translator/llmClient";
import {
  buildGlossaryMessages,
  extractTermCandidates,
  parseGlossaryResponse,
  type GlossaryEntry,
  type TermCandidate,
} from "@/core/glossary";

export interface GlossaryProgress {
  /** scanning=正在扫全片抽候选；requesting=正在请求模型 */
  phase: "scanning" | "requesting";
  /** 已完成的批次数 */
  done: number;
  /** 总批次数 */
  total: number;
  /** 抽到的候选总数 */
  candidates: number;
  /** 目前已确认的术语条数 */
  terms: number;
}

export interface BuildGlossaryOptions {
  sourceLang: string;
  targetLang: string;
  /** 候选上限，默认 150 */
  limit?: number;
  /** 每次请求最多送多少候选，太多容易被 max_tokens 截断，默认 60 */
  chunkSize?: number;
  /** 同时进行的请求数，默认 3 */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: GlossaryProgress) => void;
  /** 每批返回后回调一次「目前已得到的完整术语表」，便于边生成边展示 */
  onPartial?: (entries: GlossaryEntry[]) => void;
}

export interface BuildGlossaryResult {
  entries: GlossaryEntry[];
  candidates: TermCandidate[];
  /** 失败的批次数（其余批次的结果仍然可用） */
  failedChunks: number;
  /** 最后一次失败原因 */
  lastError?: string;
}

/** 按 index 顺序把各批结果合并去重。 */
function flatten(parts: Array<GlossaryEntry[] | undefined>): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const e of part ?? []) {
      if (seen.has(e.term)) continue;
      seen.add(e.term);
      out.push(e);
    }
  }
  return out;
}

/** 扫全片 → 抽候选 → 调模型 → 得到 {原文: 译名} 术语表。 */
export async function buildGlossary(
  texts: string[],
  caller: LlmCaller,
  opts: BuildGlossaryOptions,
): Promise<BuildGlossaryResult> {
  opts.onProgress?.({ phase: "scanning", done: 0, total: 0, candidates: 0, terms: 0 });
  const candidates = extractTermCandidates(texts, { limit: opts.limit ?? 150 });
  if (candidates.length === 0) return { entries: [], candidates, failedChunks: 0 };

  const chunkSize = Math.max(10, opts.chunkSize ?? 60);
  const chunks: TermCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += chunkSize) chunks.push(candidates.slice(i, i + chunkSize));

  const results: Array<GlossaryEntry[] | undefined> = new Array(chunks.length);
  let done = 0;
  let failedChunks = 0;
  let lastError: string | undefined;

  const report = () =>
    opts.onProgress?.({
      phase: "requesting",
      done,
      total: chunks.length,
      candidates: candidates.length,
      terms: flatten(results).length,
    });
  report();

  // 并发跑各批：一部长片分 3 批时，串行要等三倍的时间
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, chunks.length));
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= chunks.length) return;
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const content = await caller(buildGlossaryMessages(chunks[i], opts), opts.signal);
        results[i] = parseGlossaryResponse(content);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        // 单批失败不该让整张表作废，其余批次的结果照常保留
        failedChunks++;
        lastError = e instanceof Error ? e.message : String(e);
        results[i] = [];
      }
      done++;
      report();
      opts.onPartial?.(flatten(results));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const entries = flatten(results);
  if (failedChunks === chunks.length) {
    throw new Error(lastError ?? "术语表生成失败");
  }
  return { entries, candidates, failedChunks, lastError };
}
