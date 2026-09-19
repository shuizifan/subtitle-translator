// 翻译引擎（见规范 §6）：只接收公共模型、输出带译文的公共模型。
// 客户端编排：逐批调用、自己更新进度，后端保持无状态（见规范 §2「编排放在客户端」）。
//
// 强约束行对齐：带 ID 结构化 I/O + 条数校验 + 仅对缺失项重试。
// 多次重试仍缺失 → 标记为未翻译（绝不静默错位）。

import type { SubtitleDocument, SubtitleEntry } from "@/core/model";
import { LlmError, type LlmCaller } from "@/core/translator/llmClient";
import { selectGlossaryFor } from "@/core/glossary";
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
  /**
   * 携带后文几条作为上下文（仅参考、不翻译）。
   * 批内条目能互相看见，但批尾那条看不到下一条；一句话正好跨批次切开时缺少判断依据。
   */
  trailingContextLines?: number;
  /**
   * 每批原文字符数上限（0=不限）。固定条数遇到长台词会撑爆 max_tokens，
   * 按字符数动态分批比固定条数稳（见改进建议 #14）。
   */
  maxCharsPerBatch?: number;
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
  /** 最后一次失败的原因（有条目失败时才有值），供 UI 解释「为什么有未翻译的行」 */
  lastError?: string;
}

export const DEFAULT_ENGINE_OPTIONS: Omit<EngineOptions, "sourceLang" | "targetLang"> = {
  batchSize: 20,
  concurrency: 6,
  maxRetries: 3,
  contextLines: 3,
  trailingContextLines: 2,
  maxCharsPerBatch: 1600,
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

/** 仅对「需要翻译」的条目编批：跳过空文本/纯空白，以及清理时排除的非台词条目。 */
function isTranslatable(e: SubtitleEntry): boolean {
  return e.originalText.trim() !== "" && !e.excluded;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 按「条数 + 字符数」双上限分批。
 * 固定 20 条在普通对白下没问题，遇到成段独白就会让一次请求要生成很长的 JSON，
 * 顶破 max_tokens 后整批失败重试；加一道字符数闸门能直接避开这种情况。
 */
export function chunkByBudget<T>(items: T[], size: number, maxChars: number, lengthOf: (x: T) => number): T[][] {
  const limit = Math.max(1, size);
  if (!maxChars || maxChars <= 0) return chunk(items, limit);
  const out: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const it of items) {
    const len = lengthOf(it);
    if (cur.length > 0 && (cur.length >= limit || chars + len > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += len;
  }
  if (cur.length > 0) out.push(cur);
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
  const batches = chunkByBudget(
    pending,
    options.batchSize,
    options.maxCharsPerBatch ?? 0,
    (e) => e.originalText.length,
  );

  // id → 在 doc.entries 里的下标，取上下文时 O(1)
  const indexById = new Map<number, number>();
  doc.entries.forEach((e, i) => indexById.set(e.id, i));

  const totalEntries = doc.entries.filter(isTranslatable).length;
  let translatedEntries = doc.entries.filter(
    (e) => isTranslatable(e) && e.translatedText != null && e.translatedText !== "",
  ).length;
  let completedBatches = 0;
  const failedIds: number[] = [];
  let cancelled = false;
  let lastError: string | undefined;

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

  /** 取某段条目前后的若干条原文作为上下文（仅参考、不翻译）。 */
  const contextAround = (part: BatchItem[]): { before: BatchItem[]; after: BatchItem[] } => {
    const before: BatchItem[] = [];
    const after: BatchItem[] = [];
    const firstIdx = indexById.get(part[0].id);
    const lastIdx = indexById.get(part[part.length - 1].id);
    const lead = options.contextLines;
    const trail = options.trailingContextLines ?? 0;
    if (firstIdx != null && lead > 0) {
      for (let i = Math.max(0, firstIdx - lead); i < firstIdx; i++) {
        if (isTranslatable(doc.entries[i])) {
          before.push({ id: doc.entries[i].id, text: doc.entries[i].originalText });
        }
      }
    }
    if (lastIdx != null && trail > 0) {
      for (let i = lastIdx + 1; i < doc.entries.length && after.length < trail; i++) {
        if (isTranslatable(doc.entries[i])) {
          after.push({ id: doc.entries[i].id, text: doc.entries[i].originalText });
        }
      }
    }
    return { before, after };
  };

  const runBatch = async (batchEntries: SubtitleEntry[]): Promise<void> => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    let missing = batchEntries.map((e) => ({ id: e.id, text: e.originalText }));

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (missing.length === 0) break;

      // 重试时逐轮折半缩批。原样重发同一个请求几乎必然重复失败：最常见的
      // 失败原因是输出被 max_tokens 截断（思考型模型的思考 token 也占这个额度），
      // 而缩小批量直接缩短了需要生成的 JSON，是唯一能真正改变结果的手段。
      const chunkSize =
        attempt === 0 ? missing.length : Math.max(1, Math.ceil(missing.length / 2 ** attempt));

      const stillMissing: BatchItem[] = [];
      let retriableError = false;
      let fatalError = false;

      for (const part of chunk(missing, chunkSize)) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
          const { before, after } = contextAround(part);
          // 只把这一批里真的出现了的术语发给模型：整表上百条既费 token 又稀释注意力
          const glossary = selectGlossaryFor(options.glossary ?? [], part.map((p) => p.text));
          const messages = buildMessages(part, { ...options, glossary }, before, after);
          const content = await caller(messages, signal);
          const map = parseTranslationResponse(content);

          for (const item of part) {
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
          emitProgress();
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") throw err;
          const status = err instanceof LlmError ? err.status : 0;
          lastError = err instanceof Error ? err.message : String(err);
          if (status === 429 || status >= 500 || status === 0) retriableError = true;
          else fatalError = true;
          stillMissing.push(...part);
        }
      }

      missing = stillMissing;
      if (missing.length === 0) break;
      // 鉴权/参数错误（4xx，非 429）：重试没有意义，直接判失败
      if (fatalError && !retriableError) break;
      if (attempt === options.maxRetries) break;

      const delay = retriableError
        ? // 指数退避（429/5xx/网络），尊重供应商限流
          Math.min(15_000, 500 * 2 ** attempt) + Math.random() * 300
        : 300 * (attempt + 1);
      await sleep(delay, signal);
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
  return { failedIds, cancelled, lastError: failedIds.length > 0 ? lastError : undefined };
}
