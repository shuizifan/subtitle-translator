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

/** 给一行文本套上 SRT 颜色标签（仅当启用且提供颜色时）。 */
export function applySrtColor(text: string, style: LanguageStyle, enable: boolean): string {
  if (!enable || !style.primaryColor) return text;
  return `<font color="${style.primaryColor}">${text}</font>`;
}
