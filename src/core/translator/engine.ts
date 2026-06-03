// 翻译引擎（见规范 §6）：只接收公共模型、输出带译文的公共模型。
// 客户端编排：逐批调用、自己更新进度，后端保持无状态（见规范 §2「编排放在客户端」）。
//
// 强约束行对齐：带 ID 结构化 I/O + 条数校验 + 仅对缺失项重试。
// 多次重试仍缺失 → 标记为未翻译（绝不静默错位）。

import type { SubtitleDocument, SubtitleEntry } from "@/core/model";
import { LlmError, type LlmCaller } from "@/core/translator/llmClient";
import {
  buildMessages,
  parseTranslationResponse,
  type BatchItem,
  type PromptOptions,
} from "@/core/translator/prompt";

export interface EngineOptions extends PromptOptions {
  /** 每批条数（建议 20–40） */
  batchSize: number;
  /** 并发批次数（建议 3–5） */
  concurrency: number;
  /** 每批最大重试次数（针对缺失项 / 429 / 5xx） */
  maxRetries: number;
  /** 携带前文几条作为上下文（仅参考、不翻译） */
  contextLines: number;
}

export interface Progress {
  completedBatches: number;
  totalBatches: number;
  translatedEntries: number;
  totalEntries: number;
  failedEntries: number;
}

export interface TranslateCallbacks {
  onProgress?: (p: Progress) => void;
  /** 每当某条目获得译文时回调，便于增量更新预览 */
  onEntry?: (entry: SubtitleEntry) => void;
  signal?: AbortSignal;
}

export interface TranslateResult {
  /** 仍未翻译成功的条目 id（多次重试后仍缺失） */
  failedIds: number[];
  /** 是否被用户取消 */
  cancelled: boolean;
}

export const DEFAULT_ENGINE_OPTIONS: Omit<EngineOptions, "sourceLang" | "targetLang"> = {
  batchSize: 20,
  concurrency: 6,
  maxRetries: 3,
  contextLines: 3,
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** 仅对「需要翻译」的条目编批：跳过空文本/纯空白（见规范 §11）。 */
function isTranslatable(e: SubtitleEntry): boolean {
  return e.originalText.trim() !== "";
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 极简并发限制器（避免运行时强依赖 p-limit 的 ESM 加载差异；行为等价）。 */
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const run = queue.shift()!;
    run();
  };
  return function <T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      };
      queue.push(run);
      next();
    });
  };
}

export async function translateDocument(
  doc: SubtitleDocument,
  caller: LlmCaller,
  options: EngineOptions,
  callbacks: TranslateCallbacks = {},
): Promise<TranslateResult> {
  const { signal, onProgress, onEntry } = callbacks;
  const byId = new Map<number, SubtitleEntry>();
  for (const e of doc.entries) byId.set(e.id, e);

  // 断点续传：跳过已有译文的条目（见规范 §6 进度/续传）。
  const pending = doc.entries.filter(
    (e) => isTranslatable(e) && (e.translatedText == null || e.translatedText === ""),
  );
  const batches = chunk(pending, Math.max(1, options.batchSize));

  const totalEntries = doc.entries.filter(isTranslatable).length;
  let translatedEntries = doc.entries.filter(
    (e) => isTranslatable(e) && e.translatedText != null && e.translatedText !== "",
  ).length;
  let completedBatches = 0;
  const failedIds: number[] = [];
  let cancelled = false;

  const emitProgress = () => {
    onProgress?.({
      completedBatches,
      totalBatches: batches.length,
      translatedEntries,
      totalEntries,
      failedEntries: failedIds.length,
    });
  };
  emitProgress();

  const limit = pLimit(Math.max(1, options.concurrency));

  const runBatch = async (batchEntries: SubtitleEntry[]): Promise<void> => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // 上下文：该批第一条之前的若干条（取原文，仅参考）
    const firstId = batchEntries[0].id;
    const context: BatchItem[] = [];
    if (options.contextLines > 0) {
      const idx = doc.entries.findIndex((e) => e.id === firstId);
      const from = Math.max(0, idx - options.contextLines);
      for (let i = from; i < idx; i++) {
        if (isTranslatable(doc.entries[i])) {
          context.push({ id: doc.entries[i].id, text: doc.entries[i].originalText });
        }
      }
    }

    let missing = batchEntries.map((e) => ({ id: e.id, text: e.originalText }));

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (missing.length === 0) break;

      try {
        const messages = buildMessages(missing, options, context);
        const content = await caller(messages, signal);
        const map = parseTranslationResponse(content);

        const stillMissing: BatchItem[] = [];
        for (const item of missing) {
          const t = map.get(item.id);
          if (typeof t === "string" && t.trim() !== "") {
            const entry = byId.get(item.id);
            if (entry) {
              entry.translatedText = t;
              translatedEntries++;
              onEntry?.(entry);
            }
          } else {
            stillMissing.push(item);
          }
        }
        missing = stillMissing;
        emitProgress();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        const status = err instanceof LlmError ? err.status : 0;
        const retriable = status === 429 || status >= 500 || status === 0;
        if (!retriable || attempt === options.maxRetries) {
          // 不可重试或已用尽：本批剩余标记失败
          break;
        }
        // 指数退避（429/5xx/网络），尊重供应商限流
        const delay = Math.min(15_000, 500 * 2 ** attempt) + Math.random() * 300;
        await sleep(delay, signal);
        continue;
      }

      if (missing.length > 0 && attempt < options.maxRetries) {
        // 仍缺失：缩小批量重试更易对齐（这里逐条重试缺失项）
        const delay = 300 * (attempt + 1);
        await sleep(delay, signal);
      }
    }

    for (const m of missing) failedIds.push(m.id);
    completedBatches++;
    emitProgress();
  };

  try {
    await Promise.all(batches.map((b) => limit(() => runBatch(b))));
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      cancelled = true;
    } else {
      throw err;
    }
  }

  failedIds.sort((a, b) => a - b);
  return { failedIds, cancelled };
}
