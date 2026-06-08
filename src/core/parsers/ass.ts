// ASS/SSA 解析器：任意 ASS 文本 → 公共模型。
//
// 设计目标：无损往返。除「可翻译的 Dialogue 文本」外，其余一律原样保留——
// [Script Info] / [V4+ Styles] / [Fonts] 等段落、Events 的 Format 行、Comment 行、
// 以及绘图/卡拉OK 这类不该翻译的 Dialogue，都按原始行透传（见序列化器）。
//
// 因此 meta.ass 只需存：原始行数组 + Text 列下标 + 「行号 → 可翻译条目 id」映射。
// 序列化时按行走查，仅把映射命中的行替换文本字段，其余 verbatim。

import type { InlineTag, ParseIssue, SubtitleDocument, SubtitleEntry } from "@/core/model";
import { assTimecodeToMs } from "@/core/time";

export interface AssMeta {
  eol: "\r\n" | "\n";
  /** 原始文件按行拆分（不含换行符），用于无损重建。 */
  lines: string[];
  /** Events 段 Format 行里 Text 列的下标（Text 列后所有逗号都属于文本）。 */
  textIdx: number;
  /** 原始行号（0-based）→ 可翻译条目 id。 */
  lineToEntry: Record<number, number>;
  /** 画面宽/高（解析得到或按 16:9 推导；两者皆缺则 384×288，与播放器默认一致）。 */
  playResX: number;
  playResY: number;
  /** 原文件是否已分别声明 PlayResX / PlayResY（注入时只补缺失的一个，避免重复冲突）。 */
  playResXPresent: boolean;
  playResYPresent: boolean;
  /** [Script Info] 段头所在行（-1＝无该段），注入 PlayRes 时用。 */
  scriptInfoLine: number;
}

export interface ParseAssResult {
  document: SubtitleDocument;
  issues: ParseIssue[];
}

/** ASS 文本里需保护/转换的记号：{...} 覆盖块、\N \n 换行、\h 硬空格。 */
const ASS_TOKEN = /\{[^}]*\}|\\N|\\n|\\h/g;

/** 抽离 ASS 行文本中的覆盖标签，并把换行/硬空格转成纯文本，便于翻译与回填。 */
export function extractAssText(text: string): { plain: string; tags: InlineTag[] } {
  const tags: InlineTag[] = [];
  let plain = "";
  let last = 0;
  ASS_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ASS_TOKEN.exec(text)) !== null) {
    plain += text.slice(last, m.index);
    const tok = m[0];
    if (tok === "\\N" || tok === "\\n") {
      plain += "\n"; // 换行统一为 \n，序列化时还原为 \N
    } else if (tok === "\\h") {
      plain += " "; // 硬空格降级为普通空格（MVP 取舍）
    } else {
      tags.push({ raw: tok, offset: plain.length }); // {...} 覆盖块原样保护
    }
    last = m.index + tok.length;
  }
  plain += text.slice(last);
  return { plain, tags };
}

/** 含绘图（\p1+）或卡拉OK（\k/\K 计时）的行不应翻译，原样保留。 */
function isNonTranslatable(rawText: string): boolean {
  if (/\\p[1-9]/.test(rawText)) return true; // 矢量绘图坐标，非文字
  if (/\\[kK][fo]?\d/.test(rawText)) return true; // 卡拉OK 音节计时
  return false;
}

/** 把 Dialogue/Comment 冒号后的内容拆成「前 textIdx 个字段 + 末尾文本」。 */
function splitEventFields(rest: string, textIdx: number): { fields: string[]; text: string } {
  const fields: string[] = [];
  let cur = "";
  let count = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "," && count < textIdx) {
      fields.push(cur);
      cur = "";
      count++;
      if (count === textIdx) return { fields, text: rest.slice(i + 1) };
    } else {
      cur += rest[i];
    }
  }
  fields.push(cur);
  return { fields, text: "" };
}

export function parseAss(text: string, taskId: string): ParseAssResult {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const issues: ParseIssue[] = [];
  const entries: SubtitleEntry[] = [];
  const lineToEntry: Record<number, number> = {};

  let section = "";
  let format: string[] | null = null;
  let textIdx = -1;
  let startIdx = -1;
  let endIdx = -1;
  let id = 1;
  let playResX: number | null = null;
  let playResY: number | null = null;
  let scriptInfoLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const header = /^\s*\[(.+?)\]\s*$/.exec(line);
    if (header) {
      section = header[1].trim().toLowerCase();
      if (section === "script info") scriptInfoLine = i;
      continue;
    }
    if (section === "script info") {
      const rx = /^\s*PlayResX\s*:\s*(\d+)/i.exec(line);
      if (rx) playResX = parseInt(rx[1], 10);
      const ry = /^\s*PlayResY\s*:\s*(\d+)/i.exec(line);
      if (ry) playResY = parseInt(ry[1], 10);
      continue;
    }
    if (section !== "events") continue;

    const fm = /^\s*Format:\s*(.*)$/i.exec(line);
    if (fm) {
      format = fm[1].split(",").map((s) => s.trim());
      const lower = format.map((c) => c.toLowerCase());
      textIdx = lower.indexOf("text");
      if (textIdx < 0) textIdx = format.length - 1; // 容错：Text 通常是最后一列
      startIdx = lower.indexOf("start");
      endIdx = lower.indexOf("end");
      continue;
    }

    const ev = /^\s*(Dialogue|Comment):\s?(.*)$/i.exec(line);
    if (!ev || !format) continue;
    if (ev[1].toLowerCase() !== "dialogue") continue; // Comment 行透传，不翻译

    const { fields, text: rawText } = splitEventFields(ev[2], textIdx);
    if (isNonTranslatable(rawText)) continue; // 绘图/卡拉OK 透传

    const { plain, tags } = extractAssText(rawText);
    if (plain.trim() === "") continue; // 纯标签/空文本，无可译内容

    const start = startIdx >= 0 ? assTimecodeToMs(fields[startIdx] ?? "") : 0;
    const end = endIdx >= 0 ? assTimecodeToMs(fields[endIdx] ?? "") : 0;
    entries.push({ id, start, end, originalText: plain, tags });
    lineToEntry[i] = id;
    id++;
  }

  if (entries.length === 0) {
    throw new Error("ASS 解析失败：未找到可翻译的对白行（Dialogue），请确认文件含 [Events] 段");
  }

  const playResXPresent = playResX != null;
  const playResYPresent = playResY != null;
  // 未声明 PlayRes 时，播放器（VSFilter/libass）默认按 384×288 渲染——
  // 必须用 288 作折算基准，否则按 1080 会把原有样式缩到约 1/4（曾导致样式崩坏）。
  // 只声明其一时，按 16:9 推导另一维，避免画布比例错乱。
  let rx = playResX;
  let ry = playResY;
  if (rx == null && ry == null) {
    rx = 384;
    ry = 288;
  } else if (ry == null) {
    ry = Math.round((rx as number) * 9 / 16);
  } else if (rx == null) {
    rx = Math.round((ry as number) * 16 / 9);
  }
  const meta: AssMeta = {
    eol,
    lines,
    textIdx,
    lineToEntry,
    playResX: rx as number,
    playResY: ry as number,
    playResXPresent,
    playResYPresent,
    scriptInfoLine,
  };
  return {
    document: { taskId, sourceFormat: "ass", entries, meta: { eol, ass: meta, parseIssues: issues } },
    issues,
  };
}
