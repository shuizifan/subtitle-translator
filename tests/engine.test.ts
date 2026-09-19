import { describe, expect, it } from "vitest";
import { chunkByBudget, translateDocument, type EngineOptions } from "@/core/translator/engine";
import { parseTranslationResponse } from "@/core/translator/prompt";
import { LlmError, type LlmCaller } from "@/core/translator/llmClient";
import type { SubtitleDocument } from "@/core/model";

function makeDoc(n: number): SubtitleDocument {
  return {
    taskId: "t",
    sourceFormat: "srt",
    entries: Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      start: i * 1000,
      end: i * 1000 + 900,
      originalText: `line ${i + 1}`,
      tags: [],
    })),
    meta: {},
  };
}

const baseOpts: EngineOptions = {
  sourceLang: "auto",
  targetLang: "Simplified Chinese",
  batchSize: 10,
  concurrency: 2,
  maxRetries: 3,
  contextLines: 0,
};

describe("parseTranslationResponse", () => {
  it("解析 JSON 数组", () => {
    const m = parseTranslationResponse('[{"id":1,"text":"一"},{"id":2,"text":"二"}]');
    expect(m.get(1)).toBe("一");
    expect(m.get(2)).toBe("二");
  });
  it("剥离代码围栏", () => {
    const m = parseTranslationResponse('```json\n[{"id":1,"text":"一"}]\n```');
    expect(m.get(1)).toBe("一");
  });
  it("兼容对象形式", () => {
    const m = parseTranslationResponse('{"1":"一","2":"二"}');
    expect(m.get(1)).toBe("一");
  });

  it("输出被 max_tokens 截断：救回已写完的条目，而不是整批丢弃", () => {
    // 数组没有闭合的 ]，最后一个对象也只写了一半
    const truncated = '[{"id":1,"text":"一"},{"id":2,"text":"二"},{"id":3,"text":"三';
    const m = parseTranslationResponse(truncated);
    expect(m.get(1)).toBe("一");
    expect(m.get(2)).toBe("二");
    expect(m.has(3)).toBe(false);
  });

  it("字符串里有裸换行（模型没转义 \\n）也能解析", () => {
    const m = parseTranslationResponse('[{"id":1,"text":"上一行\n下一行"}]');
    expect(m.get(1)).toBe("上一行\n下一行");
  });
});

