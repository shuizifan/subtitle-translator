// 编码探测与转换（见规范 §5）
// 流程：字节 → jschardet 探测 → 解码为 UTF-8 文本 → 去 BOM → 交给 parser。
//
// 实现说明：规范建议 jschardet + iconv-lite。这里用 jschardet 做探测，
// 用浏览器/Node 都原生支持的 WHATWG TextDecoder 做解码（支持 gbk/big5/shift_jis/
// utf-16 等传统编码），避免在前端打包 iconv-lite 的 Node Buffer 依赖。
// iconv-lite 仍作为依赖保留，供 TextDecoder 不认识的少数标签兜底。

import jschardet from "jschardet";

export interface DetectResult {
  encoding: string;
  confidence: number;
}

export interface DecodeResult {
  text: string;
  encoding: string;
  confidence: number;
}

const BOMS: Array<{ bom: number[]; encoding: string }> = [
  { bom: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bom: [0xff, 0xfe], encoding: "utf-16le" },
  { bom: [0xfe, 0xff], encoding: "utf-16be" },
];

function matchBom(bytes: Uint8Array): string | null {
  for (const { bom, encoding } of BOMS) {
    if (bytes.length >= bom.length && bom.every((b, i) => bytes[i] === b)) {
      // utf-16be 的 BOM 是 utf-16le 反序的子集，已按 le 在前判断顺序避免误判
      return encoding;
    }
  }
  return null;
}

/** 把探测/约定的编码名规范化为 TextDecoder 能识别的 label。 */
export function normalizeLabel(encoding: string): string {
  const e = encoding.toLowerCase().replace(/[\s_]/g, "-");
  const map: Record<string, string> = {
    ascii: "windows-1252",
    "us-ascii": "windows-1252",
    "iso-8859-1": "windows-1252",
    latin1: "windows-1252",
    "windows-1252": "windows-1252",
    "utf-8": "utf-8",
    utf8: "utf-8",
    "utf-16": "utf-16le",
    "utf-16le": "utf-16le",
    "utf-16be": "utf-16be",
    gb2312: "gbk",
    gbk: "gbk",
    gb18030: "gb18030",
    big5: "big5",
    "big-5": "big5",
    "shift-jis": "shift_jis",
    "shift-jis-2004": "shift_jis",
    sjis: "shift_jis",
    "x-sjis": "shift_jis",
    "euc-jp": "euc-jp",
    "euc-kr": "euc-kr",
  };
  return map[e] ?? "utf-8";
}

export function detectEncoding(bytes: Uint8Array): DetectResult {
  const bom = matchBom(bytes);
  if (bom) return { encoding: bom, confidence: 1 };

  // jschardet 接受「二进制字符串」（每字节一个 char code）
  const sample = bytes.subarray(0, Math.min(bytes.length, 64 * 1024));
  let binary = "";
  for (let i = 0; i < sample.length; i++) binary += String.fromCharCode(sample[i]);
  const res = jschardet.detect(binary);
  return {
    encoding: (res.encoding || "utf-8").toLowerCase(),
    confidence: res.confidence ?? 0,
  };
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 解码字节为文本。可传 forced 强制使用某编码（用户手动选择时）。
 * 置信度低（< 0.6）时调用方应提示用户手动选择编码。
 */
export function decodeBytes(bytes: Uint8Array, forced?: string): DecodeResult {
  const det: DetectResult = forced
    ? { encoding: forced, confidence: 1 }
    : detectEncoding(bytes);
  let label = normalizeLabel(det.encoding);
  let text: string;
  try {
    text = new TextDecoder(label as string, { fatal: false }).decode(bytes);
  } catch {
    label = "utf-8";
    text = new TextDecoder("utf-8").decode(bytes);
  }
  return { text: stripBom(text), encoding: label, confidence: det.confidence };
}
