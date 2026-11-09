"use client";

import { getActiveProfile, useAppStore } from "@/store";
import { useTranslator } from "@/lib/useTranslator";

const SOURCE_LANGS = [
  { value: "auto", label: "自动检测" },
  { value: "English", label: "英语" },
  { value: "German", label: "德语" },
  { value: "Japanese", label: "日语" },
  { value: "Korean", label: "韩语" },
  { value: "French", label: "法语" },
  { value: "Spanish", label: "西班牙语" },
  { value: "Russian", label: "俄语" },
  { value: "Italian", label: "意大利语" },
  { value: "Portuguese", label: "葡萄牙语" },
  { value: "Dutch", label: "荷兰语" },
  { value: "Swedish", label: "瑞典语" },
  { value: "Polish", label: "波兰语" },
  { value: "Czech", label: "捷克语" },
  { value: "Turkish", label: "土耳其语" },
  { value: "Arabic", label: "阿拉伯语" },
  { value: "Greek", label: "希腊语" },
  { value: "Hebrew", label: "希伯来语" },
  { value: "Thai", label: "泰语" },
  { value: "Chinese", label: "中文" },
];

const TARGET_LANGS = [
  { value: "Simplified Chinese", label: "简体中文" },
  { value: "Traditional Chinese", label: "繁体中文" },
  { value: "English", label: "英语" },
  { value: "Japanese", label: "日语" },
  { value: "Korean", label: "韩语" },
];

export function ControlBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const profiles = useAppStore((s) => s.apiProfiles);
  const activeId = useAppStore((s) => s.activeProfileId);
  const selectProfile = useAppStore((s) => s.selectProfile);
  const params = useAppStore((s) => s.params);
  const setSourceLang = useAppStore((s) => s.setSourceLang);
  const setTargetLang = useAppStore((s) => s.setTargetLang);
  const phase = useAppStore((s) => s.phase);
  const queueRunning = useAppStore((s) => s.queueRunning);
  const glossaryBuilding = useAppStore((s) => s.glossaryStatus === "building");
  const document = useAppStore((s) => s.document);
  useAppStore((s) => s.docVersion);

  const { start, cancel, error } = useTranslator();
  const active = useAppStore(getActiveProfile);

  const remaining =
    document?.entries.filter(
      (e) => e.originalText.trim() !== "" && (e.translatedText == null || e.translatedText === ""),
    ).length ?? 0;

  const canTranslate = !!active && !!active.baseURL && !!active.apiKey.trim() && !!active.model && remaining > 0 && !queueRunning && !glossaryBuilding;

  return (
    <div className="border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="workspace-shell grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 py-2.5 min-[800px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:flex lg:min-h-14 lg:items-center lg:gap-5 lg:py-2">
      {/* 翻译服务 */}
      <div className="min-w-0 lg:flex lg:w-[min(36%,380px)] lg:items-center lg:gap-2">
        <label htmlFor="translation-service" className="mb-1.5 block shrink-0 text-xs text-slate-500 lg:mb-0 dark:text-slate-400">翻译服务</label>
        {profiles.length > 0 ? (
          <select
            className="input min-w-0 truncate lg:py-1.5"
            id="translation-service"
            disabled={phase === "translating" || queueRunning}
            value={activeId ?? ""}
            onChange={(e) => selectProfile(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.model ? ` · ${p.model}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <button type="button" className="w-full rounded-lg border border-dashed border-slate-400 px-2 py-2 text-sm text-slate-500 dark:border-slate-500 dark:text-slate-400" onClick={onOpenSettings}>
            + 添加服务
          </button>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-end min-[800px]:col-start-4 min-[800px]:row-start-1 lg:order-last lg:ml-auto">
        {phase === "translating" ? (
          <button type="button" className="btn-secondary whitespace-nowrap" onClick={cancel}>
            停止翻译
          </button>
        ) : (
          <button type="button" className="btn-primary whitespace-nowrap" onClick={start} disabled={!canTranslate}>
            {phase === "done" || phase === "parsed"
              ? remaining > 0
                ? phase === "done"
                  ? "继续翻译"
                  : "开始翻译"
                : "已全部翻译"
              : "开始翻译"}
          </button>
        )}
      </div>

      <div className="col-span-2 grid grid-cols-2 gap-3 min-[800px]:contents">
      {/* 原始语言 */}
      <div className="min-[800px]:col-start-2 min-[800px]:row-start-1 min-w-0 lg:flex lg:w-[210px] lg:items-center lg:gap-2">
        <label htmlFor="source-language" className="mb-1.5 block shrink-0 text-xs text-slate-500 lg:mb-0 dark:text-slate-400">原文语言</label>
        <select
          className="input min-w-0 truncate lg:py-1.5"
          id="source-language"
          disabled={phase === "translating" || queueRunning}
          value={params.sourceLang}
          onChange={(e) => setSourceLang(e.target.value)}
        >
          {SOURCE_LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>

      </div>

      {/* 目标语言 */}
      <div className="min-[800px]:col-start-3 min-[800px]:row-start-1 min-w-0 lg:flex lg:w-[210px] lg:items-center lg:gap-2">
        <label htmlFor="target-language" className="mb-1.5 block shrink-0 text-xs text-slate-500 lg:mb-0 dark:text-slate-400">译文语言</label>
        <select
          className="input min-w-0 truncate lg:py-1.5"
          id="target-language"
          disabled={phase === "translating" || queueRunning}
          value={params.targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
        >
          {TARGET_LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      </div>
      </div>
      {error && <div role="alert" className="workspace-shell pb-2 text-xs text-red-600">{error}</div>}
    </div>
  );
}
