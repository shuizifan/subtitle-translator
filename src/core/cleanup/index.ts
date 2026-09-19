// 源字幕清理（见改进建议 #5b）。
//
// 字幕文件里混着非台词内容：压制组问候语、字幕站水印、音符 ♪ 丢失后留下的 "**"、
// 用半角 ? 冒充 ♪ 的歌词、整片包着超大字号的 <font> 标签。原样送去翻译既花钱，
// 译文里还会多出垃圾条目。这里只做「识别 + 给出处理建议」，是否采纳由用户在预览里确认。

import type { SubtitleDocument } from "@/core/model";

export interface CleanupOptions {
  /** 压制组问候语 / 字幕站水印 */
  removeWatermarks: boolean;
  /** 纯符号占位条（"**"、"*"） */
  removeSymbolOnly: boolean;
  /** 半角 ? 冒充音符 ♪ 的歌词行 */
  fixMusicNotes: boolean;
  /** 剥离 <font> 字体/字号样式（size=68 这类在播放器里是超大字号） */
  stripFontTags: boolean;
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  removeWatermarks: true,
  removeSymbolOnly: true,
  fixMusicNotes: true,
  stripFontTags: false,
};

export type CleanupAction = "drop" | "rewrite" | "strip-tags";

export interface CleanupMark {
  id: number;
  action: CleanupAction;
  reason: string;
  before: string;
  /** action=rewrite 时的新文本 */
  after?: string;
}

/** 一眼就是水印的特征：域名、邮箱、常见字幕站/压制组名号。 */
const WATERMARK_HARD: RegExp[] = [
  /https?:\/\//i,
  /\bwww\.[\w-]+\.\w+/i,
  /[\w.+-]+@[\w-]+\.\w{2,}/i,
  /opensubtitles|subscene|addic7ed|podnapisi|yify|yts\.|rarbg|subhd|zmk\.pw|zimuzu|人人影视|射手网|伪射手/i,
];

/** 像片头片尾署名的特征：只在文件首尾若干条里才当作水印处理。 */
const WATERMARK_SOFT: RegExp[] = [
  /\bgreet(z|ings) to\b/i,
  /\bsync(ed|hroniz(ed|ation))?\s+(by|and corrected by)\b/i,
  /\bcorrected by\b/i,
  /\bsubtitles?\s+(by|from)\b/i,
  /\b(encoded|ripped|uploaded|presented)\s+by\b/i,
  /\bproudly presents\b/i,
  /\blegend killing\b/i,
  /\bRG'?s\b/,
  /(字幕|翻译|校对|时间轴|压制|片源)\s*[:：]/,
];

/** 片首/片尾各多少条属于「署名区」。 */
const EDGE = 5;

function isSymbolOnly(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  return t !== "" && /^[*#_~^=+|]+$/.test(t);
}

/** 行首用半角 ? 冒充音符（"? Somewhere over the rainbow ?"）。 */
function musicNoteSuspect(line: string): boolean {
  return /^\s*[?？]\s+\S/.test(line);
}

function fixMusicLine(line: string): string {
  return line
    .replace(/^(\s*)[?？](?=\s)/, "$1♪")
    .replace(/(\s)[?？](\s*)$/, "$1♪$2");
}

/** 扫描整篇，给出建议的清理动作；不修改文档。 */
export function analyzeCleanup(doc: SubtitleDocument, opts: CleanupOptions): CleanupMark[] {
  const marks: CleanupMark[] = [];
  const n = doc.entries.length;

  // 音符修复需要全片证据：文件里本来就有真音符，或行首 ? 出现了好几次，
  // 才能排除「法语问号前留空格」之类的正常写法。
  let realNotes = 0;
  let suspects = 0;
  for (const e of doc.entries) {
    if (e.originalText.includes("♪") || e.originalText.includes("♫")) realNotes++;
    if (e.originalText.split("\n").some(musicNoteSuspect)) suspects++;
  }
  const fixNotes = opts.fixMusicNotes && (suspects >= 3 || (realNotes > 0 && suspects > 0));

  for (let i = 0; i < n; i++) {
    const e = doc.entries[i];
    const text = e.originalText;
    const atEdge = i < EDGE || i >= n - EDGE;

    if (opts.removeWatermarks && text.trim() !== "") {
      const hard = WATERMARK_HARD.find((re) => re.test(text));
      const soft = atEdge ? WATERMARK_SOFT.find((re) => re.test(text)) : undefined;
      if (hard || soft) {
        marks.push({ id: e.id, action: "drop", reason: "疑似压制组/字幕站署名", before: text });
        continue;
      }
    }

    if (opts.removeSymbolOnly && isSymbolOnly(text)) {
      marks.push({ id: e.id, action: "drop", reason: "纯符号占位条", before: text });
      continue;
    }

    if (fixNotes && text.split("\n").some(musicNoteSuspect)) {
      const after = text.split("\n").map(fixMusicLine).join("\n");
      if (after !== text) {
        marks.push({ id: e.id, action: "rewrite", reason: "半角 ? 还原为音符 ♪", before: text, after });
        continue;
      }
    }

    if (opts.stripFontTags && e.tags?.some((t) => /^<\/?font/i.test(t.raw))) {
      marks.push({ id: e.id, action: "strip-tags", reason: "剥离 <font> 字体/字号", before: text });
    }
  }

  return marks;
}

/**
 * 把清理动作作用到文档上（就地修改）。
 * drop 只是把条目标记为 excluded：它仍留在预览表里（标灰可见），但不翻译、不导出。
 */
export function applyCleanup(doc: SubtitleDocument, marks: CleanupMark[]): void {
  const byId = new Map(doc.entries.map((e) => [e.id, e]));
  for (const m of marks) {
    const e = byId.get(m.id);
    if (!e) continue;
    if (m.action === "drop") {
      e.excluded = true;
      e.excludedReason = m.reason;
    } else if (m.action === "rewrite" && m.after != null) {
      e.originalText = m.after;
    } else if (m.action === "strip-tags") {
      e.tags = (e.tags ?? []).filter((t) => !/^<\/?font/i.test(t.raw));
    }
  }
}
