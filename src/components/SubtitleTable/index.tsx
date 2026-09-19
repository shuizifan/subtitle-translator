"use client";

import { memo, useCallback, useState, type CSSProperties } from "react";
import { useAppStore } from "@/store";
import { msToSrtTimecode } from "@/core/time";
import { QA_LABEL, type QaCode } from "@/core/qa";
import { useExport } from "@/lib/useExport";

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
  const qaFindings = useAppStore((s) => s.qaFindings);
  const restoreExcluded = useAppStore((s) => s.restoreExcluded);
  const progress = useAppStore((s) => s.progress);
  const translateError = useAppStore((s) => s.translateError);
  const detectedLang = useAppStore((s) => s.detectedLang);
  // 订阅这两份设置，改语言/标签后文件名预览才会跟着刷新
  useAppStore((s) => s.params);
  useAppStore((s) => s.bilingual);
  const { previewName } = useExport();
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
  const qaMap = new Map(qaFindings.map((f) => [f.id, f.codes]));
  const translated = document.entries.filter((e) => e.translatedText).length;
  const excluded = document.entries.filter((e) => e.excluded).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-1 break-all text-xl font-bold text-slate-900 dark:text-slate-100">{fileName}</div>
      <p className="mb-2 text-sm text-slate-400">
        共 {document.entries.length} 行 · 已译 {translated} 行
        {excluded ? ` · 已排除 ${excluded} 行（非台词）` : ""}
        {progress?.failedEntries ? ` · 未翻译 ${progress.failedEntries} 行` : ""}
        {detectedLang && detectedLang !== "auto" ? ` · 判定源语言 ${detectedLang}` : ""}
        ｜ Tips：点击译文一栏即可修改
      </p>

      {/* 导出文件名实时预览：媒体服务器只认扩展名前最后一段语言码，肉眼确认最稳 */}
      <p className="mb-4 break-all font-mono text-xs text-slate-400">
        导出为 <span className="text-slate-500 dark:text-slate-300">{previewName("translated")}</span>
        {" / "}
        <span className="text-slate-500 dark:text-slate-300">{previewName("bilingual")}</span>
      </p>

      {translateError && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/30 dark:text-amber-200">
          有条目未翻译成功，最后一次失败原因：{translateError}
        </div>
      )}

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
              qaCodes={qaMap.get(e.id)}
              excluded={!!e.excluded}
              excludedReason={e.excludedReason}
              onRestore={restoreExcluded}
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
  qaCodes?: QaCode[];
  excluded: boolean;
  excludedReason?: string;
  editing: boolean;
  onStartEdit: (id: number) => void;
  onCommit: (id: number, text: string) => void;
  onRestore: (id: number) => void;
}

const Row = memo(function Row({
  id,
  start,
  end,
  original,
  translated,
  failed,
  qaCodes,
  excluded,
  excludedReason,
  editing,
  onStartEdit,
  onCommit,
  onRestore,
}: RowProps) {
  return (
    <div
      style={ROW_CV}
      className={`grid grid-cols-[56px_96px_96px_1fr_1fr] gap-0 border-b border-slate-100 px-3 py-2 text-sm dark:border-slate-700/60 ${
        excluded
          ? "bg-slate-50 text-slate-400 dark:bg-slate-900/40"
          : "hover:bg-slate-50/60 dark:hover:bg-slate-700/30"
      }`}
    >
      <div className="pt-1 font-mono text-xs text-slate-400">{id}</div>
      <div className="pt-1 font-mono text-xs text-slate-400">{shortTime(start)}</div>
      <div className="pt-1 font-mono text-xs text-slate-400">{shortTime(end)}</div>
      <div className={`whitespace-pre-wrap pr-3 pt-1 ${excluded ? "text-slate-400 line-through decoration-slate-300" : "text-slate-700 dark:text-slate-300"}`}>
        {original}
      </div>
      <div className="pr-1">
        {excluded ? (
          <div className="flex items-start gap-2 pt-1 text-xs text-slate-400">
            <span>已排除（{excludedReason ?? "非台词"}）</span>
            <button className="hover:underline" onClick={() => onRestore(id)}>
              恢复
            </button>
          </div>
        ) : editing ? (
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
            title={qaCodes?.map((c) => QA_LABEL[c]).join("、")}
            className={`min-h-[28px] cursor-text whitespace-pre-wrap rounded-md border px-2 py-1 ${
              failed
                ? "border-red-300 text-red-500 dark:border-red-500/60"
                : qaCodes && qaCodes.length > 0
                  ? "border-amber-400 bg-amber-50/60 text-slate-900 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-slate-100"
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
