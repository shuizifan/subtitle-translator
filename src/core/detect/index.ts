// 源语言自动判定（见改进建议 #9）。
//
// 两个现实问题：
// 1) 源语言默认 "auto" 时，导出标签退化成「AI中文双语」而不是预期的「AI中英双语」，
//    每次都得手动去设置里选一次；
// 2) 内封字幕的容器语言标签本身就不可信（标 lat 实际是西班牙语、标 eng 实际是中英双语）。
// 靠正文内容判定比靠标签靠谱：先看书写系统，再用停用词打分区分同文字的语言。

const SCRIPTS: Array<{ lang: string; re: RegExp }> = [
  { lang: "Japanese", re: /[぀-ゟ゠-ヿ]/g }, // 假名（汉字要靠假名区分中日）
  { lang: "Korean", re: /[가-힯]/g },
  { lang: "Chinese", re: /[一-鿿㐀-䶿]/g },
  { lang: "Russian", re: /[Ѐ-ӿ]/g },
  { lang: "Arabic", re: /[؀-ۿ]/g },
  { lang: "Greek", re: /[Ͱ-Ͽ]/g },
  { lang: "Hebrew", re: /[֐-׿]/g },
  { lang: "Thai", re: /[฀-๿]/g },
];

/** 拉丁语系停用词表：只取各语言里最高频、且互不重叠的词。 */
const STOPWORDS: Record<string, string[]> = {
  English: "the and you that for with this have are not but was his her they what from your all about would there been were".split(" "),
  German: "und der die das ist nicht ich sie ein eine mit auf dass wir haben werden noch war aber schon immer".split(" "),
  French: "le la les des est pas que vous nous pour dans une qui plus avec sur elle mais tout bien être".split(" "),
  Spanish: "que los las del una por con para como está pero más este cuando muy todo hay eso ser sí".split(" "),
  Italian: "che non per una del sono come più ma questo qui sei siamo anche perché molto quando tutto".split(" "),
  Portuguese: "que não uma para com você mais como está isso muito quando eles também aqui bem tudo".split(" "),
  Dutch: "het een niet van dat ik je zijn hebben maar ook nog naar wat heb hier deze goed".split(" "),
  Swedish: "och att det som för inte den här jag har vi med kan ska men vad från".split(" "),
  Polish: "nie jest się to tak jak ale czy mnie jego tylko przez dla może tego jestem".split(" "),
  Czech: "je ale jak tak co není jsem jsi jste se na to pro když všechno".split(" "),
  Turkish: "bir bu ne için ile çok daha var ben sen biz ama şey gibi olarak".split(" "),
};

export interface DetectLanguageResult {
  /** 与 UI「原始语言」下拉一致的取值；无法判定时为 "auto" */
  lang: string;
  /** 0~1，越高越有把握 */
  confidence: number;
}

/** 从字幕正文判定源语言。 */
export function detectLanguage(texts: string[]): DetectLanguageResult {
  const sample = texts.filter((t) => t.trim() !== "").slice(0, 400).join("\n");
  if (sample.trim() === "") return { lang: "auto", confidence: 0 };

  const letters = (sample.match(/\p{L}/gu) || []).length;
  if (letters === 0) return { lang: "auto", confidence: 0 };

  // 1) 书写系统：命中率足够高就直接定案（假名优先于汉字，以区分中日）
  for (const { lang, re } of SCRIPTS) {
    const hits = (sample.match(re) || []).length;
    const ratio = hits / letters;
    if (lang === "Japanese" ? ratio > 0.02 : ratio > 0.2) {
      return { lang, confidence: Math.min(1, ratio * 2) };
    }
  }

  // 2) 拉丁字母：停用词打分
  const words = (sample.toLowerCase().match(/[\p{L}'’]+/gu) || []);
  if (words.length === 0) return { lang: "auto", confidence: 0 };
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

  let best = { lang: "auto", score: 0 };
  let second = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    let score = 0;
    for (const w of list) score += freq.get(w) ?? 0;
    if (score > best.score) {
      second = best.score;
      best = { lang, score };
    } else if (score > second) {
      second = score;
    }
  }

  const coverage = best.score / words.length;
  // 命中太少，或与第二名咬得太紧（如西/葡），不敢下结论。
  // 绝对命中数的门槛随样本大小放宽：几十行的短字幕本来就凑不够几个停用词。
  const minScore = words.length >= 120 ? 5 : 2;
  if (coverage < 0.02 || best.score < minScore || best.score < second * 1.3) {
    return { lang: "auto", confidence: coverage };
  }
  return { lang: best.lang, confidence: Math.min(1, coverage * 5) };
}
