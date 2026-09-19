// 提示词构造（见规范 §6）。
// 用带 ID 的结构化输入/输出强约束行对齐：每条字幕带稳定数字 ID，模型必须逐条对应、
// 不得合并或拆分，输出严格为 JSON 数组。

import { parseLooseObjectArray } from "@/core/translator/json";
import type { GlossaryEntry } from "@/core/glossary";
import { formatGlossary } from "@/core/glossary";

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
  /**
   * 全片术语表（人名/地名等专名的统一译法）。批与批之间是独立请求，没有共享状态，
   * 同一个人名很容易这批音译、那批保留原文；把术语表钉进 system prompt 是唯一能
   * 跨批次强制一致的手段（见改进建议 #2）。
   */
  glossary?: GlossaryEntry[];
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
  "Each output item must correspond to its own input item: never move part of one line's meaning into a neighbouring line.",
  "Preserve \\n line breaks inside each text. No markdown, no code fences, no commentary.",
].join("\n");

export function buildSystemPrompt(opts: PromptOptions): string {
  const styleTpl = opts.systemPrompt && opts.systemPrompt.trim() ? opts.systemPrompt : DEFAULT_STYLE_PROMPT;
  let out = fillPlaceholders(styleTpl, opts);
  if (opts.customStyle && opts.customStyle.trim()) {
    out += `\n\nAdditional user style: ${opts.customStyle.trim()}`;
  }
  const glossary = formatGlossary(opts.glossary);
  if (glossary) {
    out +=
      "\n\n## Glossary (MUST follow exactly):\n" +
      "These renderings are fixed for the whole film. Use them for every occurrence, never an alternative\n" +
      "transliteration, and never leave the original form when a rendering is given.\n" +
      glossary;
  }
  return out + "\n" + OUTPUT_CONTRACT;
}

export function buildUserPrompt(
  batch: BatchItem[],
  context?: BatchItem[],
  trailingContext?: BatchItem[],
): string {
  const parts: string[] = [];
  if (context && context.length > 0) {
    parts.push(
      "For continuity only (DO NOT translate or include these in your output) — preceding lines:",
    );
    parts.push(JSON.stringify(context));
    parts.push("");
  }
  if (trailingContext && trailingContext.length > 0) {
    parts.push(
      "For continuity only (DO NOT translate or include these in your output) — following lines:",
    );
    parts.push(JSON.stringify(trailingContext));
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
  trailingContext?: BatchItem[],
): ChatMessage[] {
  return [
    { role: "system", content: buildSystemPrompt(opts) },
    { role: "user", content: buildUserPrompt(batch, context, trailingContext) },
  ];
}

/**
 * 解析模型返回的内容为 id→译文 的 Map。
 * 容错：剥离 ```json 代码围栏、截取首个 [ 到末个 ]、兼容对象形式 {"1":"..."}、
 * id 被写成字符串，并在整体解析失败时（输出被截断、字符串里有裸换行）逐个对象抢救。
 */
export function parseTranslationResponse(content: string): Map<number, string> {
  const result = new Map<number, string>();
  for (const item of parseLooseObjectArray(content)) {
    const rawId = item.id;
    const id =
      typeof rawId === "number"
        ? rawId
        : typeof rawId === "string" && rawId.trim() !== "" && Number.isFinite(Number(rawId))
          ? Number(rawId)
          : null;
    if (id != null) {
      const text = item.text;
      if (typeof text === "string") result.set(id, text);
      continue;
    }
    // 对象映射形态：{"1":"译文","2":"译文"}
    for (const [k, v] of Object.entries(item)) {
      const n = Number(k);
      if (Number.isFinite(n) && typeof v === "string") result.set(n, v);
    }
  }
  return result;
}
