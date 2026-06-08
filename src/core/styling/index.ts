// 样式应用（见规范 §7）。
// v1（SRT）样式范围：仅布局 + 语言顺序 + 可选颜色（默认关）。
// 数据结构按 ASS 能力先设计，SRT 阶段只取子集生效（颜色），其余字段留给 ASS 阶段。

/** 单语言样式（按 ASS 能力设计；SRT 阶段仅 color 可能生效）。 */
export interface LanguageStyle {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string; // #RRGGBB；SRT 用 <font color> 近似
  outlineColor?: string;
  outline?: number;
  shadow?: number;
  position?: "top" | "bottom";
  italic?: boolean;
}

export interface StyleConfig {
  /** 当前配色方案名（用于在设置里回显选中项） */
  scheme: string;
  /** 是否启用 SRT 颜色（<font color>），默认关——各播放器支持不一 */
  enableSrtColor: boolean;
  original: LanguageStyle;
  translation: LanguageStyle;
}

/** 译文（观众主要阅读对象）固定为白色。 */
export const TRANSLATION_WHITE = "#FFFFFF";

/**
 * 配色方案：译文恒为白色，原文用金黄 / 墨绿等彩色作区分。默认「不分色」。
 * 译文是观众主要阅读对象，保持纯白最清晰；原文压一层彩色作参考。
 */
export const COLOR_SCHEMES: Array<{
  name: string;
  enableSrtColor: boolean;
  original: LanguageStyle;
  translation: LanguageStyle;
}> = [
  {
    name: "不分色（默认）",
    enableSrtColor: false,
    original: {},
    translation: {},
  },
  {
    name: "译文白 / 金黄原文",
    enableSrtColor: true,
    original: { primaryColor: "#D4A52A" }, // 沉稳金黄，非亮金
    translation: { primaryColor: TRANSLATION_WHITE },
  },
  {
    name: "译文白 / 墨绿原文",
    enableSrtColor: true,
    original: { primaryColor: "#5FA877" }, // 柔和绿，偏沉
    translation: { primaryColor: TRANSLATION_WHITE },
  },
  {
    name: "译文白 / 黛蓝原文",
    enableSrtColor: true,
    original: { primaryColor: "#5A8CC0" }, // 沉稳蓝
    translation: { primaryColor: TRANSLATION_WHITE },
  },
  {
    name: "译文白 / 绛粉原文",
    enableSrtColor: true,
    original: { primaryColor: "#C77B9A" }, // 柔和绛粉
    translation: { primaryColor: TRANSLATION_WHITE },
  },
];

export const DEFAULT_STYLE: StyleConfig = {
  scheme: COLOR_SCHEMES[0].name,
  enableSrtColor: false,
  original: {},
  translation: {},
};

/**
 * ASS 专用样式配置（SRT 无效）。
 * 默认「忠实保留源字幕样式」——不动源文件的字体/字号/颜色，只翻译文字。
 * 开启 forceStyle 后才用统一样式覆盖：剥离源对白的内联字体/字号/颜色标签，
 * 套上「译文大、原文小」（字号以占视频高度百分比表达，按 PlayResY 折算，跨设备一致）。
 */
export interface AssStyleConfig {
  /** 强制统一样式（覆盖源内联字体/字号/颜色）；默认 false＝忠实保留源样式。 */
  forceStyle: boolean;
  /** 译文字号占视频高度的百分比（如 5.5）。 */
  translationPct: number;
  /** 原文字号占视频高度的百分比（如 4.2）。 */
  originalPct: number;
  /** 统一字体名；空＝沿用原样式字体。 */
  fontName: string;
}

export const DEFAULT_ASS_STYLE: AssStyleConfig = {
  forceStyle: false,
  translationPct: 6.5, // 中档：译文 6.5% / 原文 5%
  originalPct: 5.0,
  fontName: "",
};

/** ASS 字号快捷档位（占视频高度百分比）。 */
export const ASS_SIZE_PRESETS = [
  { label: "小", translationPct: 6.0, originalPct: 4.8 },
  { label: "中", translationPct: 6.5, originalPct: 5.0 },
  { label: "大", translationPct: 7.0, originalPct: 5.2 },
] as const;

/** 百分比（占视频高度）→ ASS 字号像素（按脚本 PlayResY 折算）。 */
export function pctToAssFs(pct: number, playResY: number): number {
  return Math.max(1, Math.round((pct / 100) * playResY));
}

/** 给一行文本套上 SRT 颜色标签（仅当启用且提供颜色时）。 */
export function applySrtColor(text: string, style: LanguageStyle, enable: boolean): string {
  if (!enable || !style.primaryColor) return text;
  return `<font color="${style.primaryColor}">${text}</font>`;
}

/** "#RRGGBB"（或 3 位简写 "#RGB"）→ ASS 颜色 "&HBBGGRR&"（BGR 倒序，覆盖标签 \c 用）。 */
export function hexToAssColor(hex: string): string {
  let h = hex.replace(/[^0-9a-fA-F]/g, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join(""); // #FFF → FFFFFF
  h = (h + "000000").slice(0, 6);
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${(b + g + r).toUpperCase()}&`;
}

/** 给一行 ASS 文本前置主色覆盖标签 {\c&H..&}（仅当启用且提供颜色时）。 */
export function applyAssColor(text: string, style: LanguageStyle, enable: boolean): string {
  if (!enable || !style.primaryColor) return text;
  return `{\\c${hexToAssColor(style.primaryColor)}}${text}`;
}
