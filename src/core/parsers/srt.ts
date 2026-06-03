// SRT 解析器（见规范 §5）：任意 SRT 文本 → 公共模型。
// 容错：多余空行、序号跳号/缺失、最后一条无空行结尾、\r\n 与 \n 混用、时间码用 . 或 ,。

import type { ParseIssue, SubtitleDocument, SubtitleEntry } from "@/core/model";
import { extractTags } from "@/core/tags";
import { timecodeToMs } from "@/core/time";

const TIMECODE_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

export interface ParseSrtResult {
  document: SubtitleDocument;
  issues: ParseIssue[];
}

/** 探测原文件主要换行符，用于无损往返导出。 */
function detectEol(raw: string): "\r\n" | "\n" {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

export function parseSrt(text: string, taskId: string): ParseSrtResult {
  const eol = detectEol(text);
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const entries: SubtitleEntry[] = [];
  const issues: ParseIssue[] = [];
  let id = 1;
  let i = 0;

  while (i < lines.length) {
    // 跳过空行
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;

    const blockStartLine = i; // 0-based

    // 可选的纯数字序号行（容错：缺序号也能解析）
    if (/^\d+\s*$/.test(lines[i])) i++;

    // 时间码行
    if (i >= lines.length) break;
    const tcLine = lines[i];
    const m = TIMECODE_RE.exec(tcLine);
    if (!m) {
      issues.push({
        line: i + 1,
        raw: tcLine,
        message: "无法识别的时间轴行，已跳过该条目",
      });
      // 跳到下一个空行，避免把后续文本当时间码
      while (i < lines.length && lines[i].trim() !== "") i++;
      continue;
    }
    i++;

    const start = timecodeToMs(m[1], m[2], m[3], m[4]);
    const end = timecodeToMs(m[5], m[6], m[7], m[8]);

    // 文本行：直到空行或文件末尾
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i]);
      i++;
    }

    if (textLines.length === 0) {
      issues.push({
        line: blockStartLine + 1,
        raw: tcLine,
        message: "该时间轴下无文本内容",
      });
    }

    const rawText = textLines.join("\n");
    const { plain, tags } = extractTags(rawText);
    entries.push({ id: id++, start, end, originalText: plain, tags });
  }

  if (entries.length === 0) {
    throw new Error(
      issues.length > 0
        ? `SRT 解析失败：未解析出任何字幕条目（首个问题在第 ${issues[0].line} 行）`
        : "SRT 解析失败：文件为空或非有效 SRT 格式",
    );
  }

  return {
    document: {
      taskId,
      sourceFormat: "srt",
      entries,
      meta: { eol, parseIssues: issues },
    },
    issues,
  };
}
