// 导出文件名规则（见规范 §8）：媒体服务器靠文件名后缀识别字幕语言。
//
// 默认方案（用户约定）：
//   仅译文：  {基础名}.AI{目标语言名词}.{语言码}.srt        如 movie.AI中文.chs.srt
//   双语：    {基础名}.AI{目标字}{源字}双语.{语言码}.srt     如 movie.AI中英双语.chs.srt
// 「基础名」取原文件名去掉扩展名与已有的语言/类型尾标。

export type ExportType = "bilingual" | "translated";

/** 目标语言 → 名词（用于「仅译文」描述，如 中文/英文）。 */
const LANG_NOUN: Record<string, string> = {
  "Simplified Chinese": "中文",
  "Traditional Chinese": "繁体中文",
  Chinese: "中文",
  English: "英文",
  Japanese: "日文",
  Korean: "韩文",
  German: "德文",
  French: "法文",
  Spanish: "西班牙文",
  Russian: "俄文",
};

/** 语言 → 单字（用于「双语」描述，如 中英）。 */
const LANG_CHAR: Record<string, string> = {
  "Simplified Chinese": "中",
  "Traditional Chinese": "中",
  Chinese: "中",
  English: "英",
  Japanese: "日",
  Korean: "韩",
  German: "德",
  French: "法",
  Spanish: "西",
  Russian: "俄",
};

/** 目标语言 → 媒体服务器语言码（文件名尾缀，如 chs）。 */
const LANG_CODE: Record<string, string> = {
  "Simplified Chinese": "chs",
  "Traditional Chinese": "cht",
  Chinese: "chs",
  English: "eng",
  Japanese: "jpn",
  Korean: "kor",
  German: "ger",
  French: "fre",
  Spanish: "spa",
  Russian: "rus",
};

/** 可手动选择的语言码选项（默认随目标语言推断，可覆盖）。 */
export const LANGUAGE_CODES = [
  { value: "chs", label: "chs（简体中文）" },
  { value: "cht", label: "cht（繁体中文）" },
  { value: "zh", label: "zh（中文，最通用）" },
  { value: "zh-CN", label: "zh-CN" },
  { value: "zh-Hans", label: "zh-Hans" },
  { value: "eng", label: "eng（英文）" },
  { value: "jpn", label: "jpn（日文）" },
  { value: "kor", label: "kor（韩文）" },
] as const;

export function nounOf(lang: string): string {
  return LANG_NOUN[lang] ?? lang;
}
export function charOf(lang: string): string {
  return LANG_CHAR[lang] ?? lang.slice(0, 1);
}
export function codeOf(lang: string): string {
  return LANG_CODE[lang] ?? "chs";
}

/** 去掉扩展名与已有的语言/类型尾标，得到「基础名」。 */
export function deriveBaseName(fileName: string): string {
  let name = fileName.replace(/\.(srt|ass|vtt|lrc)$/i, "");
  // 反复剥离尾部的语言/类型标记段（最多 4 段），含中英文标记（如 .英 .中 .简体 .双语）
  const TAG = /\.(chs|cht|zho?|chi|zh(?:-[\w-]+)?|eng?|en|jpn?|kor?|ja|ko|sdh|forced|default|简体中文|繁体中文|简体|繁体|简中|繁中|中字|英字|中英|国语|粤语|双语|简|繁|中|英|日|韩|法|德|西|俄|粤|机翻[一-龥]*|AI[一-龥a-zA-Z]*|[一-龥]{0,4}双语)$/i;
  for (let i = 0; i < 4; i++) {
    const next = name.replace(TAG, "");
    if (next === name) break;
    if (next.trim().length < 2) break; // 防止把过短的名字（疑似标题本身）剥光，如 "3.德" → "3"
    name = next;
  }
  return name || "subtitle";
}

export interface ExportNameOptions {
  fileName: string; // 原始文件名
  type: ExportType;
  sourceLang: string; // "auto" 表示未知
  targetLang: string;
  /** 覆盖语言码；不传则按目标语言推断 */
  langCode?: string;
  /** 自定义「仅译文」附加文字（描述符），覆盖自动推断，如 "AI机翻中文" */
  translatedLabel?: string;
  /** 自定义「双语」附加文字（描述符），覆盖自动推断，如 "AI机翻中英双语" */
  bilingualLabel?: string;
  ext?: string;
}

/** 推断默认描述符（未自定义时使用）。 */
export function autoDescriptor(type: ExportType, sourceLang: string, targetLang: string): string {
  if (type === "translated") return `AI${nounOf(targetLang)}`; // AI中文
  const known = sourceLang && sourceLang !== "auto";
  return known
    ? `AI${charOf(targetLang)}${charOf(sourceLang)}双语` // AI中英双语
    : `AI${nounOf(targetLang)}双语`; // 源语言未知：AI中文双语
}

export function buildExportName(o: ExportNameOptions): string {
  const base = deriveBaseName(o.fileName);
  const code = o.langCode || codeOf(o.targetLang);
  const ext = o.ext ?? "srt";
  const custom = o.type === "translated" ? o.translatedLabel : o.bilingualLabel;
  const descriptor = custom && custom.trim() ? custom.trim() : autoDescriptor(o.type, o.sourceLang, o.targetLang);
  return `${base}.${descriptor}.${code}.${ext}`.replace(/\.{2,}/g, ".");
}
