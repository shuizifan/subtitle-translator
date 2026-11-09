import type { SubtitleDocument, SubtitleEntry } from "@/core/model";
import { LlmError, type LlmCaller } from "@/core/translator/llmClient";
import { selectGlossaryFor } from "@/core/glossary";
import { buildMessages, validateTranslationResponse, type BatchItem, type PromptOptions } from "@/core/translator/prompt";

export interface EngineOptions extends PromptOptions {
  batchSize: number;
  concurrency: number;
  maxRetries: number;
  contextLines: number;
  trailingContextLines?: number;
  maxCharsPerBatch?: number;
  /** 全任务调用尝试次数硬上限；默认 min(10000, 初始批数 * 4 + 10)，含本地预算预检失败。 */
  maxRequests?: number;
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
  onFailed?: (ids: number[], error?: string) => void;
  onEntry?: (entry: SubtitleEntry) => void;
  signal?: AbortSignal;
}
export interface TranslateResult {
  failedIds: number[];
  /** 取消或任务级错误中止的条目，与已确认失败分开。 */
  unprocessedIds: number[];
  cancelled: boolean;
  lastError?: string;
  terminalError?: string;
  requestCount: number;
  validation: { rescuedResponses: number; duplicateIds: number; unexpectedIds: number; invalidIds: number };
}
export const DEFAULT_ENGINE_OPTIONS: Omit<EngineOptions, "sourceLang" | "targetLang"> = {
  batchSize: 20, concurrency: 3, maxRetries: 3, contextLines: 3,
  trailingContextLines: 2, maxCharsPerBatch: 1600,
};
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function isTranslatable(e: SubtitleEntry): boolean { return e.originalText.trim() !== "" && !e.excluded; }
function positiveInt(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}
export function chunkByBudget<T>(items: T[], size: number, maxChars: number, lengthOf: (x: T) => number): T[][] {
  const limit = positiveInt(size, 1);
  const out: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const item of items) {
    const len = lengthOf(item);
    if (cur.length && (cur.length >= limit || (maxChars > 0 && chars + len > maxChars))) {
      out.push(cur); cur = []; chars = 0;
    }
    cur.push(item); chars += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function translateDocument(doc: SubtitleDocument, caller: LlmCaller, options: EngineOptions,
  callbacks: TranslateCallbacks = {}): Promise<TranslateResult> {
  const { onProgress, onEntry, onFailed } = callbacks;
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort();
  if (callbacks.signal?.aborted) abort();
  else callbacks.signal?.addEventListener("abort", abort, { once: true });
  const entries = doc.entries.filter(isTranslatable);
  const pending = entries.filter(e => !e.translatedText?.trim());
  const byId = new Map(entries.map(e => [e.id, e]));
  const positions = new Map(doc.entries.map((e, i) => [e.id, i]));
  // Already translated entries must remain visible as context, not disappear inside a sparse batch.
  const consecutive = <T extends { id: number }>(items: T[]): T[][] => {
    const groups: T[][] = [];
    for (const item of items) {
      const current = groups.at(-1);
      if (!current || positions.get(item.id)! !== positions.get(current.at(-1)!.id)! + 1) groups.push([item]);
      else current.push(item);
    }
    return groups;
  };
  const batches = consecutive(pending).flatMap(group => chunkByBudget(group, options.batchSize,
    options.maxCharsPerBatch ?? 0, e => e.originalText.length));
  const failed = new Set<number>();
  let translatedEntries = entries.length - pending.length;
  let completedBatches = 0;
  let requestCount = 0;
  let terminalError: string | undefined;
  let lastError: string | undefined;
  let concurrency = positiveInt(options.concurrency, 1);
  const maxRequests = positiveInt(options.maxRequests, Math.min(10000, batches.length * 4 + 10));
  const validation = { rescuedResponses: 0, duplicateIds: 0, unexpectedIds: 0, invalidIds: 0 };
  const maxRetries = Number.isFinite(options.maxRetries) ? Math.max(0, Math.floor(options.maxRetries)) : 3;
  let active = 0;
  const waiters: Array<() => void> = [];
  let cooldownUntil = 0;
  const wake = () => { for (const notify of waiters.splice(0)) notify(); };
  signal.addEventListener("abort", wake);
  const emit = () => onProgress?.({ completedBatches, totalBatches: batches.length,
    translatedEntries, totalEntries: entries.length, failedEntries: failed.size });
  const stop = (message: string) => { terminalError ??= message; lastError = message; controller.abort(); };
  const fail = (part: BatchItem[], message: string) => {
    for (const item of part) failed.add(item.id);
    lastError = message;
    onFailed?.([...failed].sort((a, b) => a - b), message);
    emit();
  };
  const contextAround = (part: BatchItem[]) => {
    const before: BatchItem[] = [], after: BatchItem[] = [];
    const lead = Math.max(0, Math.floor(options.contextLines || 0));
    const trail = Math.max(0, Math.floor(options.trailingContextLines || 0));
    for (let i = positions.get(part[0].id)! - 1; i >= 0 && before.length < lead; i--) {
      const e = doc.entries[i]; if (isTranslatable(e)) before.unshift({ id: e.id, text: e.originalText });
    }
    for (let i = positions.get(part.at(-1)!.id)! + 1; i < doc.entries.length && after.length < trail; i++) {
      const e = doc.entries[i]; if (isTranslatable(e)) after.push({ id: e.id, text: e.originalText });
    }
    return { before, after };
  };
  const call = async (part: BatchItem[]) => {
    while (!signal.aborted && active >= concurrency) await new Promise<void>(resolve => waiters.push(resolve));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    active++;
    try {
      while (cooldownUntil > Date.now()) await sleep(cooldownUntil - Date.now(), signal);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (requestCount >= maxRequests) {
        stop(`已达到本任务 ${maxRequests} 次调用尝试上限，剩余条目未处理`);
        throw new DOMException("Aborted", "AbortError");
      }
      requestCount++;
      const { before, after } = contextAround(part);
      const glossary = selectGlossaryFor(options.glossary ?? [], part.map(item => item.text));
      return await caller(buildMessages(part, { ...options, glossary }, before, after), signal, { purpose: "translation", targetItems: part });
    } finally { active--; wake(); }
  };
  const apply = (part: BatchItem[], content: string) => {
    const result = validateTranslationResponse(content, part.map(item => item.id));
    if (result.rescued) validation.rescuedResponses++;
    validation.duplicateIds += result.duplicate.length;
    validation.unexpectedIds += result.unexpected.length;
    validation.invalidIds += result.invalidIds.length;
    for (const [id, text] of result.valid) {
      const entry = byId.get(id)!;
      if (!entry.translatedText?.trim()) { entry.translatedText = text; translatedEntries++; onEntry?.(entry); }
    }
    emit();
    return part.filter(item => !result.valid.has(item.id));
  };
  const runPart = async (part: BatchItem[], attempt: number): Promise<void> => {
    if (signal.aborted || !part.length) return;
    let remaining = part;
    let shrink = false;
    let delay = 300 * (attempt + 1);
    let message = "模型响应存在缺失、空译或重复 ID";
    try {
      const response = await call(part);
      if (signal.aborted) return;
      const result = typeof response === "string" ? { content: response, finishReason: null, refusal: null } : response;
      if (result.refusal || result.finishReason === "content_filter") {
        fail(part, "模型拒绝了本批翻译，未自动重试"); return;
      }
      remaining = apply(part, result.content);
      shrink = true;
      if (result.finishReason === "length") message = "模型输出被截断";
    } catch (error) {
      if (signal.aborted) return;
      const llm = error instanceof LlmError ? error : undefined;
      message = error instanceof Error ? error.message : String(error);
      if (llm?.code === "refusal") { fail(part, message); return; }
      if (llm?.code === "invalid-config" || (llm && llm.code !== "budget" && llm.status >= 400 && llm.status < 500 && llm.status !== 429 && llm.status !== 408)) {
        fail(part, message); stop(message); return;
      }
      shrink = llm?.code === "budget" || llm?.code === "truncated" || llm?.code === "reasoning-budget" || llm?.code === "no-content" || llm?.code === "bad-json";
      if (llm?.code === "truncated" && llm.partialResult?.content) remaining = apply(part, llm.partialResult.content);
      if (!shrink) delay = Math.min(15000, 500 * 2 ** attempt) + Math.random() * 300;
      if (llm?.status === 429) {
        concurrency = Math.max(1, Math.floor(concurrency / 2));
        delay = Math.max(delay, llm.retryAfterMs ?? 0);
        cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
      }
    }
    if (!remaining.length || signal.aborted) return;
    if (attempt >= maxRetries) { fail(remaining, message); return; }
    await sleep(delay, signal).catch(() => undefined);
    if (signal.aborted) return;
    const parts = shrink ? consecutive(remaining).flatMap(group => chunkByBudget(group, Math.max(1, Math.ceil(remaining.length / 2)), 0, () => 0)) : [remaining];
    for (const retry of parts) await runPart(retry, attempt + 1);
  };
  emit();
  let next = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (!signal.aborted) {
        const batch = batches[next++];
        if (!batch) return;
        await runPart(batch.map(e => ({ id: e.id, text: e.originalText })), 0);
        if (!signal.aborted) { completedBatches++; emit(); }
      }
    }));
  } finally {
    callbacks.signal?.removeEventListener("abort", abort);
    signal.removeEventListener("abort", wake);
  }
  const failedIds = [...failed].sort((a, b) => a - b);
  const unprocessedIds = pending.filter(e => !e.translatedText?.trim() && !failed.has(e.id)).map(e => e.id);
  return { failedIds, unprocessedIds, cancelled: !!callbacks.signal?.aborted, requestCount, terminalError, validation,
    lastError: failedIds.length || terminalError ? lastError : undefined };
}
