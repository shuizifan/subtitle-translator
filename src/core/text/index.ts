// 文本拼接工具。
//
// 「合并多行为一行」不能一律用空格连接：英文的换行处该补空格，中文补了就会在
// 句子中间留下突兀的空隙（如「男孩： 法国人已经向法郎 说了再见。」）。
// 规则：接缝两侧都是 CJK（含全角标点）时不插空格，其余情况插一个空格，
// 这样中英混排的边界（如「德国人已经说了 Auf Wiedersehen」）仍然正确。

/** CJK 汉字/假名/谚文/全角标点。 */
const CJK =
  /[⺀-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯＀-｠￠-￦]/;

export function isCjkChar(ch: string | undefined): boolean {
  return !!ch && CJK.test(ch);
}

/** 文本里是否含 CJK 字符（用于译文体检、语种判定）。 */
export function hasCjk(text: string): boolean {
  return CJK.test(text);
}

/** 按「CJK 接缝不加空格」的规则连接若干片段。 */
export function joinSmart(parts: string[]): string {
  const kept = parts.filter((p) => p !== "");
  if (kept.length === 0) return "";
  return kept.reduce((out, p) =>
    out + (isCjkChar(out[out.length - 1]) && isCjkChar(p[0]) ? "" : " ") + p,
  );
}

/** 合并多行为一行：逐行去空白、丢空行，再按上述规则连接。 */
export function collapseLines(text: string): string {
  return joinSmart(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== ""),
  );
}
