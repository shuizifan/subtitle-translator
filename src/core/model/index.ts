// 公共中间模型（见规范 §3、§10）
// core/ 不依赖 React / 浏览器，方便用 Vitest 直接测试，也便于将来复用到 CLI。

export type SubtitleFormat = "srt" | "ass" | "vtt" | "lrc";

/** 抽离出的内联格式标签及其在纯文本中的位置，用于翻译后回填（见规范 §6 标签保护）。 */
export interface InlineTag {
  /** 原始标签，如 "<i>"、"</i>"、'<font color="#fff">'、"{\\an8}" */
  raw: string;
  /** 在纯文本（去标签后）中的插入位置 */
  offset: number;
}

export interface SubtitleEntry {
  /** 稳定顺序索引，从 1 开始，贯穿翻译全程，用于行对齐校验 */
  id: number;
  /** 开始时间，毫秒 */
  start: number;
  /** 结束时间，毫秒 */
  end: number;
  /** 已抽离样式标签的纯文本（可含 cue 内换行 \n） */
  originalText: string;
  /** 译文（纯文本，可含 cue 内换行 \n） */
  translatedText?: string;
  /** 抽离出的格式标签及其位置，用于回填 */
  tags?: InlineTag[];
}

export interface SubtitleDocument {
  /** 客户端生成的任务 UUID */
  taskId: string;
  sourceFormat: SubtitleFormat;
  entries: SubtitleEntry[];
  /** 保存 ASS 头/Styles、VTT 头、原始换行符等，用于无损往返；也存解析告警 */
  meta: Record<string, unknown>;
}

/** 解析过程中无法处理的行（见规范 §11：定位到第几条 + 原始文本） */
export interface ParseIssue {
  line: number; // 1-based 源文件行号
  raw: string;
  message: string;
}
