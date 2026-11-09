import { describe, expect, it, vi } from "vitest";
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
  it("失败批次立即发布行号，其他批次尚未完成时也可定位", async () => {
    const doc = makeDoc(2);
    const snapshots: number[][] = [];
    let failuresBeforeSecondBatch: number[][] = [];
    const caller: LlmCaller = async (messages) => {
      const batch = JSON.parse(messages[1].content.split("\n").pop()!) as { id: number }[];
      if (batch[0].id === 1) return "[]";
      failuresBeforeSecondBatch = [...snapshots];
      return '[{"id":2,"text":"二"}]';
    };
    await translateDocument(doc, caller, { ...baseOpts, batchSize: 1, concurrency: 1, maxRetries: 0 }, {
      onFailed: (ids) => snapshots.push(ids),
    });
    expect(snapshots).toEqual([[1]]);
    expect(failuresBeforeSecondBatch).toEqual([[1]]);
  });

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

describe("错误分类与任务边界", () => {
  const idsIn = (messages: Parameters<LlmCaller>[0]) => JSON.parse(messages[1].content.split("\n").pop()!) as {id:number}[];
  it("重复 ID 不提交；保留其余有效条目，仅补异常条", async () => {
    const doc = makeDoc(2); const requests:number[][]=[];
    const result = await translateDocument(doc, async messages => {
      const ids = idsIn(messages).map(item=>item.id); requests.push(ids);
      return requests.length === 1 ? '{"items":[{"id":1,"text":"错"},{"id":1,"text":"也错"},{"id":2,"text":"二"}]}' : '{"items":[{"id":1,"text":"一"}]}';
    }, {...baseOpts,concurrency:1});
    expect(requests).toEqual([[1,2],[1]]);
    expect(result.failedIds).toEqual([]);
    expect(doc.entries.map(e=>e.translatedText)).toEqual(["一","二"]);
    expect(result.validation.duplicateIds).toBe(1);
  });
  it("401 停止整个队列，未发起条目单列未处理", async () => {
    let calls=0;
    const result=await translateDocument(makeDoc(3),async()=>{calls++;throw new LlmError("invalid key",401)}, {...baseOpts,batchSize:1,concurrency:1});
    expect(calls).toBe(1); expect(result.failedIds).toEqual([1]);
    expect(result.unprocessedIds).toEqual([2,3]); expect(result.terminalError).toContain("invalid key");
  });
  it("429 与 503 重试原批，不增加拆分请求", async () => {
    const sizes:number[]=[];
    const result=await translateDocument(makeDoc(4), async messages=>{
      const batch=idsIn(messages); sizes.push(batch.length);
      if(sizes.length===1)throw new LlmError("rate",429);
      if(sizes.length===2)throw new LlmError("unavailable",503);
      return JSON.stringify(batch.map(b=>({id:b.id,text:`T${b.id}`})));
    }, {...baseOpts,concurrency:1});
    expect(sizes).toEqual([4,4,4]);expect(result.failedIds).toEqual([]);
  });
  it("对象响应 length 抢救完整条目，只补未完成内容", async () => {
    const calls:number[][]=[];
    const result=await translateDocument(makeDoc(2), async messages=>{
      const batch=idsIn(messages);calls.push(batch.map(b=>b.id));
      return calls.length===1 ? {content:'{"items":[{"id":1,"text":"一"},{"id":2,"text":"',finishReason:"length"} : {content:'{"items":[{"id":2,"text":"二"}]}',finishReason:"stop"};
    }, {...baseOpts,concurrency:1});
    expect(calls).toEqual([[1,2],[2]]);expect(result.failedIds).toEqual([]);
  });
  it("拒绝不当作译文，也不反复付费重试", async () => {
    let calls=0;const doc=makeDoc(1);
    const result=await translateDocument(doc,async()=>{calls++;return {content:'{"items":[{"id":1,"text":"拒绝"}]}',finishReason:null,refusal:"refused"}},baseOpts);
    expect(calls).toBe(1);expect(doc.entries[0].translatedText).toBeUndefined();expect(result.failedIds).toEqual([1]);
  });
  it("达到请求总上限停止，保留已完成内容",async()=>{
    const doc=makeDoc(3);
    const result=await translateDocument(doc,async messages=>JSON.stringify(idsIn(messages).map(b=>({id:b.id,text:`T${b.id}`}))),{...baseOpts,batchSize:1,concurrency:1,maxRequests:1});
    expect(result.requestCount).toBe(1);expect(result.unprocessedIds).toEqual([2,3]);expect(doc.entries[0].translatedText).toBe("T1");expect(result.terminalError).toContain("调用尝试上限");
  });
  it("取消后等待在途收敛，不再提交迟到的成功响应",async()=>{
    const controller=new AbortController();const doc=makeDoc(2);
    const result=await translateDocument(doc,async()=>{controller.abort();return '[{"id":1,"text":"迟到"}]'}, {...baseOpts,batchSize:1,concurrency:1}, {signal:controller.signal});
    expect(result.cancelled).toBe(true);expect(result.unprocessedIds).toEqual([1,2]);expect(doc.entries[0].translatedText).toBeUndefined();
  });
  it("稀疏恢复按原位置分组，前后上下文都按有效条数",async()=>{
    const doc=makeDoc(7);doc.entries[1].excluded=true;doc.entries[3].translatedText="已有";
    const prompts:string[]=[];
    await translateDocument(doc,async messages=>{prompts.push(messages[1].content);return JSON.stringify(idsIn(messages).map(b=>({id:b.id,text:`T${b.id}`})))}, {...baseOpts,concurrency:1,contextLines:2,trailingContextLines:2});
    const targets=prompts.map(p=>JSON.parse(p.split("\n").pop()!) as {id:number}[]);
    expect(targets.map(p=>p.map(b=>b.id))).toEqual([[1],[3],[5,6,7]]);
    expect(prompts[2]).toContain('[{"id":3,"text":"line 3"},{"id":4,"text":"line 4"}]');
    expect(prompts[0]).toContain('[{"id":3,"text":"line 3"},{"id":4,"text":"line 4"}]');
  });
});

