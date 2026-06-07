// 双语组装逻辑（见规范 §7）。
// 公共模型里每个 cue 同时含原文与译文；布局由序列化器消费的「输出 cue」决定，模型本身不变。

import type { SubtitleDocument } from "@/core/model";
import { reinsertTags } from "@/core/tags";
import { applySrtColor, type StyleConfig } from "@/core/styling";

export type BilingualLayout =
  | "dual-entry" // 布局一：双条目同时间轴（默认，匹配用户参考字幕）
  | "single-entry" // 布局二：单条目双行（更紧凑、顺序确定）
  | "translated-only"; // 仅译文

export type LanguageOrder = "original-first" | "translation-first";

export interface BilingualOptions {
  layout: BilingualLayout;
  order: LanguageOrder;
  /**
   * 合并每种语言内部的换行为一行（默认 true）。
   * 字幕原文常为排版需要被拆成多行，双语叠加后行数翻倍（如原文 3 行 → 双语 6 行）严重影响观看；
   * 合并后每种语言占一行，双语共 2 行，由播放器自行按宽度折行。
   */
  collapseLines?: boolean;
}

/** 把多行文本压成一行：逐行去空白、丢空行，用空格连接。 */
function collapse(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join(" ");
}

/** 序列化器消费的中间产物：一个时间轴 + 一段（可含换行的）文本。 */
export interface OutputCue {
  start: number;
  end: number;
  text: string;
}

/** 仅原文（用于解析—序列化往返一致性测试与「翻译前预览」）。 */
export function originalCues(doc: SubtitleDocument): OutputCue[] {
  return doc.entries.map((e) => ({
    start: e.start,
    end: e.end,
    text: reinsertTags(e.originalText, e.tags),
  }));
}

/** 判断一行主要是 CJK（中日韩）、拉丁字母，还是其它。 */
function lineScript(line: string): "cjk" | "latin" | "other" {
  const cjk = (line.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
  const latin = (line.match(/[A-Za-z]/g) || []).length;
  if (cjk >= 2 && cjk >= latin) return "cjk";
  if (latin >= 2 && latin > cjk) return "latin";
  return "other";
}

/**
 * 粗判字幕是否「已经是双语」（每条对白含中/外两行堆叠）。
 * 用于上传时提示，避免把排好版的双语字幕再翻译一遍、覆盖已有译文。
 */
export function looksAlreadyBilingual(doc: SubtitleDocument): boolean {
  const sample = doc.entries.slice(0, 80);
  if (sample.length === 0) return false;
  let bi = 0;
  for (const e of sample) {
    const lines = e.originalText.split("\n").map((l) => l.trim()).filter(Boolean);
    const scripts = new Set(lines.map(lineScript));
    if (lines.length >= 2 && scripts.has("cjk") && scripts.has("latin")) bi++;
  }
  return bi / sample.length > 0.5;
}

/** 按双语选项组装输出 cue 列表。传入 style 时按 v1 范围套用 SRT 颜色。 */
export function assemble(
  doc: SubtitleDocument,
  opts: BilingualOptions,
  style?: StyleConfig,
): OutputCue[] {
  const out: OutputCue[] = [];
  const collapseOn = opts.collapseLines !== false; // 默认开启
  const prep = (t: string) => (collapseOn ? collapse(t) : t);
  const colorOrig = (t: string) =>
    style ? applySrtColor(t, style.original, style.enableSrtColor) : t;
  const colorTrans = (t: string) =>
    style ? applySrtColor(t, style.translation, style.enableSrtColor) : t;

  for (const e of doc.entries) {
    const orig = colorOrig(prep(reinsertTags(e.originalText, e.tags)));
    const hasTrans = e.translatedText != null && e.translatedText !== "";
    const trans = hasTrans ? colorTrans(prep(reinsertTags(e.translatedText as string, e.tags))) : "";

    if (opts.layout === "translated-only") {
      out.push({ start: e.start, end: e.end, text: hasTrans ? trans : orig });
      continue;
    }

    if (opts.layout === "single-entry") {
      const lines =
        opts.order === "translation-first" ? [trans, orig] : [orig, trans];
      out.push({
        start: e.start,
        end: e.end,
        text: lines.filter((l) => l !== "").join("\n"),
      });
      continue;
    }

    // dual-entry：拆成两条独立条目，共用同一时间轴
    const first = opts.order === "translation-first" ? trans : orig;
    const second = opts.order === "translation-first" ? orig : trans;
    if (first !== "") out.push({ start: e.start, end: e.end, text: first });
    if (second !== "") out.push({ start: e.start, end: e.end, text: second });
  }

  return out;
}
