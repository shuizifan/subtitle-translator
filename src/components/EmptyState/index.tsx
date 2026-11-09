"use client";

import { useRef } from "react";
import { useSubtitleLoaderContext } from "@/lib/SubtitleLoaderContext";
import { useFileIntake } from "@/lib/useFileIntake";

/** 未上传文件前的上传区。点击选择文件；拖拽由整页 GlobalDropzone 统一处理（可拖到页面任意位置）。 */
export function EmptyState() {
  const { reloadWithEncoding, error, lowConfidence } = useSubtitleLoaderContext();
  const { accept } = useFileIntake();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-var(--toolbar-height))] max-w-2xl flex-col items-center justify-center px-4">
      <input
        ref={fileInput}
        type="file"
        accept=".srt,.ass,.ssa,.vtt,.lrc"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void accept(files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white px-5 py-14 sm:px-8 sm:py-20 text-center transition hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-slate-500"
      >
        <svg aria-hidden="true" className="mb-5 h-12 w-12 text-teal-600" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="9" width="34" height="28" rx="5"/><path d="M14 21h20M14 28h9m5 0h6M18 41h12"/></svg>
        <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">拖入字幕，开始翻译</p>
        <p className="mt-2 text-sm text-slate-400">
          点击选择文件 · 支持 SRT / ASS / VTT / LRC
        </p>
        <p className="mt-1 text-sm text-slate-400">可批量拖入文件或文件夹，单文件最大 20 MB</p>
      </button>

      {lowConfidence && (
        <div className="mt-4 w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <span className="mr-2">编码探测置信度低，若乱码请手动选择编码：</span>
          <select className="input inline-block w-auto" onChange={(e) => reloadWithEncoding(e.target.value)}>
            {["auto", "utf-8", "gbk", "gb18030", "big5", "shift_jis", "utf-16le", "utf-16be"].map((enc) => (
              <option key={enc} value={enc}>
                {enc}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="mt-4 w-full rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <p className="mt-8 text-center text-xs text-slate-400">
        字幕与译文仅保留在当前页面，请及时导出。
      </p>
    </div>
  );
}