describe("翻译引擎", () => {
  it("正常翻译：每条都有译文", async () => {
    const doc = makeDoc(25);
    const caller: LlmCaller = async (messages) => {
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      return JSON.stringify(batch.map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    const res = await translateDocument(doc, caller, baseOpts);
    expect(res.failedIds).toEqual([]);
    expect(doc.entries.every((e) => e.translatedText === `T${e.id}`)).toBe(true);
  });

  it("行对齐：模型漏返某条，仅对缺失项重试后补齐", async () => {
    const doc = makeDoc(5);
    let call = 0;
    const caller: LlmCaller = async (messages) => {
      call++;
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      // 第一次故意漏掉 id=3
      const items = batch
        .filter((b) => !(call === 1 && b.id === 3))
        .map((b) => ({ id: b.id, text: `T${b.id}` }));
      return JSON.stringify(items);
    };
    const opts = { ...baseOpts, batchSize: 5 };
    const res = await translateDocument(doc, caller, opts);
    expect(res.failedIds).toEqual([]);
    expect(doc.entries[2].translatedText).toBe("T3");
    expect(call).toBeGreaterThanOrEqual(2); // 触发了缺失项重试
  });

  it("多次重试仍缺失 → 标记 failedIds，不静默错位", async () => {
    const doc = makeDoc(3);
    const caller: LlmCaller = async (messages) => {
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      // 永远漏掉 id=2
      return JSON.stringify(batch.filter((b) => b.id !== 2).map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    const res = await translateDocument(doc, caller, { ...baseOpts, maxRetries: 2 });
    expect(res.failedIds).toEqual([2]);
    expect(doc.entries[1].translatedText).toBeUndefined();
    expect(doc.entries[0].translatedText).toBe("T1");
  });

  it("429 触发重试后成功", async () => {
    const doc = makeDoc(2);
    let n = 0;
    const caller: LlmCaller = async (messages) => {
      n++;
      if (n === 1) throw new LlmError("rate limited", 429);
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      return JSON.stringify(batch.map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    const res = await translateDocument(doc, caller, { ...baseOpts, batchSize: 2 });
    expect(res.failedIds).toEqual([]);
    expect(doc.entries[0].translatedText).toBe("T1");
  });

  it("断点续传：已翻译的条目不再请求", async () => {
    const doc = makeDoc(4);
    doc.entries[0].translatedText = "已译1";
    doc.entries[1].translatedText = "已译2";
    const seen: number[] = [];
    const caller: LlmCaller = async (messages) => {
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      batch.forEach((b) => seen.push(b.id));
      return JSON.stringify(batch.map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    await translateDocument(doc, caller, { ...baseOpts, batchSize: 10 });
    expect(seen.sort()).toEqual([3, 4]); // 只请求未翻译的
    expect(doc.entries[0].translatedText).toBe("已译1");
  });

  it("整批截断失败后，重试会缩小批量而不是原样重发", async () => {
    const doc = makeDoc(8);
    const sizes: number[] = [];
    const caller: LlmCaller = async (messages) => {
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      sizes.push(batch.length);
      // 模拟 max_tokens 截断：一次要 8 条就被砍断，条数少了才写得完
      if (batch.length > 4) return '[{"id":1,"text":"一"},{"id":2,"text":"二';
      return JSON.stringify(batch.map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    const res = await translateDocument(doc, caller, { ...baseOpts, batchSize: 8, concurrency: 1 });
    expect(sizes[0]).toBe(8);
    expect(Math.max(...sizes.slice(1))).toBeLessThan(8); // 重试确实缩批了
    expect(res.failedIds).toEqual([]);
    expect(doc.entries[7].translatedText).toBe("T8");
  });

  it("鉴权类 4xx 不重试，直接判失败", async () => {
    const doc = makeDoc(2);
    let calls = 0;
    const caller: LlmCaller = async () => {
      calls++;
      throw new LlmError("invalid api key", 401);
    };
    const res = await translateDocument(doc, caller, { ...baseOpts, batchSize: 2 });
    expect(calls).toBe(1);
    expect(res.failedIds).toEqual([1, 2]);
  });

  it("跳过空文本条目", async () => {
    const doc = makeDoc(2);
    doc.entries[0].originalText = "   ";
    const seen: number[] = [];
    const caller: LlmCaller = async (messages) => {
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      batch.forEach((b) => seen.push(b.id));
      return JSON.stringify(batch.map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    await translateDocument(doc, caller, baseOpts);
    expect(seen).toEqual([2]);
  });
  it("跳过清理时排除的非台词条目", async () => {
    const doc = makeDoc(3);
    doc.entries[1].excluded = true;
    const seen: number[] = [];
    const caller: LlmCaller = async (messages) => {
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      batch.forEach((b) => seen.push(b.id));
      return JSON.stringify(batch.map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    await translateDocument(doc, caller, baseOpts);
    expect(seen).toEqual([1, 3]);
    expect(doc.entries[1].translatedText).toBeUndefined();
  });

  it("带上后文上下文（仅参考，不要求翻译）", async () => {
    const doc = makeDoc(9);
    const prompts: string[] = [];
    const caller: LlmCaller = async (messages) => {
      prompts.push(messages[1].content);
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      return JSON.stringify(batch.map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    await translateDocument(doc, caller, {
      ...baseOpts,
      batchSize: 3,
      concurrency: 1,
      contextLines: 2,
      trailingContextLines: 2,
    });
    // 第一批没有前文、但有后文
    expect(prompts[0]).not.toContain("preceding lines");
    expect(prompts[0]).toContain("following lines");
    // 第二批前后文都有
    expect(prompts[1]).toContain("preceding lines");
    expect(prompts[1]).toContain("following lines");
    // 上下文不计入待翻译条目
    const midBatch = JSON.parse(prompts[1].split("\n").pop()!) as { id: number }[];
    expect(midBatch.map((b) => b.id)).toEqual([4, 5, 6]);
    // 最后一批没有后文
    expect(prompts[2]).not.toContain("following lines");
  });

  it("术语表按批筛选后注入 system prompt", async () => {
    const doc = makeDoc(2);
    doc.entries[0].originalText = "Robert, wait!";
    doc.entries[1].originalText = "Nothing here.";
    const systems: string[] = [];
    const caller: LlmCaller = async (messages) => {
      systems.push(messages[0].content);
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      return JSON.stringify(batch.map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    await translateDocument(doc, caller, {
      ...baseOpts,
      batchSize: 1,
      concurrency: 1,
      glossary: [{ term: "Robert", translation: "罗伯特" }],
    });
    expect(systems[0]).toContain("Robert => 罗伯特");
    expect(systems[1]).not.toContain("Robert => 罗伯特");
  });

  it("失败时带回最后一次错误原因", async () => {
    const doc = makeDoc(2);
    const caller: LlmCaller = async () => {
      throw new LlmError("模型只输出了思考、没有输出内容", 502, "reasoning-budget");
    };
    const res = await translateDocument(doc, caller, { ...baseOpts, batchSize: 2, maxRetries: 0 });
    expect(res.failedIds).toEqual([1, 2]);
    expect(res.lastError).toContain("只输出了思考");
  });

  it("按字符数动态分批：长台词自动切小", async () => {
    const doc = makeDoc(4);
    doc.entries[0].originalText = "x".repeat(700);
    doc.entries[1].originalText = "x".repeat(700);
    const sizes: number[] = [];
    const caller: LlmCaller = async (messages) => {
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      sizes.push(batch.length);
      return JSON.stringify(batch.map((b) => ({ id: b.id, text: `T${b.id}` })));
    };
    await translateDocument(doc, caller, { ...baseOpts, batchSize: 10, concurrency: 1, maxCharsPerBatch: 1000 });
    expect(sizes[0]).toBe(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe("chunkByBudget", () => {
  it("条数与字符数双上限，单条超限也自成一批", () => {
    const items = ["a".repeat(30), "b".repeat(30), "c".repeat(200)];
    const out = chunkByBudget(items, 10, 100, (x) => x.length);
    expect(out.map((g) => g.length)).toEqual([2, 1]);
  });
  it("maxChars=0 表示不限，只看条数", () => {
    const out = chunkByBudget([1, 2, 3, 4, 5], 2, 0, () => 1000);
    expect(out.map((g) => g.length)).toEqual([2, 2, 1]);
  });
});
