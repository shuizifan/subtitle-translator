// 未完成任务的本地持久化（见改进建议 #6）。
//
// 设置一直存在 localStorage 里，但「译好的内容」没存——一部 1700 条的片子译到一半
// 误刷新就得从头再来。译文体量大（几万条），localStorage 放不下，用 IndexedDB。
// 只留一份「当前任务」：新文件覆盖旧的，重置时清空。

import type { SubtitleDocument } from "@/core/model";
import type { CleanupMark } from "@/core/cleanup";
import type { GlossaryEntry } from "@/core/glossary";

const DB_NAME = "subtitle-translator";
const STORE = "docs";
const KEY = "current";
const DB_VERSION = 1;

export interface SavedTask {
  fileName: string;
  encoding: string | null;
  document: SubtitleDocument;
  glossary: GlossaryEntry[];
  cleanupMarks: CleanupMark[];
  detectedLang: string | null;
  sourceLang: string;
  targetLang: string;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前环境不支持 IndexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB 操作失败"));
        t.oncomplete = () => db.close();
      }),
  );
}

/** 保存当前任务（失败不抛出：持久化是锦上添花，不该打断翻译）。 */
export async function saveTask(task: SavedTask): Promise<boolean> {
  try {
    await tx("readwrite", (s) => s.put(task, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadTask(): Promise<SavedTask | null> {
  try {
    const v = await tx<SavedTask | undefined>("readonly", (s) => s.get(KEY));
    return v && v.document && Array.isArray(v.document.entries) && v.document.entries.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function clearTask(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } catch {
    /* 忽略 */
  }
}

/** 统计一份存档的完成度，用于恢复提示。 */
export function taskProgress(task: SavedTask): { translated: number; total: number } {
  let translated = 0;
  let total = 0;
  for (const e of task.document.entries) {
    if (e.originalText.trim() === "" || e.excluded) continue;
    total++;
    if (e.translatedText) translated++;
  }
  return { translated, total };
}
