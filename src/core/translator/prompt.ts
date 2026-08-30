// 提示词构造（见规范 §6）。
// 用带 ID 的结构化输入/输出强约束行对齐：每条字幕带稳定数字 ID，模型必须逐条对应、
// 不得合并或拆分，输出严格为 JSON 数组。

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BatchItem {
  id: number;
  text: string;
}

export interface PromptOptions {
  sourceLang: string; // "auto" 表示自动检测
  targetLang: string;
  /** 用户追加的自定义风格指令（语气、领域术语倾向） */
  customStyle?: string;
  /**
   * 可编辑的「翻译风格 / 系统提示词」模板（高级设置）。可含占位符
   * {{to}}（目标语言）、{{from}}（源语言）。引擎会在其后强制追加
   * JSON-ID 输出协议以保证行对齐，故无论如何编辑都不会破坏对齐。
   */
  systemPrompt?: string;
}

/**
 * 默认风格提示词（参考「沉浸式翻译」预设改写：专业母语译者、仅输出译文、
 * 保留不需翻译的专有名词等）。用户可在高级设置里修改。
 */
export const DEFAULT_STYLE_PROMPT = `You are a professional {{to}} native translator. Translate the text fluently and naturally into {{to}}.

Translation rules:
1. Output only the translated content, without explanations or extra text.
2. Keep content that should not be translated (proper nouns, code, etc.) as the original.
3. Subtitle context: keep it colloquial, concise, and not overly long per line.
4. Preserve line breaks within an entry (e.g. dialogue "-A\\n-B" stays two lines).`;

function fillPlaceholders(tpl: string, opts: PromptOptions): string {
  const from = opts.sourceLang === "auto" ? "the source language (auto-detect)" : opts.sourceLang;
  return tpl.replaceAll("{{to}}", opts.targetLang).replaceAll("{{from}}", from);
}

/** 强制的输出协议，保证行对齐，不可被用户提示词覆盖。 */
const OUTPUT_CONTRACT = [
  "",
  "## Output protocol (MUST follow exactly):",
  'You will receive a JSON array like [{"id":1,"text":"..."}].',
  'Translate each item\'s "text" field. Output ONLY a JSON array like [{"id":1,"text":"<translation>"}],',
  "with the SAME ids, exactly one item per input id. Never merge or split items.",
  "Preserve \\n line breaks inside each text. No markdown, no code fences, no commentary.",
].join("\n");

export function buildSystemPrompt(opts: PromptOptions): string {
  const styleTpl = opts.systemPrompt && opts.systemPrompt.trim() ? opts.systemPrompt : DEFAULT_STYLE_PROMPT;
  let out = fillPlaceholders(styleTpl, opts);
  if (opts.customStyle && opts.customStyle.trim()) {
    out += `\n\nAdditional user style: ${opts.customStyle.trim()}`;
  }
  return out + "\n" + OUTPUT_CONTRACT;
}

export function buildUserPrompt(batch: BatchItem[], context?: BatchItem[]): string {
  const parts: string[] = [];
  if (context && context.length > 0) {
    parts.push(
      "For continuity only (DO NOT translate or include these in your output) — preceding lines:",
    );
    parts.push(JSON.stringify(context));
    parts.push("");
  }
  parts.push("Translate the following entries and return the JSON array:");
  parts.push(JSON.stringify(batch));
  return parts.join("\n");
}

export function buildMessages(
  batch: BatchItem[],
  opts: PromptOptions,
  context?: BatchItem[],
): ChatMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(opts) },
    { role: "user", content: buildUserPrompt(batch, context) },
  ];
}

/**
 * 从一段可能不完整的文本里，逐个切出「顶层完整的 {...} 片段」。
 * 用于抢救被 max_tokens 截断的 JSON 数组：数组虽然没有闭合的 ]，
 * 但前面已经写完的对象仍然是有效数据，不该整批丢弃。
 */
function scanTopLevelObjects(s: string): string[] {
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
function escapeRawControlChars(s: string): string {
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

/**
 * 解析模型返回的内容为 id→译文 的 Map。
 * 容错：剥离 ```json 代码围栏、截取首个 [ 到末个 ]、兼容对象形式 {"1":"..."}，
 * 并在整体解析失败时（输出被截断、字符串里有裸换行）逐个对象抢救已完成的条目。
 */
export function parseTranslationResponse(content: string): Map<number, string> {
  const result = new Map<number, string>();
  let s = content.trim();
  // 剥离代码围栏
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  const tryArray = (raw: string): boolean => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.id === "number" && typeof item.text === "string") {
            result.set(item.id, item.text);
          }
        }
        return result.size > 0;
      }
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          const id = Number(k);
          if (Number.isFinite(id) && typeof v === "string") result.set(id, v);
        }
        return result.size > 0;
      }
    } catch {
      /* fallthrough */
    }
    return false;
  };

  if (tryArray(s)) return result;

  // 截取数组片段再试
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a !== -1 && b !== -1 && b > a) {
    if (tryArray(s.slice(a, b + 1))) return result;
  }
  // 修掉字符串里的裸换行再整体试一次
  const repaired = escapeRawControlChars(s);
  if (repaired !== s) {
    if (tryArray(repaired)) return result;
    const ra = repaired.indexOf("[");
    const rb = repaired.lastIndexOf("]");
    if (ra !== -1 && rb > ra && tryArray(repaired.slice(ra, rb + 1))) return result;
  }

  // 截取对象片段再试
  const oa = s.indexOf("{");
  const ob = s.lastIndexOf("}");
  if (oa !== -1 && ob !== -1 && ob > oa) {
    if (tryArray(s.slice(oa, ob + 1))) return result;
  }

  // 最后的抢救：输出被 max_tokens 截断时数组没有闭合，但已写完的对象仍然有效。
  // 逐个提取，能救回多少算多少；剩下的交给引擎缩批重试。
  for (const frag of scanTopLevelObjects(repaired)) {
    try {
      const item = JSON.parse(frag);
      if (item && typeof item.id === "number" && typeof item.text === "string") {
        result.set(item.id, item.text);
      }
    } catch {
      /* 跳过这一段 */
    }
  }
  return result;
}
