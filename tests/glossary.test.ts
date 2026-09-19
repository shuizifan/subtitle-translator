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
