// ASS 序列化器：公共模型 + meta.ass → ASS 文本。
//
// 无损策略：按原始行走查，只把「命中可翻译条目」的 Dialogue 行替换其文本字段
//（依双语布局重组译文/原文），其余所有行（段头、Styles、Format、Comment、绘图等）原样输出。
//
// 双语布局：ASS 下两条同位置 Dialogue 会重叠，故双语统一采用「单条目双行（\N 堆叠）」，
// 仅「仅译文」单独成行；左右/上下分位留待后续按 Style 实现。

import type { SubtitleDocument, SubtitleEntry } from "@/core/model";
import type { AssMeta } from "@/core/parsers/ass";
import { reinsertTags } from "@/core/tags";
import { applyAssColor, type StyleConfig } from "@/core/styling";
import type { LanguageOrder } from "@/core/bilingual";

export type AssLayout = "translated-only" | "stacked";

export interface SerializeAssOptions {
  layout: AssLayout;
  order: LanguageOrder;
  /** 合并每种语言内部换行为一行（默认 true），与 SRT 行为一致。 */
  collapseLines?: boolean;
}

/** 把多行压成一行（逐行去空白、丢空行、空格连接）。 */
function collapse(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join(" ");
}

/** 依布局把单个条目重组为一段 ASS 文本（换行用 \N，可选套主色）。 */
function buildEntryText(entry: SubtitleEntry, opts: SerializeAssOptions, style?: StyleConfig): string {
  const collapseOn = opts.collapseLines !== false;
  const prep = (t: string) => (collapseOn ? collapse(t) : t);

  const orig = prep(reinsertTags(entry.originalText, entry.tags));
  const hasTrans = entry.translatedText != null && entry.translatedText !== "";
  const trans = hasTrans ? prep(reinsertTags(entry.translatedText as string, entry.tags)) : "";

  const colorO = (t: string) => (style ? applyAssColor(t, style.original, style.enableSrtColor) : t);
  const colorT = (t: string) => (style ? applyAssColor(t, style.translation, style.enableSrtColor) : t);

  let parts: string[];
  if (opts.layout === "translated-only") {
    parts = [hasTrans ? colorT(trans) : colorO(orig)];
  } else {
    const O = colorO(orig);
    const T = hasTrans ? colorT(trans) : "";
    parts = opts.order === "translation-first" ? [T, O] : [O, T];
  }
  return parts
    .filter((p) => p !== "")
    .join("\\N")
    .replace(/\n/g, "\\N"); // 残留的内部换行（collapse 关时）也转成 \N
}

/** 用新文本替换一行 Dialogue 的 Text 字段（保留冒号前缀与前置所有字段，无损）。 */
function replaceEventText(line: string, textIdx: number, newText: string): string {
  const colon = line.indexOf(":");
  const head = line.slice(0, colon + 1);
  const after = line.slice(colon + 1);
  let pos = 0;
  let commas = 0;
  for (; pos < after.length && commas < textIdx; pos++) {
    if (after[pos] === ",") commas++;
  }
  return head + after.slice(0, pos) + newText;
}

export function serializeAss(doc: SubtitleDocument, opts: SerializeAssOptions, style?: StyleConfig): string {
  const meta = doc.meta.ass as AssMeta | undefined;
  if (!meta) throw new Error("serializeAss：缺少 meta.ass（请用 parseAss 解析）");

  const byId = new Map(doc.entries.map((e) => [e.id, e]));
  const out = meta.lines.map((line, i) => {
    const eid = meta.lineToEntry[i];
    if (eid == null) return line; // 非可翻译行：原样保留
    const entry = byId.get(eid);
    if (!entry) return line;
    return replaceEventText(line, meta.textIdx, buildEntryText(entry, opts, style));
  });

  return out.join(meta.eol);
}
