// 内联标签抽离与回填（见规范 §6「格式标签保护」）
// 翻译前抽离标签、翻译纯文本、译完按位置回填，比依赖模型「请保留标签」更可靠。

import type { InlineTag } from "@/core/model";

// 匹配 SRT 的类 HTML 标签（<i> </i> <b> <font ...> </font> 等）与 ASS 大括号标签（{\an8}）。
const TAG_RE = /<\/?[a-zA-Z][^>]*>|\{\\[^}]*\}/g;

export interface ExtractResult {
  /** 去标签后的纯文本（保留 cue 内换行 \n） */
  plain: string;
  tags: InlineTag[];
}

export function extractTags(text: string): ExtractResult {
  const tags: InlineTag[] = [];
  let plain = "";
  let last = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text)) !== null) {
    plain += text.slice(last, m.index);
    tags.push({ raw: m[0], offset: plain.length });
    last = m.index + m[0].length;
  }
  plain += text.slice(last);
  return { plain, tags };
}

/**
 * 把抽离的标签按 offset 回填进（可能已翻译的）纯文本。
 * 翻译后文本长度会变，故 offset 超出范围时夹紧到文本末尾——
 * 对最常见的「整行 <i>...</i> 包裹」场景（offset=0 与 offset=末尾）能正确还原。
 */
export function reinsertTags(plain: string, tags?: InlineTag[]): string {
  if (!tags || tags.length === 0) return plain;
  const sorted = [...tags].sort((a, b) => a.offset - b.offset);
  let result = "";
  let prev = 0;
  for (const t of sorted) {
    const off = Math.max(prev, Math.min(t.offset, plain.length));
    result += plain.slice(prev, off) + t.raw;
    prev = off;
  }
  result += plain.slice(prev);
  return result;
}