describe("限流与在途收敛",()=>{
  it("未显式设置上限时按初始批数限制调用尝试",async()=>{
    vi.useFakeTimers();
    try{
      const promise=translateDocument(makeDoc(1),async()=>"[]",{...baseOpts,maxRetries:99});
      await vi.runAllTimersAsync();
      const result=await promise;
      expect(result.requestCount).toBe(14);
      expect(result.terminalError).toContain("14 次调用尝试上限");
      expect(result.unprocessedIds).toEqual([1]);
    }finally{vi.useRealTimers();}
  });
  it("Retry-After 期间不发新请求并降低并发",async()=>{
    vi.useFakeTimers();
    try{
      const starts:number[]=[];let calls=0;
      const promise=translateDocument(makeDoc(2),async messages=>{
        starts.push(Date.now());calls++;
        if(calls===1)throw new LlmError("rate",429,"http",2000);
        const batch=JSON.parse(messages[1].content.split("\n").pop()!) as {id:number}[];
        return JSON.stringify(batch.map(b=>({id:b.id,text:`T${b.id}`})));
      },{...baseOpts,batchSize:1,concurrency:1});
      await vi.advanceTimersByTimeAsync(1999);expect(calls).toBe(1);
      await vi.runAllTimersAsync();const result=await promise;
      expect(starts[1]-starts[0]).toBeGreaterThanOrEqual(2000);expect(result.failedIds).toEqual([]);
    }finally{vi.useRealTimers();}
  });
  it("认证终止取消并等待其他在途请求结束",async()=>{
    let active=0;let finished=0;
    const result=await translateDocument(makeDoc(4),async(messages,signal)=>{
      const batch=JSON.parse(messages[1].content.split("\n").pop()!) as {id:number}[];
      active++;
      try{
        if(batch[0].id===1){await Promise.resolve();throw new LlmError("unauthorized",401);}
        await new Promise<void>((resolve,reject)=>{
          if(signal?.aborted)return reject(new DOMException("Aborted","AbortError"));
          signal?.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
        });
        return "[]";
      }finally{active--;finished++;}
    },{...baseOpts,batchSize:1,concurrency:2});
    expect(active).toBe(0);expect(finished).toBe(2);expect(result.requestCount).toBe(2);
    expect(result.failedIds).toEqual([1]);expect(result.unprocessedIds).toEqual([2,3,4]);
  });
  it("客户端抛出的截断结果仍可抢救",async()=>{
    const seen:number[][]=[];
    const result=await translateDocument(makeDoc(3),async messages=>{
      const batch=JSON.parse(messages[1].content.split("\n").pop()!) as {id:number}[];
      seen.push(batch.map(b=>b.id));
      if(seen.length===1)throw new LlmError("truncated",502,"truncated",undefined,{content:'{"items":[{"id":1,"text":"一"},{"id":2,"text":"',finishReason:"length"});
      return JSON.stringify(batch.map(b=>({id:b.id,text:`T${b.id}`})));
    },{...baseOpts,concurrency:1});
    expect(seen).toEqual([[1,2,3],[2],[3]]);expect(result.failedIds).toEqual([]);
  });
  it("预算错误缩批，不中止其他条目",async()=>{
    const seen:number[][]=[];
    const result=await translateDocument(makeDoc(2),async messages=>{
      const batch=JSON.parse(messages[1].content.split("\n").pop()!) as {id:number}[];
      seen.push(batch.map(b=>b.id));
      if(batch.length>1)throw new LlmError("budget",400,"budget");
      return JSON.stringify(batch.map(b=>({id:b.id,text:`T${b.id}`})));
    },{...baseOpts,concurrency:1});
    expect(seen).toEqual([[1,2],[1],[2]]);expect(result.terminalError).toBeUndefined();expect(result.failedIds).toEqual([]);
  });
});


