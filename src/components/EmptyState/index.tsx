"use client";

import { useRef } from "react";
import { useSubtitleLoaderContext } from "@/lib/SubtitleLoaderContext";

/** 未上传文件前的上传区。点击选择文件；拖拽由整页 GlobalDropzone 统一处理（可拖到页面任意位置）。 */
export function EmptyState() {
  const { loadFile, reloadWithEncoding, error, lowConfidence } = useSubtitleLoaderContext();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-56px)] max-w-2xl flex-col items-center justify-center px-4">
      <input
        ref={fileInput}
        type="file"
        accept=".srt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white px-8 py-20 text-center transition hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-slate-500"
      >
        <div className="mb-4 text-5xl">🎬</div>
        <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">拖拽字幕文件到这里，或点击选择</p>
        <p className="mt-2 text-sm text-slate-400">支持拖到页面任意位置 · .srt · 单文件最大 5 MB · v1 仅处理字幕</p>
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
        无数据库 · 无账号 · 密钥仅存本地浏览器并经转发路由穿透
      </p>
    </div>
  );
}
