import { describe, expect, it } from "vitest";
import { translateDocument, type EngineOptions } from "@/core/translator/engine";
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
});
