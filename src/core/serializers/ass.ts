// ASS 序列化器：公共模型 + meta.ass → ASS 文本。
//
// 无损策略：按原始行走查，只把「命中可翻译条目」的 Dialogue 行替换其文本字段
//（依双语布局重组译文/原文），其余所有行（段头、Styles、Format、Comment、绘图等）原样输出。
//
// 双语布局：ASS 下两条同位置 Dialogue 会重叠，故双语统一采用「单条目双行（\N 堆叠）」，
// 仅「仅译文」单独成行；左右/上下分位留待后续按 Style 实现。
//
// 字号：以「占视频高度的百分比」表达，按脚本 PlayResY 折算为 ASS 的 {\fs}。
// ASS 渲染时字号随视频分辨率等比缩放，故同一文件在手机/电脑上相对画面大小一致。
// 若原文件未声明 PlayResX/Y，则注入 1920×1080，保证各播放器对 {\fs} 解释一致。

import type { SubtitleDocument, SubtitleEntry } from "@/core/model";
import type { AssMeta } from "@/core/parsers/ass";
import { reinsertTags } from "@/core/tags";
import { hexToAssColor, pctToAssFs, type AssStyleConfig, type LanguageStyle, type StyleConfig } from "@/core/styling";
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

/** 组装一个 ASS 覆盖块前缀 {\fn..\fs..\c..}（按需，无内容则返回空串）。 */
function inlinePrefix(fontName: string | undefined, fs: number | null, colorHex: string | undefined): string {
  let body = "";
  if (fontName) body += `\\fn${fontName}`;
  if (fs != null) body += `\\fs${fs}`;
  if (colorHex) body += `\\c${hexToAssColor(colorHex)}`;
  return body ? `{${body}}` : "";
}

/** 依布局把单个条目重组为一段 ASS 文本（换行用 \N，按需套字体/字号/主色）。 */
function buildEntryText(
  entry: SubtitleEntry,
  opts: SerializeAssOptions,
  playResY: number,
  style?: StyleConfig,
  assStyle?: AssStyleConfig,
): string {
  const collapseOn = opts.collapseLines !== false;
  const prep = (t: string) => (collapseOn ? collapse(t) : t);

  const orig = prep(reinsertTags(entry.originalText, entry.tags));
  const hasTrans = entry.translatedText != null && entry.translatedText !== "";
  const trans = hasTrans ? prep(reinsertTags(entry.translatedText as string, entry.tags)) : "";

  const resize = assStyle?.resizeEnabled ?? false;
  const fontName = assStyle?.fontName || undefined;
  const transFs = resize && assStyle ? pctToAssFs(assStyle.translationPct, playResY) : null;
  const origFs = resize && assStyle ? pctToAssFs(assStyle.originalPct, playResY) : null;
  const colorOf = (ls?: LanguageStyle) => (style?.enableSrtColor ? ls?.primaryColor : undefined);

  const decorate = (text: string, fs: number | null, ls?: LanguageStyle) =>
    inlinePrefix(fontName, fs, colorOf(ls)) + text;

  let parts: string[];
  if (opts.layout === "translated-only") {
    parts = hasTrans
      ? [decorate(trans, transFs, style?.translation)]
      : [decorate(orig, transFs, style?.translation)]; // 无译文时退化为原文，仍用译文档位
  } else {
    const O = decorate(orig, origFs, style?.original);
    const T = hasTrans ? decorate(trans, transFs, style?.translation) : "";
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

export function serializeAss(
  doc: SubtitleDocument,
  opts: SerializeAssOptions,
  style?: StyleConfig,
  assStyle?: AssStyleConfig,
): string {
  const meta = doc.meta.ass as AssMeta | undefined;
  if (!meta) throw new Error("serializeAss：缺少 meta.ass（请用 parseAss 解析）");

  const byId = new Map(doc.entries.map((e) => [e.id, e]));
  // 应用字号且原文件未声明 PlayRes 时，注入标准 1920×1080，保证 {\fs} 跨播放器一致。
  const inject = !!assStyle?.resizeEnabled && !meta.playResPresent;

  const out: string[] = [];
  for (let i = 0; i < meta.lines.length; i++) {
    const line = meta.lines[i];
    const eid = meta.lineToEntry[i];
    if (eid != null) {
      const entry = byId.get(eid);
      out.push(entry ? replaceEventText(line, meta.textIdx, buildEntryText(entry, opts, meta.playResY, style, assStyle)) : line);
    } else {
      out.push(line);
    }
    if (inject && i === meta.scriptInfoLine) {
      out.push("PlayResX: 1920", "PlayResY: 1080");
    }
  }
  // 没有 [Script Info] 段却需注入：在文件最前面补一段。
  if (inject && meta.scriptInfoLine < 0) {
    out.unshift("[Script Info]", "PlayResX: 1920", "PlayResY: 1080", "");
  }

  return out.join(meta.eol);
}
