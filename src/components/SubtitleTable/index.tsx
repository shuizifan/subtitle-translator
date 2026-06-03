"use client";

import { memo, useCallback, useState, type CSSProperties } from "react";
import { useAppStore } from "@/store";
import { msToSrtTimecode } from "@/core/time";

// content-visibility:auto 让滚动区外的行跳过布局/绘制，2000+ 行也不卡；
// contain-intrinsic-size 给出占位高度，保证滚动条与定位稳定。
const ROW_CV: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 44px",
};

export function SubtitleTable() {
  const document = useAppStore((s) => s.document);
  const fileName = useAppStore((s) => s.fileName);
  const updateTranslation = useAppStore((s) => s.updateTranslation);
  const failedIds = useAppStore((s) => s.failedIds);
  const progress = useAppStore((s) => s.progress);
  useAppStore((s) => s.docVersion); // 翻译过程中增量刷新

  const [editingId, setEditingId] = useState<number | null>(null);

  const onCommit = useCallback(
    (id: number, text: string) => {
      const cur = useAppStore.getState().document?.entries.find((e) => e.id === id);
      if (cur && (cur.translatedText ?? "") !== text) updateTranslation(id, text);
      setEditingId(null);
    },
    [updateTranslation],
  );
  const onStartEdit = useCallback((id: number) => setEditingId(id), []);

  if (!document) return null;
  const failedSet = new Set(failedIds);
  const translated = document.entries.filter((e) => e.translatedText).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-1 break-all text-xl font-bold text-slate-900 dark:text-slate-100">{fileName}</div>
      <p className="mb-4 text-sm text-slate-400">
        共 {document.entries.length} 行 · 已译 {translated} 行
        {progress?.failedEntries ? ` · 未翻译 ${progress.failedEntries} 行` : ""}
        ｜ Tips：点击译文一栏即可修改
      </p>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="grid grid-cols-[56px_96px_96px_1fr_1fr] gap-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
          <div>序号</div>
          <div>开始时间</div>
          <div>结束时间</div>
          <div>原文</div>
          <div>译文（可编辑）</div>
        </div>
        <div>
          {document.entries.map((e) => (
            <Row
              key={e.id}
              id={e.id}
              start={e.start}
              end={e.end}
              original={e.originalText}
              translated={e.translatedText ?? ""}
              failed={failedSet.has(e.id)}
              editing={editingId === e.id}
              onStartEdit={onStartEdit}
              onCommit={onCommit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  id: number;
  start: number;
  end: number;
  original: string;
  translated: string;
  failed: boolean;
  editing: boolean;
  onStartEdit: (id: number) => void;
  onCommit: (id: number, text: string) => void;
}

const Row = memo(function Row({ id, start, end, original, translated, failed, editing, onStartEdit, onCommit }: RowProps) {
  return (
    <div
      style={ROW_CV}
      className="grid grid-cols-[56px_96px_96px_1fr_1fr] gap-0 border-b border-slate-100 px-3 py-2 text-sm hover:bg-slate-50/60 dark:border-slate-700/60 dark:hover:bg-slate-700/30"
    >
      <div className="pt-1 font-mono text-xs text-slate-400">{id}</div>
      <div className="pt-1 font-mono text-xs text-slate-400">{shortTime(start)}</div>
      <div className="pt-1 font-mono text-xs text-slate-400">{shortTime(end)}</div>
      <div className="whitespace-pre-wrap pr-3 pt-1 text-slate-700 dark:text-slate-300">{original}</div>
      <div className="pr-1">
        {editing ? (
          <textarea
            autoFocus
            defaultValue={translated}
            rows={Math.max(1, translated.split("\n").length)}
            onBlur={(ev) => onCommit(id, ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) (ev.target as HTMLTextAreaElement).blur();
              if (ev.key === "Escape") (ev.target as HTMLTextAreaElement).blur();
            }}
            className="w-full resize-y rounded-md border border-slate-900 bg-white px-2 py-1 text-slate-900 outline-none dark:border-slate-300 dark:bg-slate-900 dark:text-slate-100"
          />
        ) : (
          <div
            onClick={() => onStartEdit(id)}
            className={`min-h-[28px] cursor-text whitespace-pre-wrap rounded-md border px-2 py-1 ${
              failed
                ? "border-red-300 text-red-500 dark:border-red-500/60"
                : "border-transparent text-slate-900 hover:border-slate-200 dark:text-slate-100 dark:hover:border-slate-600"
            }`}
          >
            {translated || <span className="text-slate-300 dark:text-slate-600">{failed ? "未翻译（点击填写）" : "—"}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

function shortTime(ms: number): string {
  return msToSrtTimecode(ms).split(",")[0]; // HH:MM:SS
}
