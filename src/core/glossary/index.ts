// 全片术语表（见改进建议 #2）。
//
// 背景：翻译是按批切开的独立请求，批与批之间除了几条上下文原文没有任何共享状态。
// 同一个人名，模型可能这批音译成「罗伯特」、那批原样留 Robert，整部片子中英混用。
// 解法是两遍法：先扫全片抽出专名候选 → 单独调一次模型生成 {原文: 译名} 术语表
//（用户可手工修改）→ 翻译时把术语表钉进 system prompt 强制遵守。

import type { ChatMessage } from "@/core/translator/prompt";
import { parseLooseObjectArray } from "@/core/translator/json";

export interface TermCandidate {
  /** 候选专名（原文形态） */
  term: string;
  /** 全片出现次数 */
  count: number;
  /** 是否出现在呼格位置（"Caesar!" / "..., Caesar."），这类即便只出现一次也要保留 */
  vocative: boolean;
  /** 样例原文。只给裸词表时模型会把 General / Emperor 这类词判成普通名词丢掉，带上样例才认得出是马名 */
  samples: string[];
}

export interface GlossaryEntry {
  /** 原文专名 */
  term: string;
  /** 统一译名；与 term 相同表示「保留原文」 */
  translation: string;
}

export interface ExtractOptions {
  /** 最多返回多少个候选（控制提示词长度），默认 150 */
  limit?: number;
  /** 每个候选最多附几条样例，默认 2 */
  maxSamples?: number;
}

/**
 * 高频词表：这些词出现在句首/全大写台词里会被大写规则误判成专名。
 * 只用于「排除」，不影响真正的专名（人名极少与这些词重合）。
 */
const STOPWORDS = new Set(
  `a about after again against all also am an and another any are aren't around as ask at away back be
  because been before being below best better between big both but by call came can can't cannot come
  coming could couldn't day did didn't do does doesn't doing don't done down each even ever every
  everything far few find first for from get gets getting give go god going gone good got great had
  hadn't half has hasn't have haven't having he he's hell help her here hers herself hey him himself his
  hold home how how's i i'd i'll i'm i've if in inside instead into is isn't it it's its itself just
  keep kind know knew last later least leave less let let's life like listen little long look looking
  lot made make man many maybe me mean men might mine minute miss more most mother much must my myself
  name never new next nice night no nobody none nor not nothing now number of off oh ok okay old on once
  one only open or other our ours out over own people perhaps place please put really right said same
  say says see seen she she's should shouldn't since sir so some someone something sometimes soon sorry
  still stop such sure take talk tell than thank thanks that that's the their theirs them themselves
  then there there's these they they're they've thing things think this those though thought three
  through time to today together too took true try turn two under until up upon us use very wait want
  was wasn't way we we're we've well were weren't what what's when where which while who who's whole
  whom why will with without woman women won't would wouldn't yeah year years yes yet you you'll you're
  you've young your yours yourself`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * 词组首尾可以剥掉的虚词。
 * 不能直接用整张高频词表来剥：New York / Old Man 这类专名的首词本身就是高频词。
 */
const GROUP_EDGE_STOP = new Set(
  `the a an and or but so if when then this that these those my your his her our their its
   i you he she we they it oh well yes no okay ok now here there what why how`
    .split(/\s+/)
    .filter(Boolean),
);

/** 词首大写的词（含全大写、含撇号/连字符的复合词）。 */
const TOKEN_RE = /\p{Lu}[\p{L}\p{M}'’\-]*/gu;

/** 去掉词尾的所有格与标点残留。 */
function normalizeToken(raw: string): string {
  return raw.replace(/['’]s$/i, "").replace(/^[-'’]+|[-'’.]+$/g, "");
}

function isStopword(term: string): boolean {
  return STOPWORDS.has(term.toLowerCase());
}

/** 该位置是否是「句首」——句首大写是语法要求，不构成专名证据。 */
function atSentenceStart(line: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = line[i];
    if (ch === " " || ch === "\t") continue;
    return ".!?…\"'“”「」-—–:;>*♪".includes(ch);
  }
  return true;
}

interface Acc {
  term: string;
  count: number;
  nonInitial: number;
  vocative: boolean;
  samples: string[];
}

/** 从整部片子的原文里抽取专名候选。 */
export function extractTermCandidates(texts: string[], opts: ExtractOptions = {}): TermCandidate[] {
  const limit = opts.limit ?? 150;
  const maxSamples = opts.maxSamples ?? 2;
  const acc = new Map<string, Acc>();

  const record = (term: string, line: string, initial: boolean, vocative: boolean) => {
    let a = acc.get(term);
    if (!a) {
      a = { term, count: 0, nonInitial: 0, vocative: false, samples: [] };
      acc.set(term, a);
    }
    a.count++;
    if (!initial) a.nonInitial++;
    if (vocative) a.vocative = true;
    // 优先收「非句首 / 呼格」的样例：这类句子最能说明词性
    const sample = line.trim().slice(0, 100);
    const worthy = !initial || vocative;
    if (sample && !a.samples.includes(sample) && (worthy || a.samples.length === 0) && a.samples.length < maxSamples) {
      a.samples.push(sample);
    }
  };

  for (const text of texts) {
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      // 一行里连续的大写词合成一个词组（Mister Tom / New York）
      const hits: { term: string; index: number; end: number; initial: boolean }[] = [];
      TOKEN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOKEN_RE.exec(line)) !== null) {
        const term = normalizeToken(m[0]);
        if (term.length < 2 || !/\p{L}/u.test(term)) continue;
        hits.push({ term, index: m.index, end: m.index + m[0].length, initial: atSentenceStart(line, m.index) });
      }

      let i = 0;
      while (i < hits.length) {
        let j = i;
        // 连续（中间只隔一个空格）的大写词并成词组
        while (j + 1 < hits.length && line.slice(hits[j].end, hits[j + 1].index) === " ") j++;
        let group = hits.slice(i, j + 1);
        // 词组首尾的虚词（The / And / But…）剥掉，留中间的真正专名
        const edgeStop = (t: string) => GROUP_EDGE_STOP.has(t.toLowerCase());
        while (group.length > 1 && edgeStop(group[0].term)) group = group.slice(1);
        while (group.length > 1 && edgeStop(group[group.length - 1].term)) group = group.slice(0, -1);

        if (group.length > 0 && !(group.length === 1 && isStopword(group[0].term))) {
          const term = group.map((g) => g.term).join(" ");
          const initial = group[0].initial;
          const vocative =
            new RegExp(`(^|[,，])\\s*${escapeRegExp(term)}\\s*[!?.,]?\\s*$`).test(line.trim()) ||
            new RegExp(`^${escapeRegExp(term)}\\s*[!?,]`).test(line.trim());
          record(term, line, initial, vocative);
          // 词组里的单词本身也单独计一票（"Mister Tom" 与 "Tom" 是同一个人）
          if (group.length > 1) {
            for (const g of group) {
              if (!isStopword(g.term)) record(g.term, line, g.initial, false);
            }
          }
        }
        i = j + 1;
      }
    }
  }

  const kept: TermCandidate[] = [];
  for (const a of acc.values()) {
    if (isStopword(a.term)) continue;
    // 只在句首出现且只出现一次的词，多半是被语法大写的普通词，丢掉；
    // 呼格位置（"Caesar!"）即便只出现一次也保留。
    if (a.nonInitial === 0 && a.count < 2 && !a.vocative) continue;
    kept.push({ term: a.term, count: a.count, vocative: a.vocative, samples: a.samples });
  }
  kept.sort((x, y) => y.count - x.count || x.term.localeCompare(y.term));
  return kept.slice(0, limit);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 生成「让模型产出术语表」的一次性请求。 */
export function buildGlossaryMessages(
  candidates: TermCandidate[],
  opts: { sourceLang: string; targetLang: string; customStyle?: string },
): ChatMessage[] {
  const from = opts.sourceLang === "auto" ? "the film's source language" : opts.sourceLang;
  const system = [
    `You are building a glossary for subtitling one single film, translated from ${from} into ${opts.targetLang}.`,
    "",
    "You get candidate terms harvested by a capitalisation heuristic, each with sample subtitle lines.",
    "",
    "Rules:",
    `1. Keep only proper nouns: character names, nicknames, forms of address, animal names, place names,`,
    "   organisations, vehicle/ship names, titles of works. Judge by the samples, not by the word alone —",
    '   a common word can be a name in context (a horse called "General", a dog called "Emperor").',
    "2. Drop ordinary words that were only capitalised because they start a line, and drop interjections.",
    `3. For every kept term give ONE fixed ${opts.targetLang} rendering to be used everywhere in the film.`,
    "4. If a term is better left in its original form, repeat the original as the translation.",
    "5. Keep renderings short and natural for subtitles; be consistent across related terms",
    "   (the same person's first name and full name must use the same rendering).",
    "",
    "## Output protocol (MUST follow exactly):",
    'Output ONLY a JSON array like [{"term":"Robert","translation":"罗伯特"}].',
    "No markdown, no code fences, no commentary. Omit terms you decide to drop.",
  ].join("\n");

  const payload = candidates.map((c) => ({
    term: c.term,
    count: c.count,
    samples: c.samples,
  }));

  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `Build the glossary for these candidates:\n${JSON.stringify(payload)}`,
    },
  ];
}

