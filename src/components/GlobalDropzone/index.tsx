"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDropzone } from "react-dropzone";
import { useAppStore } from "@/store";
import { useSubtitleLoaderContext } from "@/lib/SubtitleLoaderContext";

/**
 * 整页拖拽层：把字幕文件拖到页面任意位置即可上传。
 * - 尚未载入文件时：直接加载（错误由上传区 EmptyState 内联展示）。
 * - 已有文件时：弹窗确认后再替换，避免误覆盖当前进度。
 */
export function GlobalDropzone({ children }: { children: ReactNode }) {
  const hasDoc = useAppStore((s) => s.document != null);
  const fileName = useAppStore((s) => s.fileName);
  const { loadFile, MAX_SIZE } = useSubtitleLoaderContext();

  const [pending, setPending] = useState<File | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  const validate = (file: File): string | null => {
    if (!/\.srt$/i.test(file.name)) return "文件类型不支持，目前仅支持 .srt（后续将支持 .ass/.vtt/.lrc）";
    if (file.size > MAX_SIZE) return `文件超过 ${MAX_SIZE / 1024 / 1024} MB 上限`;
    return null;
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => {
      const file = files[0];
      if (!file) return;
      setDropError(null);
      if (hasDoc) {
        const err = validate(file);
        if (err) {
          setDropError(err);
          return;
        }
        setPending(file);
      } else {
        loadFile(file);
      }
    },
    noClick: true,
    noKeyboard: true,
    multiple: false,
  });

  // 错误提示数秒后自动消失
  useEffect(() => {
    if (!dropError) return;
    const t = setTimeout(() => setDropError(null), 4000);
    return () => clearTimeout(t);
  }, [dropError]);

  // 确认弹窗支持 Esc 取消
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPending(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending]);

  const confirmReplace = () => {
    if (pending) loadFile(pending);
    setPending(null);
  };

  return (
    <div {...getRootProps()} className="min-h-screen">
      <input {...getInputProps()} />
      {children}

      {/* 拖拽悬浮提示，覆盖整页 */}
      {isDragActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-white/80 bg-white/10 px-12 py-16 text-center">
            <div className="mb-4 text-6xl">🎬</div>
            <p className="text-xl font-semibold text-white">
              {hasDoc ? "松开以替换当前字幕文件" : "松开以上传字幕文件"}
            </p>
          </div>
        </div>
      )}

      {/* 非法文件提示 */}
      {dropError && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700 shadow-lg dark:border-red-500/40 dark:bg-red-950 dark:text-red-300">
          {dropError}
        </div>
      )}

      {/* 替换确认弹窗 */}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPending(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">替换当前字幕文件？</h2>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              将用 <span className="font-medium text-slate-900 dark:text-slate-100">{pending.name}</span> 替换
              {fileName ? (
                <>
                  当前的 <span className="font-medium text-slate-900 dark:text-slate-100">{fileName}</span>
                </>
              ) : (
                "当前文件"
              )}
              。当前的翻译结果将被清空，此操作不可撤销。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setPending(null)}>
                取消
              </button>
              <button className="btn-primary" onClick={confirmReplace}>
                替换
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
