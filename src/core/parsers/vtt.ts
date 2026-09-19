// WebVTT 解析器：任意 .vtt 文本 → 公共模型。
//
// 与 SRT 的差别：文件头 WEBVTT、时间码用 . 分隔且小时位可省略、cue 前可有标识行、
// 时间码后可跟布局设置（line:/align: 等）、还有 NOTE / STYLE / REGION 段落。
// 这些结构信息对翻译没有意义，解析时丢弃；导出统一走 SRT（媒体服务器兼容性最好）。

import type { ParseIssue, SubtitleDocument, SubtitleEntry } from "@/core/model";
import { extractTags } from "@/core/tags";

const TIMECODE_RE =
  /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

export interface ParseVttResult {
  document: SubtitleDocument;
  issues: ParseIssue[];
}

function toMs(h: string | undefined, m: string, s: string, ms: string): number {
  return (
    parseInt(h ?? "0", 10) * 3_600_000 +
    parseInt(m, 10) * 60_000 +
    parseInt(s, 10) * 1_000 +
    parseInt((ms + "000").slice(0, 3), 10)
  );
}

export function parseVtt(text: string, taskId: string): ParseVttResult {
  const eol: "\r\n" | "\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const entries: SubtitleEntry[] = [];
  const issues: ParseIssue[] = [];
  let id = 1;
  let i = 0;

  // 文件头（WEBVTT[ - 描述]）
  if (lines[0]?.replace(/^﻿/, "").startsWith("WEBVTT")) i = 1;

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;

    // NOTE / STYLE / REGION 段：整段跳过
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[i].trim())) {
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }

    // 可选的 cue 标识行（不含 -->）
    if (!TIMECODE_RE.test(lines[i]) && i + 1 < lines.length && TIMECODE_RE.test(lines[i + 1])) i++;

    const tcLine = lines[i];
    const m = TIMECODE_RE.exec(tcLine);
    if (!m) {
      issues.push({ line: i + 1, raw: tcLine, message: "无法识别的时间轴行，已跳过该条目" });
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }
    i++;

    const start = toMs(m[1], m[2], m[3], m[4]);
    const end = toMs(m[5], m[6], m[7], m[8]);

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i]);
      i++;
    }
    if (textLines.length === 0) {
      issues.push({ line: i, raw: tcLine, message: "该时间轴下无文本内容" });
    }

    const { plain, tags } = extractTags(textLines.join("\n"));
    entries.push({ id: id++, start, end, originalText: plain, tags });
  }

  if (entries.length === 0) {
    throw new Error(
      issues.length > 0
        ? `VTT 解析失败：未解析出任何字幕条目（首个问题在第 ${issues[0].line} 行）`
        : "VTT 解析失败：文件为空或非有效 WebVTT 格式",
    );
  }

  return {
    document: { taskId, sourceFormat: "vtt", entries, meta: { eol, parseIssues: issues } },
    issues,
  };
}
