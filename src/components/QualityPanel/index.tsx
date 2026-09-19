"use client";

import { useState } from "react";
import { useAppStore } from "@/store";
import { useGlossaryBuilder, useTranslator } from "@/lib/useTranslator";
import { useSubtitleLoaderContext } from "@/lib/SubtitleLoaderContext";
import { inspectDocument, QA_LABEL } from "@/core/qa";
import type { GlossaryEntry } from "@/core/glossary";

type Section = "glossary" | "qa" | "cleanup" | null;

/**
 * 质量工具条：术语表 / 译文体检 / 源字幕清理。
 * 这三件事都发生在「解析之后、导出之前」，放在表格上方一条里，按需展开。
 */
export function QualityPanel() {
  const [open, setOpen] = useState<Section>(null);
  const glossary = useAppStore((s) => s.glossary);
  const glossaryStatus = useAppStore((s) => s.glossaryStatus);
  const qaFindings = useAppStore((s) => s.qaFindings);
  const qaRan = useAppStore((s) => s.qaRan);
  const cleanupMarks = useAppStore((s) => s.cleanupMarks);
  const phase = useAppStore((s) => s.phase);

  const toggle = (s: Section) => setOpen((cur) => (cur === s ? null : s));

  const chip = (key: Exclude<Section, null>, label: string, badge: string, tone: string) => (
    <button
      key={key}
      onClick={() => toggle(key)}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
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
    <div className="mx-auto max-w-5xl px-4 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        {chip(
          "glossary",
          "术语表",
          glossaryStatus === "building" ? "生成中…" : glossary.length > 0 ? `${glossary.length} 条` : "未生成",
          glossary.length > 0 ? "text-emerald-600" : "text-slate-400",
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
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
      {children}
    </div>
  );
}

function GlossarySection() {
  const glossary = useAppStore((s) => s.glossary);
  const status = useAppStore((s) => s.glossaryStatus);
  const error = useAppStore((s) => s.glossaryError);
  const setGlossary = useAppStore((s) => s.setGlossary);
  const useGlossary = useAppStore((s) => s.params.useGlossary);
  const setParams = useAppStore((s) => s.setParams);
  const phase = useAppStore((s) => s.phase);
  const { build, cancel } = useGlossaryBuilder();

  const update = (i: number, p: Partial<GlossaryEntry>) =>
    setGlossary(glossary.map((e, idx) => (idx === i ? { ...e, ...p } : e)));
  const remove = (i: number) => setGlossary(glossary.filter((_, idx) => idx !== i));
  const add = () => setGlossary([...glossary, { term: "", translation: "" }]);

  return (
    <Card>
      <p className="text-slate-500 dark:text-slate-400">
        每批字幕是独立的一次请求，模型无从得知上一批把人名译成了什么，同一个名字常常中英混用。
        先扫全片抽出专名、生成统一译名，翻译时钉进提示词强制遵守——<strong>建议在开始翻译前生成</strong>。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {status === "building" ? (
          <button className="btn-secondary" onClick={cancel}>
            取消生成
          </button>
        ) : (
          <button className="btn-primary" onClick={build} disabled={phase === "translating"}>
            {glossary.length > 0 ? "重新生成术语表" : "生成术语表"}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={useGlossary} onChange={(e) => setParams({ useGlossary: e.target.checked })} />
          翻译时使用术语表
        </label>
        {glossary.length > 0 && (
          <button className="text-xs text-slate-400 hover:underline" onClick={() => setGlossary([])}>
            清空
          </button>
        )}
      </div>

      {status === "building" && <p className="mt-3 text-slate-500">正在扫描全片专名并请求模型…</p>}
      {error && <p className="mt-3 text-amber-600">{error}</p>}

      {glossary.length > 0 && (
        <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          {glossary.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-slate-100 px-2 py-1.5 last:border-0 dark:border-slate-700/60">
              <input
                className="rounded border border-transparent bg-transparent px-1.5 py-1 font-mono text-xs text-slate-700 hover:border-slate-200 focus:border-slate-400 focus:outline-none dark:text-slate-300 dark:hover:border-slate-600"
                value={e.term}
                placeholder="原文"
                onChange={(ev) => update(i, { term: ev.target.value })}
              />
              <input
                className="rounded border border-transparent bg-transparent px-1.5 py-1 text-slate-900 hover:border-slate-200 focus:border-slate-400 focus:outline-none dark:text-slate-100 dark:hover:border-slate-600"
                value={e.translation}
                placeholder="统一译名"
                onChange={(ev) => update(i, { translation: ev.target.value })}
              />
              <button className="px-1 text-xs text-slate-400 hover:text-red-500" onClick={() => remove(i)} aria-label="删除">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="mt-2 text-xs text-slate-500 hover:underline dark:text-slate-400" onClick={add}>
        + 手动添加一条
      </button>
    </Card>
  );
}

function QaSection() {
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
        <button className="btn-primary" onClick={run} disabled={phase === "translating"}>
          {ran ? "重新体检" : "开始体检"}
        </button>
        {findings.length > 0 && (
          <button
            className="btn-secondary"
            disabled={phase === "translating"}
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
        <button className="mt-2 text-xs text-slate-500 hover:underline dark:text-slate-400" onClick={() => restoreExcluded()}>
          全部恢复（{dropped.length} 条重新参与翻译与导出）
        </button>
      )}
      {marks.length === 0 && <p className="mt-3 text-slate-400">这份字幕没有识别到需要清理的内容。</p>}
    </Card>
  );
}
