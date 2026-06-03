"use client";

import { useEffect, useState } from "react";
import {
  newProfile,
  snapshotSettings,
  useAppStore,
  type ApiProfile,
  type BilingualParams,
  type SettingsSnapshot,
  type TranslateParams,
} from "@/store";
import { testConnection } from "@/core/translator/llmClient";
import { DEFAULT_STYLE_PROMPT } from "@/core/translator/prompt";
import { LANGUAGE_CODES, autoDescriptor } from "@/core/naming";
import { COLOR_SCHEMES, type StyleConfig } from "@/core/styling";
import { Tooltip } from "@/components/ui/Tooltip";

type Tab = "service" | "params" | "prompt" | "bilingual";

// 服务预设：选择后同时更新名称 / Base URL / 模型名
const SERVICE_PRESETS = [
  { label: "OpenAI", name: "OpenAI", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", name: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "Moonshot", name: "Moonshot", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { label: "智谱", name: "智谱", baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { label: "Ollama", name: "Ollama", baseURL: "http://localhost:11434/v1", model: "qwen2.5" },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("service");
  const [draft, setDraft] = useState<SettingsSnapshot | null>(null);
  const applySettings = useAppStore((s) => s.applySettings);

  // 打开时从 store 快照一份草稿；编辑只动草稿，保存才写回。
  useEffect(() => {
    if (open) setDraft(snapshotSettings(useAppStore.getState()));
  }, [open]);

  if (!open || !draft) return null;

  const patch = (p: Partial<SettingsSnapshot>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setParams = (p: Partial<TranslateParams>) => patch({ params: { ...draft.params, ...p } });
  const setBilingual = (p: Partial<BilingualParams>) => patch({ bilingual: { ...draft.bilingual, ...p } });
  const setStyle = (p: Partial<StyleConfig>) => patch({ style: { ...draft.style, ...p } });

  const save = () => {
    applySettings(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">设置</h2>
          <button className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-200 px-4 pt-2 dark:border-slate-700">
          {([
            ["service", "翻译服务"],
            ["params", "翻译参数"],
            ["prompt", "高级 · 提示词"],
            ["bilingual", "双语与导出"],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`rounded-t-lg px-3 py-2 text-sm ${
                tab === key
                  ? "border-b-2 border-slate-900 font-medium text-slate-900 dark:border-slate-100 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-auto p-5">
          {tab === "service" && <ServiceTab draft={draft} patch={patch} />}
          {tab === "params" && <ParamsTab params={draft.params} setParams={setParams} />}
          {tab === "prompt" && <PromptTab params={draft.params} setParams={setParams} />}
          {tab === "bilingual" && (
            <BilingualTab bilingual={draft.bilingual} setBilingual={setBilingual} style={draft.style} setStyle={setStyle} params={draft.params} />
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <span className="mr-auto text-xs text-slate-400">修改后需点「保存」才生效</span>
          <button className="btn-secondary" onClick={onClose}>
            关闭
          </button>
          <button className="btn-primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function ServiceTab({
  draft,
  patch,
}: {
  draft: SettingsSnapshot;
  patch: (p: Partial<SettingsSnapshot>) => void;
}) {
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string } | "loading">>({});

  const updateProfile = (id: string, p: Partial<ApiProfile>) =>
    patch({ apiProfiles: draft.apiProfiles.map((x) => (x.id === id ? { ...x, ...p } : x)) });

  const addProfile = () => {
    const np = newProfile({ name: `服务 ${draft.apiProfiles.length + 1}` });
    patch({ apiProfiles: [...draft.apiProfiles, np], activeProfileId: draft.activeProfileId ?? np.id });
  };

  const removeProfile = (id: string) => {
    const left = draft.apiProfiles.filter((x) => x.id !== id);
    patch({ apiProfiles: left, activeProfileId: draft.activeProfileId === id ? (left[0]?.id ?? null) : draft.activeProfileId });
  };

  const test = async (p: ApiProfile) => {
    setResults((r) => ({ ...r, [p.id]: "loading" }));
    const res = await testConnection({ baseURL: p.baseURL, apiKey: p.apiKey, model: p.model });
    setResults((r) => ({ ...r, [p.id]: res }));
  };

  return (
    <div className="space-y-4">
      {draft.apiProfiles.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">还没有翻译服务。添加一个 OpenAI 兼容服务（DeepSeek / Kimi / OpenAI / 本地 Ollama 等）。</p>
      )}

      {draft.apiProfiles.map((p) => (
        <div
          key={p.id}
          className={`rounded-xl border p-4 ${
            draft.activeProfileId === p.id ? "border-slate-900 dark:border-slate-100" : "border-slate-200 dark:border-slate-700"
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm dark:text-slate-200">
              <input type="radio" checked={draft.activeProfileId === p.id} onChange={() => patch({ activeProfileId: p.id })} />
              <span className="font-medium">使用此服务</span>
            </label>
            <button className="text-xs text-red-500 hover:underline" onClick={() => removeProfile(p.id)}>
              删除
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {SERVICE_PRESETS.map((sp) => (
              <button
                key={sp.label}
                className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                onClick={() => updateProfile(p.id, { name: sp.name, baseURL: sp.baseURL, model: sp.model })}
              >
                {sp.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">名称</label>
              <input className="input" value={p.name} onChange={(e) => updateProfile(p.id, { name: e.target.value })} />
            </div>
            <div>
              <label className="label">模型名</label>
              <input className="input" placeholder="gpt-4o-mini / deepseek-chat" value={p.model} onChange={(e) => updateProfile(p.id, { model: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Base URL</label>
              <input className="input" placeholder="https://api.deepseek.com/v1" value={p.baseURL} onChange={(e) => updateProfile(p.id, { baseURL: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">API Key</label>
              <input className="input" type="password" placeholder="sk-..." value={p.apiKey} onChange={(e) => updateProfile(p.id, { apiKey: e.target.value })} />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button className="btn-secondary" onClick={() => test(p)} disabled={!p.baseURL || !p.apiKey || !p.model || results[p.id] === "loading"}>
              {results[p.id] === "loading" ? "测试中…" : "测试连接"}
            </button>
            {results[p.id] && results[p.id] !== "loading" && (
              <span className={`text-sm ${(results[p.id] as any).ok ? "text-green-600" : "text-red-600"}`}>{(results[p.id] as any).message}</span>
            )}
          </div>
        </div>
      ))}

      <button className="btn-secondary" onClick={addProfile}>
        + 添加服务
      </button>
      <p className="text-xs text-slate-400">密钥仅存本浏览器 localStorage，经转发路由穿透，不写进源码、不打进前端包。</p>
    </div>
  );
}

function ParamsTab({ params, setParams }: { params: TranslateParams; setParams: (p: Partial<TranslateParams>) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Num label="请求最大段落数" hint="每次请求发给模型的字幕条数（batch size）。越大越省请求，但越易触发行错位。" value={params.batchSize} min={1} max={100} onChange={(v) => setParams({ batchSize: v })} />
        <Num label="温度 temperature" value={params.temperature} min={0} max={2} step={0.1} onChange={(v) => setParams({ temperature: v })} />
        <Num label="并发请求数" hint="同时进行的请求数。提高可加快整体速度，但受模型供应商限流约束。" value={params.concurrency} min={1} max={20} onChange={(v) => setParams({ concurrency: v })} />
        <Num label="最大重试次数" value={params.maxRetries} min={0} max={6} onChange={(v) => setParams({ maxRetries: v })} />
        <Num label="上下文参考条数" hint="额外携带前文几条作为参考（不翻译），提升连贯性；0 表示不带，速度更快。" value={params.contextLines} min={0} max={5} onChange={(v) => setParams({ contextLines: v })} />
        <Num label="max tokens" value={params.maxTokens} min={256} max={32000} step={256} onChange={(v) => setParams({ maxTokens: v })} />
      </div>
      <div>
        <label className="label">自定义风格指令（追加，可选）</label>
        <textarea className="input min-h-[60px]" placeholder="如：口语化、保留专有名词原文、医学术语用规范译名…" value={params.customStyle} onChange={(e) => setParams({ customStyle: e.target.value })} />
      </div>
    </div>
  );
}

function PromptTab({ params, setParams }: { params: TranslateParams; setParams: (p: Partial<TranslateParams>) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        系统提示词模板（可用占位符 <code>{"{{to}}"}</code> 目标语言、<code>{"{{from}}"}</code> 源语言）。
        引擎会在其后自动追加 JSON 行对齐协议，故随意修改风格也不会破坏对齐。
      </p>
      <textarea className="input min-h-[220px] font-mono text-xs" value={params.systemPrompt} onChange={(e) => setParams({ systemPrompt: e.target.value })} />
      <button className="btn-secondary" onClick={() => setParams({ systemPrompt: DEFAULT_STYLE_PROMPT })}>
        恢复默认
      </button>
    </div>
  );
}

function BilingualTab({
  bilingual,
  setBilingual,
  style,
  setStyle,
  params,
}: {
  bilingual: BilingualParams;
  setBilingual: (p: Partial<BilingualParams>) => void;
  style: StyleConfig;
  setStyle: (p: Partial<StyleConfig>) => void;
  params: TranslateParams;
}) {
  const applyScheme = (name: string) => {
    const sc = COLOR_SCHEMES.find((s) => s.name === name);
    if (!sc) return;
    setStyle({ scheme: sc.name, enableSrtColor: sc.enableSrtColor, original: { ...sc.original }, translation: { ...sc.translation } });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label flex items-center gap-1.5">
          双语布局
          <Tooltip content={"单轨：译文与原文写在同一条字幕的两行里。\n\n双轨：译文与原文拆成两条字幕、共用同一时间轴，如：\n00:00:00 → 00:00:03  译文…\n00:00:00 → 00:00:03  原文…"} />
        </label>
        <select className="input" value={bilingual.layout} onChange={(e) => setBilingual({ layout: e.target.value as any })}>
          <option value="dual-entry">双轨（两条字幕，同一时间轴）</option>
          <option value="single-entry">单轨（一条字幕，两行）</option>
          <option value="translated-only">仅译文</option>
        </select>
      </div>

      <div>
        <label className="label">语言顺序</label>
        <select className="input" value={bilingual.order} disabled={bilingual.layout === "translated-only"} onChange={(e) => setBilingual({ order: e.target.value as any })}>
          <option value="translation-first">译文在前</option>
          <option value="original-first">原文在前</option>
        </select>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" className="mt-0.5" checked={bilingual.collapseLines} onChange={(e) => setBilingual({ collapseLines: e.target.checked })} />
        <span>
          合并多行为单行
          <Tooltip content={"字幕原文常为排版被拆成多行；双语叠加后行数会翻倍（如原文 3 行 → 双语 6 行）影响观看。\n\n开启后每种语言压成一行，双语共 2 行，由播放器按宽度自动折行。"} />
          <span className="ml-1 text-xs text-slate-400">（推荐开启，避免双语行数过多）</span>
        </span>
      </label>

      {/* 导出附加文字（描述符），可自定义并保留预设 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <LabelField
          title="「仅译文」附加文字"
          value={bilingual.translatedLabel}
          placeholder={`自动：${autoDescriptor("translated", params.sourceLang, params.targetLang)}`}
          presets={["AI中文", "AI机翻中文", "中文"]}
          onChange={(v) => setBilingual({ translatedLabel: v })}
        />
        <LabelField
          title="「双语」附加文字"
          value={bilingual.bilingualLabel}
          placeholder={`自动：${autoDescriptor("bilingual", params.sourceLang, params.targetLang)}`}
          presets={["AI中英双语", "AI机翻中英双语", "中英双语"]}
          onChange={(v) => setBilingual({ bilingualLabel: v })}
        />
      </div>

      <div>
        <label className="label flex items-center gap-1.5">
          导出语言码
          <Tooltip content={"媒体服务器（Plex/Jellyfin/Emby）靠文件名里的语言码识别字幕语言。\n留空＝按目标语言自动推断（简体中文→chs）。"} />
        </label>
        <select className="input" value={bilingual.langCode} onChange={(e) => setBilingual({ langCode: e.target.value })}>
          <option value="">自动（按目标语言）</option>
          {LANGUAGE_CODES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">SRT 配色方案</label>
        <select className="input" value={style.scheme} onChange={(e) => applyScheme(e.target.value)}>
          {COLOR_SCHEMES.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">以译文（中文）为主色调；颜色需播放器支持 &lt;font color&gt; 才生效，默认不分色。</p>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={style.enableSrtColor} onChange={(e) => setStyle({ enableSrtColor: e.target.checked, scheme: e.target.checked ? style.scheme : COLOR_SCHEMES[0].name })} />
        启用 SRT 颜色（&lt;font color&gt;）
      </label>
      {style.enableSrtColor && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Color label="原文颜色" value={style.original.primaryColor ?? "#9AA0A6"} onChange={(c) => setStyle({ original: { ...style.original, primaryColor: c }, scheme: "自定义" })} />
          <Color label="译文颜色" value={style.translation.primaryColor ?? "#FFC94D"} onChange={(c) => setStyle({ translation: { ...style.translation, primaryColor: c }, scheme: "自定义" })} />
        </div>
      )}
    </div>
  );
}

function LabelField({
  title,
  value,
  placeholder,
  presets,
  onChange,
}: {
  title: string;
  value: string;
  placeholder: string;
  presets: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{title}</label>
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600" onClick={() => onChange("")}>
          自动
        </button>
        {presets.map((p) => (
          <button key={p} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600" onClick={() => onChange(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function Num({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="label flex items-center gap-1.5">
        {label}
        {hint && <Tooltip content={hint} />}
      </label>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </div>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
