// 模型返回的「JSON」往往并不干净：套着代码围栏、前后带寒暄、字符串里有裸换行、
// 甚至因为 max_tokens 截断而没有闭合。这里集中放宽容解析的工具，供翻译与术语表复用。

/**
 * 从一段可能不完整的文本里，逐个切出「顶层完整的 {...} 片段」。
 * 用于抢救被截断的 JSON 数组：数组虽然没有闭合的 ]，但前面已经写完的对象仍是有效数据。
 */
export function scanTopLevelObjects(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) depth--;
      if (depth === 0 && start !== -1) {
        out.push(s.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/**
 * 把字符串字面量里的裸控制字符转义成合法 JSON。
 * 提示词要求模型保留条目内的换行，模型经常直接输出真实换行符而非 \n，
 * 这会让 JSON.parse 整个失败。
 */
export function escapeRawControlChars(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) {
        esc = false;
        out += ch;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        out += ch;
        continue;
      }
      if (ch === '"') {
        inStr = false;
        out += ch;
        continue;
      }
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += ch;
      continue;
    }
    if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}

/** 去掉 ```json 代码围栏并 trim。 */
export function stripCodeFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/**
 * 尽最大努力把模型输出解析成「对象数组」。
 * 依次尝试：整体解析 → 截取 [..] → 修裸换行 → 截取 {..} → 逐个抢救顶层对象。
 */
export function parseLooseObjectArray(content: string): Record<string, unknown>[] {
  const s = stripCodeFence(content);
  const asArray = (v: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
    if (v && typeof v === "object") return [v as Record<string, unknown>];
    return null;
  };
  const attempt = (raw: string): Record<string, unknown>[] | null => {
    try {
      return asArray(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const candidates: string[] = [s];
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a !== -1 && b > a) candidates.push(s.slice(a, b + 1));
  const repaired = escapeRawControlChars(s);
  if (repaired !== s) {
    candidates.push(repaired);
    const ra = repaired.indexOf("[");
    const rb = repaired.lastIndexOf("]");
    if (ra !== -1 && rb > ra) candidates.push(repaired.slice(ra, rb + 1));
  }
  const oa = s.indexOf("{");
  const ob = s.lastIndexOf("}");
  if (oa !== -1 && ob > oa) candidates.push(s.slice(oa, ob + 1));

  for (const c of candidates) {
    const parsed = attempt(c);
    if (parsed && parsed.length > 0) return parsed;
  }

  // 最后的抢救：被截断时数组没有闭合，但已写完的对象仍然有效。
  const salvaged: Record<string, unknown>[] = [];
  for (const frag of scanTopLevelObjects(repaired)) {
    try {
      const item = JSON.parse(frag);
      if (item && typeof item === "object") salvaged.push(item as Record<string, unknown>);
    } catch {
      /* 跳过这一段 */
    }
  }
  return salvaged;
}
