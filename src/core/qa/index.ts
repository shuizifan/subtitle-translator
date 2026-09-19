// 译文体检（见改进建议 #3b）。
//
// 引擎只要求「返回非空字符串」就算翻译成功，于是「模型原样返回原文」「目标是中文
// 却一个汉字都没有」这类问题会一路混到导出。这里在导出前做一次机械校验，把可疑条目
// 标黄，让用户一键重译。判定保守，宁可漏报也不误伤（专名原样保留是合法译法）。

import type { SubtitleDocument, SubtitleEntry } from "@/core/model";
import { hasCjk } from "@/core/text";

export type QaCode =
  | "untranslated" // 没有译文
  | "same-as-source" // 译文与原文完全相同
  | "missing-target-script" // 目标语言是中日韩，译文里却没有对应文字
  | "length-outlier"; // 译文/原文长度比异常

export interface QaFinding {
  id: number;
  codes: QaCode[];
}

export const QA_LABEL: Record<QaCode, string> = {
  untranslated: "未翻译",
  "same-as-source": "译文与原文相同",
  "missing-target-script": "译文不含目标语言文字",
  "length-outlier": "长度比异常",
};

/** 目标语言是否以 CJK 书写（用于「译文里一个汉字都没有」这类判定）。 */
export function targetIsCjk(targetLang: string): boolean {
  return /chinese|japanese|korean|中文|日文|日语|韩文|韩语/i.test(targetLang);
}

function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) || []).length;
}

/** 体检单条。返回命中的问题码（空数组=没问题）。 */
export function inspectEntry(entry: SubtitleEntry, targetLang: string): QaCode[] {
  const original = entry.originalText.trim();
  if (original === "" || entry.excluded) return [];
  const translated = (entry.translatedText ?? "").trim();
  if (translated === "") return ["untranslated"];

  const codes: QaCode[] = [];
  const letters = letterCount(original);

  // 纯符号/数字（"♪"、"- 1997 -"）原样返回是正常的，不参与后面几项判定
  if (letters === 0) return codes;

  // 只含一个短词的条目（人名、"OK"）原样保留是合法译法，不作判定；
  // 「整句没动」「整句里一个目标语言的字都没有」才值得怀疑。
  const substantial = original.includes(" ") || original.length >= 8;

  if (substantial && translated === original) codes.push("same-as-source");

  if (substantial && targetIsCjk(targetLang) && !hasCjk(translated)) {
    codes.push("missing-target-script");
  }

  // 短句长度波动大（"Yes." → "好的。"），只查够长的句子
  if (original.length >= 10) {
    const ratio = translated.length / original.length;
    if (ratio < 0.2 || ratio > 5) codes.push("length-outlier");
  }

  return codes;
}

/** 体检整篇，返回有问题的条目。 */
export function inspectDocument(doc: SubtitleDocument, targetLang: string): QaFinding[] {
  const out: QaFinding[] = [];
  for (const e of doc.entries) {
    const codes = inspectEntry(e, targetLang);
    if (codes.length > 0) out.push({ id: e.id, codes });
  }
  return out;
}
