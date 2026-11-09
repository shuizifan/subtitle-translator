"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store";
import { useGlossaryBuilder, useTranslator } from "@/lib/useTranslator";
import { useSubtitleLoaderContext } from "@/lib/SubtitleLoaderContext";
import { inspectDocument, QA_LABEL } from "@/core/qa";
import { acceptNewGlossaryEntries, type GlossaryEntry } from "@/core/glossary";
import { useRequestDiagnostics, resetRequestDiagnostics } from "@/lib/requestDiagnostics";

type Section = "glossary" | "qa" | "cleanup" | null;

/**
 * 质量工具条：术语表 / 译文体检 / 源字幕清理。
 * 这三件事都发生在「解析之后、导出之前」，放在表格上方一条里，按需展开。
 */
export function QualityPanel() {
  const [open, setOpen] = useState<Section>(null);
  const glossary = useAppStore((s) => s.glossary);
  const candidates = useAppStore((s) => s.glossaryCandidates);
  const glossaryStatus = useAppStore((s) => s.glossaryStatus);
  const glossaryProgress = useAppStore((s) => s.glossaryProgress);
  const qaFindings = useAppStore((s) => s.qaFindings);
  const qaRan = useAppStore((s) => s.qaRan);
  const cleanupMarks = useAppStore((s) => s.cleanupMarks);
  const phase = useAppStore((s) => s.phase);

  const toggle = (s: Section) => setOpen((cur) => (cur === s ? null : s));

  const chip = (key: Exclude<Section, null>, label: string, badge: string, tone: string) => (
    <button
      key={key}
      type="button"
      aria-expanded={open === key}
      onClick={() => toggle(key)}
      className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
        open === key
          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
          : "border-slate-300 text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
      }`}
    >
      <span>{label}</span>
      <span className={open === key ? "opacity-80" : tone}>{badge}</span>
    </button>
  );

  return (
    <div className="workspace-shell pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {chip(
          "glossary",
          "术语表",
          glossaryStatus === "building"
            ? glossaryProgress && glossaryProgress.total > 0
              ? `生成中 ${glossaryProgress.done}/${glossaryProgress.total} 批`
              : "扫描中…"
            : candidates.length > 0
              ? `${candidates.length} 条待审核`
              : glossary.length > 0
              ? `${glossary.length} 条`
              : "未生成",
          glossaryStatus === "building"
            ? "animate-pulse text-blue-500"
            : glossary.length > 0
              ? "text-emerald-600"
              : "text-slate-400",
        )}
        {chip(
          "qa",
          "译文体检",
          qaRan ? (qaFindings.length > 0 ? `${qaFindings.length} 条可疑` : "全部通过") : "未检查",
          qaFindings.length > 0 ? "text-amber-600" : "text-slate-400",
        )}
        {chip(
          "cleanup",
          "源字幕清理",
          cleanupMarks.length > 0 ? `${cleanupMarks.length} 条` : "无",
          cleanupMarks.length > 0 ? "text-sky-600" : "text-slate-400",
        )}
        {phase === "translating" && <span className="text-xs text-slate-400">翻译进行中，工具暂不可用</span>}
      </div>

      {open === "glossary" && <GlossarySection />}
      {open === "qa" && <QaSection />}
      {open === "cleanup" && <CleanupSection />}
      <RequestDiagnostics />
    </div>
  );
}

function RequestDiagnostics() {
  const d = useRequestDiagnostics();
  const busy = useAppStore((s) => s.phase === "translating" || s.queueRunning || s.glossaryStatus === "building");
  if (!d.requests) return null;
  return <details className="mt-2 text-xs text-slate-500 dark:text-slate-400">
    <summary className="cursor-pointer">本页累计请求诊断 · {d.requests} 次尝试 · {d.failedRequests} 次异常</summary>
    <p className="mt-2">已知输入 {d.promptTokens} token · 已知输出 {d.completionTokens} token（其中已知推理 {d.reasoningTokens}）· {d.unknownUsageRequests} 次用量未知。未提供价格，不估算费用。</p>
    <p>记录浏览器调用尝试（含本地校验失败）；代理参数兼容重发不单独计数。推理量属于输出量，不重复相加。</p>
    <button className="mt-1 underline" disabled={busy} onClick={resetRequestDiagnostics}>清空本页诊断统计</button>
    {d.last && <><p>最近响应：{d.last.finishReason ?? "未提供完成原因"} · {d.last.durationMs ?? "未知"} ms · 请求 ID：{d.last.requestId ?? "未提供"}</p>
      <pre className="mt-1 overflow-auto whitespace-pre-wrap">{JSON.stringify(d.last.sentParameters, null, 2)}</pre></>}
  </details>;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
      {children}
    </div>
  );
}

/** 生成用时（秒）——长片要几十秒，没有计时很难判断是在跑还是卡住。 */
function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);
  return elapsed;
}

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 align-[-2px] dark:border-slate-600 dark:border-t-slate-200" />
  );
}

function GlossarySection() {
  const glossary = useAppStore((s) => s.glossary);
  const candidates = useAppStore((s) => s.glossaryCandidates);
  const setCandidates = useAppStore((s) => s.setGlossaryCandidates);
  const document = useAppStore((s) => s.document);
  const queueRunning = useAppStore((s) => s.queueRunning);
  const status = useAppStore((s) => s.glossaryStatus);
  const progress = useAppStore((s) => s.glossaryProgress);
  const error = useAppStore((s) => s.glossaryError);
  const setGlossary = useAppStore((s) => s.setGlossary);
  const useGlossary = useAppStore((s) => s.params.useGlossary);
  const setParams = useAppStore((s) => s.setParams);
  const phase = useAppStore((s) => s.phase);
  const { build, cancel } = useGlossaryBuilder();
  const elapsed = useElapsed(status === "building");
  const locked = phase === "translating" || queueRunning || status === "building";

  const update = (i: number, p: Partial<GlossaryEntry>) =>
    setGlossary(glossary.map((e, idx) => (idx === i ? { ...e, ...p } : e)));
  const remove = (i: number) => setGlossary(glossary.filter((_, idx) => idx !== i));
  const add = () => setGlossary([...glossary, { term: "", translation: "" }]);

  return (
    <Card>
      <p className="text-slate-500 dark:text-slate-400">
        已确认的词条用于当前文件的翻译。生成会额外调用模型，可能分成多次请求；结果先进入候选区，
        <strong>审核后才生效</strong>，重新生成不会覆盖人工词条。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {status === "building" && queueRunning ? <span className="text-xs text-slate-500">批量生成中，可在队列点击“停止批量”</span> : status === "building" ? (
          <button className="btn-secondary" onClick={cancel}>
            取消生成
          </button>
        ) : (
          <button className="btn-primary" onClick={build} disabled={locked}>
            {candidates.length > 0 ? "重新生成候选" : "生成术语候选"}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={useGlossary} disabled={locked} onChange={(e) => setParams({ useGlossary: e.target.checked })} />
          翻译时使用术语表
        </label>
        {glossary.length > 0 && (
          <button className="text-xs text-slate-400 hover:underline" disabled={locked} onClick={() => setGlossary([])}>
            清空
          </button>
        )}
      </div>

      {status === "building" && (
        <div className="mt-3 space-y-2">
          <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <Spinner />
            {progress && progress.phase === "requesting" && progress.total > 0 ? (
              <span>
                已抽出 <strong>{progress.candidates}</strong> 个专名候选，正在请求模型（第 {Math.min(progress.done + 1, progress.total)}/
                {progress.total} 批）· 候选 <strong>{progress.terms}</strong> 条 · 已用时 {elapsed}s
              </span>
            ) : (
              <span>正在扫描全片专名…（已用时 {elapsed}s）</span>
            )}
          </p>
          {progress && progress.total > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          )}
          <p className="text-xs text-slate-400">
            思考模式开启时单批可能要十几秒；生成好的条目会随时出现在下方，不必等全部完成。
          </p>
        </div>
      )}
      {error && <p className="mt-3 text-amber-600">{error}</p>}

      {candidates.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 p-3 dark:border-amber-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm">待审核候选 · 仅当前文件</strong>
            <button className="btn-secondary" disabled={locked} onClick={() => {
              const accepted = acceptNewGlossaryEntries(glossary, candidates);
              const existing = new Set(glossary.map((e) => e.term.trim().toLocaleLowerCase()));
              setGlossary(accepted);
              setCandidates(candidates.filter((e) => existing.has(e.term.trim().toLocaleLowerCase())));
            }}>接受全部新词（保留冲突）</button>
            <button className="text-xs text-slate-500 hover:underline" disabled={locked} onClick={() => setCandidates([])}>忽略全部候选</button>
          </div>
          <div className="mt-2 max-h-72 space-y-2 overflow-auto">
            {candidates.map((candidate, i) => {
              const existingIndex = glossary.findIndex((e) => e.term.trim().toLocaleLowerCase() === candidate.term.trim().toLocaleLowerCase());
              const existing = glossary[existingIndex];
              const evidence = document?.entries.filter((e) => e.originalText.toLocaleLowerCase().includes(candidate.term.toLocaleLowerCase())).slice(0, 2) ?? [];
              return <div key={`${candidate.term}-${i}`} className="rounded border border-slate-200 p-2 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{candidate.term}</span><span>→ {candidate.translation}</span>
                  {existing && <span className="text-xs text-amber-700 dark:text-amber-400">已确认：{existing.translation}</span>}
                  <button className="btn-secondary" disabled={locked} onClick={() => {
                    if (existing) setGlossary(glossary.map((e, index) => index === existingIndex ? { ...candidate } : e));
                    else setGlossary(acceptNewGlossaryEntries(glossary, [candidate]));
                    setCandidates(candidates.filter((_, index) => index !== i));
                  }}>{existing ? "用此候选替换" : "接受"}</button>
                  <button className="text-xs text-slate-500 hover:underline" disabled={locked} onClick={() => setCandidates(candidates.filter((_, index) => index !== i))}>{existing ? "保留已确认词条" : "忽略"}</button>
                </div>
                {evidence.map((e) => <p key={e.id} className="mt-1 text-xs text-slate-500">原文 #{e.id}：{e.originalText.slice(0, 180)}</p>)}
                {evidence.length === 0 && <p className="mt-1 text-xs text-amber-600">未找到直接匹配原文，请先核实再接受。</p>}
              </div>;
            })}
          </div>
        </div>
      )}

      {glossary.length > 0 && (
        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          {glossary.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-slate-100 px-2 py-1.5 last:border-0 dark:border-slate-700/60">
              <input
                className="rounded border border-transparent bg-transparent px-1.5 py-1 font-mono text-xs text-slate-700 hover:border-slate-200 focus:border-slate-400 focus:outline-none dark:text-slate-300 dark:hover:border-slate-600"
                value={e.term}
                disabled={locked}
                placeholder="原文"
                onChange={(ev) => update(i, { term: ev.target.value })}
              />
              <input
                className="rounded border border-transparent bg-transparent px-1.5 py-1 text-slate-900 hover:border-slate-200 focus:border-slate-400 focus:outline-none dark:text-slate-100 dark:hover:border-slate-600"
                value={e.translation}
                disabled={locked}
                placeholder="统一译名"
                onChange={(ev) => update(i, { translation: ev.target.value })}
              />
              <button className="px-1 text-xs text-slate-400 hover:text-red-500" disabled={locked} onClick={() => remove(i)} aria-label="删除">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="mt-2 text-xs text-slate-500 hover:underline dark:text-slate-400" disabled={locked} onClick={add}>
        + 手动添加一条
      </button>
    </Card>
  );
}

function QaSection() {
  const busy = useAppStore((s) => s.phase === "translating" || s.queueRunning || s.glossaryStatus === "building");
  const findings = useAppStore((s) => s.qaFindings);
  const ran = useAppStore((s) => s.qaRan);
  const setQaFindings = useAppStore((s) => s.setQaFindings);
  const targetLang = useAppStore((s) => s.params.targetLang);
  const phase = useAppStore((s) => s.phase);
  useAppStore((s) => s.docVersion);
  const { retranslate } = useTranslator();

  const [hint, setHint] = useState<string | null>(null);

  const run = () => {
    const doc = useAppStore.getState().document;
    if (!doc) return;
    // 一条译文都没有时跑体检只会把整篇标成「未翻译」，没有意义
    const translated = doc.entries.filter((e) => e.translatedText).length;
    if (translated === 0) {
      setHint("还没有任何译文，先翻译再来体检。");
      return;
    }
    setHint(null);
    setQaFindings(inspectDocument(doc, targetLang));
  };

  const counts = new Map<string, number>();
  for (const f of findings) for (const c of f.codes) counts.set(c, (counts.get(c) ?? 0) + 1);

  return (
    <Card>
      <p className="text-slate-500 dark:text-slate-400">
        导出前的机械校验：只要模型返回了非空字符串就算「已翻译」，但「原样返回原文」「目标是中文却一个汉字都没有」
        这类问题会一路混到成品里。命中的条目会在下方表格中标黄。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={run} disabled={busy}>
          {ran ? "重新体检" : "开始体检"}
        </button>
        {findings.length > 0 && (
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => retranslate(findings.map((f) => f.id))}
          >
            重译这 {findings.length} 条
          </button>
        )}
      </div>

      {hint && <p className="mt-3 text-amber-600">{hint}</p>}
      {!hint && ran && findings.length === 0 && <p className="mt-3 text-emerald-600">没有发现可疑条目。</p>}
      {findings.length > 0 && (
        <>
          <ul className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
            {[...counts.entries()].map(([code, n]) => (
              <li key={code}>
                {QA_LABEL[code as keyof typeof QA_LABEL]}：<strong>{n}</strong>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            条目：{findings.slice(0, 40).map((f) => f.id).join("、")}
            {findings.length > 40 ? " …" : ""}
          </p>
        </>
      )}
    </Card>
  );
}

function CleanupSection() {
  const busy = useAppStore((s) => s.phase === "translating" || s.queueRunning || s.glossaryStatus === "building");
  const marks = useAppStore((s) => s.cleanupMarks);
  const cleanup = useAppStore((s) => s.cleanup);
  const setCleanup = useAppStore((s) => s.setCleanup);
  const restoreExcluded = useAppStore((s) => s.restoreExcluded);
  const { reparse, hasBytes } = useSubtitleLoaderContext();
  useAppStore((s) => s.docVersion);

  const option = (key: keyof typeof cleanup, label: string) => (
    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
      <input
        type="checkbox"
        checked={cleanup[key]}
        disabled={busy}
        onChange={(e) => {
          setCleanup({ [key]: e.target.checked });
          if (hasBytes) reparse();
        }}
      />
      {label}
    </label>
  );

  const dropped = marks.filter((m) => m.action === "drop");

  return (
    <Card>
      <p className="text-slate-500 dark:text-slate-400">
        字幕文件里混着非台词内容：压制组问候语、字幕站水印、音符丢失后剩下的 <code>**</code>、
        用半角 <code>?</code> 冒充 ♪ 的歌词。这些送去翻译既花钱，译文里还会多出垃圾条目。
        被剔除的条目在表格中标灰，可单条恢复。
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {option("removeWatermarks", "剔除压制组/字幕站署名")}
        {option("removeSymbolOnly", "剔除纯符号占位条")}
        {option("fixMusicNotes", "半角 ? 还原为音符 ♪")}
        {option("stripFontTags", "剥离 <font> 字体/字号")}
      </div>
      <p className="mt-2 text-xs text-slate-400">改动选项会按新设置重新解析当前文件（已有译文会清空）。</p>

      {marks.length > 0 && (
        <div className="mt-3 max-h-60 overflow-auto rounded-lg border border-slate-200 text-xs dark:border-slate-700">
          {marks.map((m) => (
            <div key={`${m.id}-${m.action}`} className="flex items-start gap-2 border-b border-slate-100 px-2 py-1.5 last:border-0 dark:border-slate-700/60">
              <span className="w-10 shrink-0 font-mono text-slate-400">#{m.id}</span>
              <span className="w-28 shrink-0 text-slate-500 dark:text-slate-400">{m.reason}</span>
              <span className="flex-1 break-all text-slate-600 line-through decoration-slate-300 dark:text-slate-300">
                {m.before.slice(0, 120)}
              </span>
              {m.after && <span className="flex-1 break-all text-slate-900 dark:text-slate-100">{m.after.slice(0, 120)}</span>}
            </div>
          ))}
        </div>
      )}

      {dropped.length > 0 && (
        <button className="mt-2 text-xs text-slate-500 hover:underline dark:text-slate-400" disabled={busy} onClick={() => restoreExcluded()}>
          全部恢复（{dropped.length} 条重新参与翻译与导出）
        </button>
      )}
      {marks.length === 0 && <p className="mt-3 text-slate-400">这份字幕没有识别到需要清理的内容。</p>}
    </Card>
  );
}