/** 解析模型返回的术语表。 */
export function parseGlossaryResponse(content: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const item of parseLooseObjectArray(content)) {
    const term = pickString(item, ["term", "source", "original", "en", "key", "from"]);
    const translation = pickString(item, ["translation", "target", "translated", "zh", "value", "to"]);
    if (term && translation && !seen.has(term)) {
      seen.add(term);
      out.push({ term, translation });
    }
  }
  return out;
}

function pickString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

/** 术语表 → 提示词里的文本块。 */
export function formatGlossary(entries?: GlossaryEntry[]): string {
  if (!entries || entries.length === 0) return "";
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const term = e.term?.trim();
    const translation = e.translation?.trim();
    if (!term || !translation || seen.has(term)) continue;
    seen.add(term);
    lines.push(`${term} => ${translation}`);
  }
  return lines.join("\n");
}

/**
 * 只把「这一批里真的出现了的」术语发给模型。
 * 整表动辄上百条，每批都全量附带既费 token 又稀释注意力。
 */
export function selectGlossaryFor(entries: GlossaryEntry[], texts: string[]): GlossaryEntry[] {
  if (entries.length === 0) return entries;
  const haystack = texts.join("\n");
  return entries.filter((e) => e.term && haystack.includes(e.term));
}

/** 合并两份术语表：同名条目以 incoming 为准，保留原有顺序。 */
export function mergeGlossary(existing: GlossaryEntry[], incoming: GlossaryEntry[]): GlossaryEntry[] {
  const map = new Map<string, string>();
  for (const e of existing) if (e.term) map.set(e.term, e.translation);
  for (const e of incoming) if (e.term) map.set(e.term, e.translation);
  return [...map.entries()].map(([term, translation]) => ({ term, translation }));
}
