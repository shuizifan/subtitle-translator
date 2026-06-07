// ASS 序列化器：公共模型 + meta.ass → ASS 文本。
//
// 无损策略：按原始行走查，只把「命中可翻译条目」的 Dialogue 行替换其文本字段
//（依双语布局重组译文/原文），其余所有行（段头、Styles、Format、Comment、绘图等）原样输出。
//
// 样式默认「忠实保留源字幕」：不加任何字体/字号/颜色，源对白原有样式照旧。
// 仅当 assStyle.forceStyle=true 时才统一覆盖：剥离源对白的内联「装饰类」标签
//（字体/字号/粗斜体/颜色/描边/阴影），保留定位/绘图/卡拉OK 等结构类标签，再套上
// 「译文大、原文小」。字号以占视频高度百分比表达，按 PlayResY 折算为 {\fs}，跨设备一致；
// 源文件未声明 PlayRes 时，仅在强制样式下注入 384×288（与播放器默认画布一致），保证 {\fs} 解释统一。

import type { InlineTag, SubtitleDocument, SubtitleEntry } from "@/core/model";
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

/** 结构类标签（定位/对齐/动画/绘图/卡拉OK/淡入淡出/裁剪等）：强制统一样式时也要保留。 */
function isStructuralTag(raw: string): boolean {
  return /\\(an?\d|pos\s*\(|move\s*\(|org\s*\(|i?clip|fad|fade|t\s*\(|p\d|k[fo]?\d|q\d)/i.test(raw);
}

/** 组装一个 ASS 覆盖块前缀 {\fn..\fs..\c..}（按需，无内容则返回空串）。 */
function inlinePrefix(fontName: string | undefined, fs: number | null, colorHex: string | undefined): string {
  let body = "";
  if (fontName) body += `\\fn${fontName}`;
  if (fs != null) body += `\\fs${fs}`;
  if (colorHex) body += `\\c${hexToAssColor(colorHex)}`;
  return body ? `{${body}}` : "";
}

/** 依布局把单个条目重组为一段 ASS 文本（换行用 \N）。 */
function buildEntryText(
  entry: SubtitleEntry,
  opts: SerializeAssOptions,
  playResY: number,
  style?: StyleConfig,
  assStyle?: AssStyleConfig,
): string {
  const collapseOn = opts.collapseLines !== false;
  const force = assStyle?.forceStyle ?? false;

  // 强制统一样式时，剥离源对白的「装饰类」内联标签（仅保留结构类），让我方样式真正生效。
  const tagsFor = (tags?: InlineTag[]) => (force ? tags?.filter((t) => isStructuralTag(t.raw)) : tags);
  const prep = (t: string) => (collapseOn ? collapse(t) : t);
  const render = (text: string, tags?: InlineTag[]) => prep(reinsertTags(text, tagsFor(tags)));

  const orig = render(entry.originalText, entry.tags);
  const hasTrans = entry.translatedText != null && entry.translatedText !== "";
  const trans = hasTrans ? render(entry.translatedText as string, entry.tags) : "";

  const fontName = force ? assStyle?.fontName || undefined : undefined;
  const transFs = force && assStyle ? pctToAssFs(assStyle.translationPct, playResY) : null;
  const origFs = force && assStyle ? pctToAssFs(assStyle.originalPct, playResY) : null;
  const colorOf = (ls?: LanguageStyle) => (force && style?.enableSrtColor ? ls?.primaryColor : undefined);
  const decorate = (text: string, fs: number | null, ls?: LanguageStyle) =>
    inlinePrefix(fontName, fs, colorOf(ls)) + text;

  let parts: string[];
  if (opts.layout === "translated-only") {
    parts = [decorate(hasTrans ? trans : orig, transFs, style?.translation)];
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
  // 仅在强制统一样式且源文件未声明 PlayRes 时注入 384×288（播放器默认画布），
  // 保证我方 {\fs} 与原有样式在同一基准上渲染、跨播放器一致；保留模式下不改文件结构。
  const inject = !!assStyle?.forceStyle && !meta.playResPresent;

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
      out.push("PlayResX: 384", "PlayResY: 288");
    }
  }
  if (inject && meta.scriptInfoLine < 0) {
    out.unshift("[Script Info]", "PlayResX: 384", "PlayResY: 288", "");
  }

  return out.join(meta.eol);
}
