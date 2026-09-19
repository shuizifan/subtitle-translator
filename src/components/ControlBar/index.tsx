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
  const detectedLang = useAppStore((s) => s.detectedLang);
  const document = useAppStore((s) => s.document);
  useAppStore((s) => s.docVersion);

  const { start, cancel, error } = useTranslator();
  const active = useAppStore(getActiveProfile);

  const remaining =
    document?.entries.filter(
      (e) => e.originalText.trim() !== "" && (e.translatedText == null || e.translatedText === ""),
    ).length ?? 0;

  const canTranslate = !!active && !!active.baseURL && !!active.apiKey && !!active.model && remaining > 0;

  return (
    <div className="sticky top-14 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
      {/* 翻译服务 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 dark:text-slate-400">翻译服务</span>
        {profiles.length > 0 ? (
          <select
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
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
          <button className="rounded-lg border border-dashed border-slate-400 px-2 py-1.5 text-sm text-slate-500 dark:border-slate-500 dark:text-slate-400" onClick={onOpenSettings}>
            + 添加服务
          </button>
        )}
      </div>

      {/* 原始语言 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 dark:text-slate-400">原始语言</span>
        <select
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          value={params.sourceLang}
          onChange={(e) => setSourceLang(e.target.value)}
        >
          {SOURCE_LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        {detectedLang && detectedLang !== "auto" && detectedLang === params.sourceLang && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400" title="按字幕正文自动判定，可手动改">
            自动判定
          </span>
        )}
      </div>

      {/* 目标语言 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 dark:text-slate-400">目标语言</span>
        <select
          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
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

      <div className="ml-auto flex items-center gap-3">
        {error && <span className="text-xs text-red-600">{error}</span>}
        {phase === "translating" ? (
          <button className="btn-secondary" onClick={cancel}>
            取消
          </button>
        ) : (
          <button className="btn-primary" onClick={start} disabled={!canTranslate}>
            {phase === "done" || phase === "parsed"
              ? remaining > 0
                ? phase === "done"
                  ? `继续翻译（剩 ${remaining}）`
                  : "开始翻译"
                : "已全部翻译"
              : "开始翻译"}
          </button>
        )}
      </div>
    </div>
  );
}
