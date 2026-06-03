"use client";

import { useState, type ReactNode } from "react";

/** 悬停提示。常用于选项旁的「?」说明（如双轨/单轨布局解释）。 */
export function Tooltip({ content, children }: { content: ReactNode; children?: ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children ?? (
        <span className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-400 text-[10px] font-bold text-slate-500">
          ?
        </span>
      )}
      {show && (
        <span className="absolute left-1/2 top-full z-50 mt-1 w-64 -translate-x-1/2 whitespace-pre-line rounded-lg bg-slate-900 px-3 py-2 text-xs leading-relaxed text-slate-100 shadow-lg">
          {content}
        </span>
      )}
    </span>
  );
}
