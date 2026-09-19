// LRC 歌词解析器：任意 .lrc 文本 → 公共模型。
//
// LRC 只有开始时间，没有结束时间：一行的结束取下一行的开始（末行给 4 秒）。
// 一行可以挂多个时间标签（[00:12.00][01:20.00] 同一句副歌），按多条展开。
// [ar:][ti:][by:] 这类元数据行丢弃。导出统一走 SRT。

import type { ParseIssue, SubtitleDocument, SubtitleEntry } from "@/core/model";
import { extractTags } from "@/core/tags";

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[[a-zA-Z#]+:[^\]]*\]$/;

/** 末行（无后继）默认显示时长。 */
const TAIL_MS = 4000;

export interface ParseLrcResult {
  document: SubtitleDocument;
  issues: ParseIssue[];
}

export function parseLrc(text: string, taskId: string): ParseLrcResult {
  const eol: "\r\n" | "\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const issues: ParseIssue[] = [];
  const rows: { start: number; text: string }[] = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    if (META_TAG.test(trimmed)) return; // [ar:周杰伦] 之类的元数据

    TIME_TAG.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = TIME_TAG.exec(trimmed)) !== null) {
      if (m.index !== lastEnd) break; // 时间标签只认行首连续的一串
      const frac = m[3] ?? "0";
      const fracMs = frac.length === 3 ? parseInt(frac, 10) : parseInt(frac, 10) * 10;
      stamps.push(parseInt(m[1], 10) * 60_000 + parseInt(m[2], 10) * 1_000 + fracMs);
      lastEnd = m.index + m[0].length;
    }
    if (stamps.length === 0) {
      issues.push({ line: idx + 1, raw: line, message: "没有时间标签的行，已跳过" });
      return;
    }
    const body = trimmed.slice(lastEnd).trim();
    for (const s of stamps) rows.push({ start: s, text: body });
  });

  rows.sort((a, b) => a.start - b.start);

  const entries: SubtitleEntry[] = [];
  let id = 1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].text === "") continue; // 空行常用来标记上一句的结束
    const next = rows.slice(i + 1).find((r) => r.start > rows[i].start);
    const end = next ? next.start : rows[i].start + TAIL_MS;
    const { plain, tags } = extractTags(rows[i].text);
    entries.push({ id: id++, start: rows[i].start, end, originalText: plain, tags });
  }

  if (entries.length === 0) {
    throw new Error("LRC 解析失败：没有解析出任何带时间标签的歌词行");
  }

  return {
    document: { taskId, sourceFormat: "lrc", entries, meta: { eol, parseIssues: issues } },
    issues,
  };
}
