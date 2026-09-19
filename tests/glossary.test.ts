import { describe, expect, it } from "vitest";
import {
  extractTermCandidates,
  formatGlossary,
  mergeGlossary,
  parseGlossaryResponse,
  selectGlossaryFor,
} from "@/core/glossary";
import { buildSystemPrompt } from "@/core/translator/prompt";

describe("专名候选抽取", () => {
  it("抽出反复出现的人名，忽略句首的普通词", () => {
    const texts = [
      "The Germans have said goodbye.",
      "Robert, where are you going?",
      "I told Robert to wait.",
      "Have you seen Robert today?",
    ];
    const terms = extractTermCandidates(texts).map((c) => c.term);
    expect(terms).toContain("Robert");
    expect(terms).not.toContain("The");
    expect(terms).not.toContain("Have");
  });

  it("呼格位置的单次出现也保留（Caesar! 全片仅一次）", () => {
    const terms = extractTermCandidates(["Caesar!", "Come on, hurry up."]).map((c) => c.term);
    expect(terms).toContain("Caesar");
  });

  it("带样例原文，模型才认得出 General 是马名", () => {
    const cands = extractTermCandidates([
      "General!",
      "How do you plan to mount General?",
      "General is the fastest horse here.",
    ]);
    const general = cands.find((c) => c.term === "General");
    expect(general).toBeTruthy();
    expect(general!.count).toBeGreaterThanOrEqual(2);
    expect(general!.samples.join(" ")).toMatch(/mount General|fastest horse/);
  });

  it("全大写人名也能抽到", () => {
    const terms = extractTermCandidates([
      "TOLO, come here!",
      "Where is TOLO?",
      "ROMEK and VLADEK are waiting.",
      "I saw ROMEK yesterday.",
    ]).map((c) => c.term);
    expect(terms).toContain("TOLO");
    expect(terms).toContain("ROMEK");
  });

  it("连续大写词并成词组", () => {
    const terms = extractTermCandidates([
      "Welcome to New York, sir.",
      "New York is far away.",
    ]).map((c) => c.term);
    expect(terms).toContain("New York");
  });
});

describe("术语表解析与注入", () => {
  it("解析模型返回（含代码围栏与字段别名）", () => {
    const entries = parseGlossaryResponse('```json\n[{"term":"Robert","translation":"罗伯特"},{"source":"Cyril","target":"西里尔"}]\n```');
    expect(entries).toEqual([
      { term: "Robert", translation: "罗伯特" },
      { term: "Cyril", translation: "西里尔" },
    ]);
  });

  it("抢救被截断的输出", () => {
    const entries = parseGlossaryResponse('[{"term":"Robert","translation":"罗伯特"},{"term":"Cyril","transl');
    expect(entries).toEqual([{ term: "Robert", translation: "罗伯特" }]);
  });

  it("只挑这一批里出现过的术语", () => {
    const g = [
      { term: "Robert", translation: "罗伯特" },
      { term: "Cyril", translation: "西里尔" },
    ];
    expect(selectGlossaryFor(g, ["Robert, wait!"])).toEqual([{ term: "Robert", translation: "罗伯特" }]);
  });

  it("术语表写进 system prompt", () => {
    const sys = buildSystemPrompt({
      sourceLang: "English",
      targetLang: "Simplified Chinese",
      glossary: [{ term: "Robert", translation: "罗伯特" }],
    });
    expect(sys).toContain("Robert => 罗伯特");
    expect(sys).toContain("Glossary");
    // 输出协议必须仍在最后，不被术语表挤掉
    expect(sys).toContain("Output protocol");
  });

  it("合并时以新表为准、保留旧条目", () => {
    const merged = mergeGlossary(
      [{ term: "Robert", translation: "罗伯" }, { term: "Cyril", translation: "西里尔" }],
      [{ term: "Robert", translation: "罗伯特" }],
    );
    expect(merged).toEqual([
      { term: "Robert", translation: "罗伯特" },
      { term: "Cyril", translation: "西里尔" },
    ]);
  });

  it("空表不产生提示词块", () => {
    expect(formatGlossary([])).toBe("");
    expect(buildSystemPrompt({ sourceLang: "auto", targetLang: "Simplified Chinese" })).not.toContain("Glossary");
  });
});

describe("术语表生成过程", () => {
  // 30 个各出现两次（且非句首）的专名 → chunkSize=10 时正好分 3 批
  const NAMES = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet",
    "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango",
    "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu", "Orion", "Perseus", "Draco", "Vega",
  ];
  const texts = NAMES.flatMap((n) => [`I saw ${n} today.`, `We waited for ${n} again.`]);

  it("回报进度并边生成边给出部分结果", async () => {
    const { buildGlossary } = await import("@/core/glossary/build");
    const progress: string[] = [];
    const partials: number[] = [];
    let call = 0;
    const res = await buildGlossary(
      texts,
      async () => {
        const i = call++;
        return JSON.stringify([{ term: `T${i}`, translation: `译${i}` }]);
      },
      {
        sourceLang: "English",
        targetLang: "Simplified Chinese",
        chunkSize: 10,
        concurrency: 1,
        onProgress: (p) => progress.push(`${p.phase}:${p.done}/${p.total}`),
        onPartial: (e) => partials.push(e.length),
      },
    );
    expect(progress[0]).toBe("scanning:0/0");
    expect(progress.at(-1)).toMatch(/^requesting:\d+\/\d+$/);
    // 每批结束都回报一次累积结果，且数量单调不减
    expect(partials.length).toBeGreaterThan(1);
    expect(partials).toEqual([...partials].sort((a, b) => a - b));
    expect(res.entries.length).toBe(partials.at(-1));
    expect(res.failedChunks).toBe(0);
  });

  it("单批失败不作废整张表", async () => {
    const { buildGlossary } = await import("@/core/glossary/build");
    let call = 0;
    const res = await buildGlossary(
      texts,
      async () => {
        if (call++ === 0) throw new Error("boom");
        return '[{"term":"Robert","translation":"罗伯特"}]';
      },
      { sourceLang: "English", targetLang: "Simplified Chinese", chunkSize: 10, concurrency: 1 },
    );
    expect(res.failedChunks).toBe(1);
    expect(res.lastError).toContain("boom");
    expect(res.entries).toEqual([{ term: "Robert", translation: "罗伯特" }]);
  });

  it("全部批次失败时抛错", async () => {
    const { buildGlossary } = await import("@/core/glossary/build");
    await expect(
      buildGlossary(texts, async () => { throw new Error("all down"); }, {
        sourceLang: "English",
        targetLang: "Simplified Chinese",
        chunkSize: 10,
        concurrency: 2,
      }),
    ).rejects.toThrow("all down");
  });

  it("取消会立刻中止", async () => {
    const { buildGlossary } = await import("@/core/glossary/build");
    const ac = new AbortController();
    const p = buildGlossary(
      texts,
      async () => {
        ac.abort();
        return "[]";
      },
      { sourceLang: "English", targetLang: "Simplified Chinese", chunkSize: 5, concurrency: 1, signal: ac.signal },
    );
    await expect(p).rejects.toThrow(/Aborted/);
  });
});