describe("限流后的并发恢复", () => {
  it("冷却后从减半容量逐步恢复，第二次限流后仍能恢复且不超过配置", async () => {
    vi.useFakeTimers();
    try {
      let running = 0;
      let calls = 0;
      let phase = 0;
      const starts: { time: number; running: number; phase: number }[] = [];
      const limits: number[] = [];
      const promise = translateDocument(makeDoc(100), async (_messages, _signal, options) => {
        const number = ++calls;
        running++;
        starts.push({ time: Date.now(), running, phase });
        try {
          // One early 429 while five old requests remain in flight; another once
          // the recovered pool is busy. Old successes must not undo the decrease.
          await new Promise(resolve => setTimeout(resolve, number === 1 || number === 35 ? 20 : 100));
          if (number === 1 || number === 35) {
            phase++;
            limits.push(Date.now());
            throw new LlmError("rate limited", 429, "http", 1000);
          }
          return JSON.stringify(options!.targetItems!.map(item => ({ id: item.id, text: `译${item.id}` })));
        } finally { running--; }
      }, { ...baseOpts, batchSize: 1, concurrency: 6 });
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.failedIds).toEqual([]);
      expect(result.requestCount).toBe(102);
      expect(limits).toHaveLength(2);
      for (const phaseNumber of [1, 2]) {
        const afterLimit = starts.filter(start => start.phase === phaseNumber);
        const firstTime = afterLimit[0].time;
        expect(firstTime - limits[phaseNumber - 1]).toBeGreaterThanOrEqual(1000);
        expect(Math.max(...afterLimit.filter(start => start.time === firstTime).map(start => start.running))).toBe(3);
        expect(Math.max(...afterLimit.map(start => start.running))).toBe(6);
        expect(afterLimit.every(start => start.running <= 6)).toBe(true);
      }
    } finally { vi.useRealTimers(); }
  });

  it("冷却期间取消会退出全部等待者，不启动新的调用", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let calls = 0;
      const promise = translateDocument(makeDoc(30), async (_messages, _signal, options) => {
        const number = ++calls;
        await new Promise(resolve => setTimeout(resolve, 20));
        if (number === 1) throw new LlmError("rate limited", 429, "http", 5000);
        return JSON.stringify(options!.targetItems!.map(item => ({ id: item.id, text: `译${item.id}` })));
      }, { ...baseOpts, batchSize: 1, concurrency: 6 }, { signal: controller.signal });
      await vi.advanceTimersByTimeAsync(100);
      expect(calls).toBe(6);
      controller.abort();
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.cancelled).toBe(true);
      expect(calls).toBe(6);
      expect(result.unprocessedIds.length).toBeGreaterThan(0);
    } finally { vi.useRealTimers(); }
  });
});
