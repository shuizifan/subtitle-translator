"use client";

import { useEffect, useRef, useState } from "react";
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
import { defaultGeneration, resolveLlmConfig, buildChatCompletionsUrl, type GenerationSettings } from "@/core/translator/config";
import { buildProfileShareUrl, updateProfileSafely } from "@/core/translator/profileSharing";
import { DEFAULT_STYLE_PROMPT } from "@/core/translator/prompt";
import { LANGUAGE_CODES, autoDescriptor } from "@/core/naming";
import { ASS_SIZE_PRESETS, COLOR_SCHEMES, TRANSLATION_WHITE, type AssStyleConfig, type StyleConfig } from "@/core/styling";
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
  const setAssStyle = (p: Partial<AssStyleConfig>) => patch({ assStyle: { ...draft.assStyle, ...p } });

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
            <BilingualTab
              bilingual={draft.bilingual}
              setBilingual={setBilingual}
              style={draft.style}
              setStyle={setStyle}
              assStyle={draft.assStyle}
              setAssStyle={setAssStyle}
              params={draft.params}
            />
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
  const [copied, setCopied] = useState<string | null>(null);
  const testVersions = useRef<Record<string, number>>({});

  const copyShareLink = async (p: ApiProfile) => {
    try {
      await navigator.clipboard.writeText(buildProfileShareUrl(window.location.href, p));
      setCopied(p.id);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      setResults((r) => ({ ...r, [p.id]: { ok: false, message: error instanceof Error ? error.message : "复制失败" } }));
    }
  };

  const updateProfile = (id: string, p: Partial<ApiProfile>) => {
    testVersions.current[id] = (testVersions.current[id] ?? 0) + 1;
    patch({ apiProfiles: draft.apiProfiles.map((x) => x.id === id ? updateProfileSafely(x, p) : x) });
    setResults((r) => { const next = { ...r }; delete next[id]; return next; });
  };

  const addProfile = () => {
    const np = newProfile({ name: `服务 ${draft.apiProfiles.length + 1}` });
    patch({ apiProfiles: [...draft.apiProfiles, np], activeProfileId: draft.activeProfileId ?? np.id });
  };

  const removeProfile = (id: string) => {
    const left = draft.apiProfiles.filter((x) => x.id !== id);
    patch({ apiProfiles: left, activeProfileId: draft.activeProfileId === id ? (left[0]?.id ?? null) : draft.activeProfileId });
  };

  const test = async (p: ApiProfile, mode: "connectivity" | "protocol") => {
    const version = (testVersions.current[p.id] ?? 0) + 1;
    testVersions.current[p.id] = version;
    setResults((r) => ({ ...r, [p.id]: "loading" }));
    try {
      const res = await testConnection(resolveLlmConfig(p, draft.params), mode);
      if (testVersions.current[p.id] === version) setResults((r) => ({ ...r, [p.id]: res }));
    } catch (error) {
      if (testVersions.current[p.id] === version) setResults((r) => ({ ...r, [p.id]: { ok: false, message: error instanceof Error ? error.message : "测试失败" } }));
    }
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
                onClick={() => updateProfile(p.id, { name: sp.name, baseURL: sp.baseURL, model: sp.model, apiKey: "", modelConfigs: {}, authMode: sp.label === "Ollama" ? "none" : "bearer" })}
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
              <p className="mb-2 break-all text-xs text-slate-500">请求地址：{endpointPreview(p.baseURL)}</p>
              <label className="label">认证方式</label>
              <select className="input mb-2" value={p.authMode ?? "bearer"} onChange={(e) => updateProfile(p.id, { authMode: e.target.value as "bearer" | "none" })}>
                <option value="bearer">API Key（Bearer）</option>
                <option value="none">无认证（仅适用于确认不需要密钥的服务）</option>
              </select>
              <label className="label">API Key</label>
              <input className="input" type="password" autoComplete="off" disabled={p.authMode === "none"} placeholder="sk-..." value={p.apiKey} onChange={(e) => updateProfile(p.id, { apiKey: e.target.value })} />
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={p.rememberKey ?? false} onChange={(e) => updateProfile(p.id, { rememberKey: e.target.checked })} />
            在此设备记住密钥（未勾选时刷新页面后需重新输入）
          </label>
          <button className="mt-2 text-xs text-red-500 hover:underline" onClick={() => updateProfile(p.id, { apiKey: "", rememberKey: false })}>清除密钥</button>
          <GenerationFields profile={p} onChange={(generation) => updateProfile(p.id, { modelConfigs: { ...p.modelConfigs, [p.model]: generation } })} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-secondary" onClick={() => test(p, "connectivity")} disabled={!p.baseURL || (p.authMode !== "none" && !p.apiKey) || !p.model || results[p.id] === "loading"}>
              {results[p.id] === "loading" ? "测试中…" : "基础连接测试"}
            </button>
            <button className="btn-secondary" onClick={() => test(p, "protocol")} disabled={!p.baseURL || (p.authMode !== "none" && !p.apiKey) || !p.model || results[p.id] === "loading"}>字幕协议测试</button>
            <button className="btn-secondary" onClick={() => copyShareLink(p)} disabled={!p.baseURL}>
              {copied === p.id ? "✓ 已复制" : "分享配置（不含密钥）"}
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
      <p className="text-xs text-slate-400">请求经本站服务器转发至上方地址。新密钥默认只在当前页面会话中保存；选择记住设备后保存在浏览器 localStorage。公网部署无法通过 localhost 访问你电脑的 Ollama，本地模式需要应用服务器与 Ollama 可互达。预设会清除旧密钥。</p>
    </div>
  );
}

function endpointPreview(baseURL: string): string {
  if (!baseURL) return "填写 Base URL 后显示";
  try { return buildChatCompletionsUrl(baseURL); } catch (error) { return error instanceof Error ? error.message : "地址无效"; }
}

function GenerationFields({ profile, onChange }: { profile: ApiProfile; onChange: (settings: GenerationSettings) => void }) {
  const settings = profile.modelConfigs && Object.hasOwn(profile.modelConfigs, profile.model)
    ? profile.modelConfigs[profile.model] : defaultGeneration();
  const patch = (value: Partial<GenerationSettings>) => onChange({ ...settings, ...value });
  return (
    <details className="mt-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <summary className="cursor-pointer text-sm font-medium">当前模型参数 · {profile.model || "未填写模型"}</summary>
      <p className="my-2 text-xs text-slate-500">仅影响此服务的当前模型。未知能力使用保守配置；手动字段请按服务文档选择。跟随服务默认不代表关闭思考或免费。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">温度</label>
          <select className="input" value={settings.temperature == null ? "default" : "custom"} onChange={(e) => patch({ temperature: e.target.value === "default" ? null : 0 })}>
            <option value="default">跟随服务默认（不发送）</option><option value="custom">手动指定（需模型支持）</option>
          </select>
          {settings.temperature != null && <Num label="temperature" value={settings.temperature} min={0} max={2} step={0.1} onChange={(temperature) => patch({ temperature })} />}
        </div>
        <div>
          <label className="label">思考模式</label>
          <select className="input" value={settings.reasoningEffort} onChange={(e) => patch({ reasoningEffort: e.target.value as GenerationSettings["reasoningEffort"] })}>
            <option value="auto">跟随服务默认（不发送）</option>
            {["none", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => <option key={level} value={level}>{level}（需模型支持）</option>)}
          </select>
        </div>
        <div>
          <label className="label">输出预算</label>
          <select className="input" value={settings.outputBudget.mode} onChange={(e) => patch({ outputBudget: { ...settings.outputBudget, mode: e.target.value as GenerationSettings["outputBudget"]["mode"] } })}>
            <option value="auto">自动估算（受硬上限约束）</option><option value="manual">手动上限</option><option value="provider-default">服务默认（不限制输出额度）</option>
          </select>
        </div>
        {settings.outputBudget.mode !== "provider-default" && <Num label={settings.outputBudget.mode === "auto" ? "单请求硬上限（tokens）" : "单请求输出上限（tokens）"} value={settings.outputBudget.limit} min={64} max={131072} onChange={(limit) => patch({ outputBudget: { ...settings.outputBudget, limit } })} />}
        <div>
          <label className="label">额度字段</label>
          <select className="input" value={settings.tokenField} onChange={(e) => patch({ tokenField: e.target.value as GenerationSettings["tokenField"] })}>
            <option value="max_tokens">max_tokens（兼容接口常用）</option><option value="max_completion_tokens">max_completion_tokens</option>
          </select>
        </div>
        <div>
          <label className="label">输出格式能力</label>
          <select className="input" value={settings.outputFormat} onChange={(e) => patch({ outputFormat: e.target.value as GenerationSettings["outputFormat"] })}>
            <option value="text">普通文本协议（未知能力默认）</option><option value="json_object">JSON object（需服务支持）</option><option value="json_schema">严格 JSON schema（需服务支持）</option>
          </select>
        </div>
        <Num label="自动预算的推理预留（tokens）" value={settings.reasoningReserve} min={0} max={131072} onChange={(reasoningReserve) => patch({ reasoningReserve })} />
      </div>
      <p className="mt-2 text-xs text-slate-500">自动预算为估算，未知模型的推理消耗和上下文限额未验证。预留 0 不表示模型不会思考；截断时不会自动提高你设置的硬上限。连接测试和字幕协议测试可能产生少量费用，不代表翻译质量已通过。</p>
    </details>
  );
}

function ParamsTab({ params, setParams }: { params: TranslateParams; setParams: (p: Partial<TranslateParams>) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Num label="请求最大段落数" hint="每次请求发给模型的字幕条数（batch size）。越大越省请求，但越易触发行错位。" value={params.batchSize} min={1} max={100} onChange={(v) => setParams({ batchSize: v })} />
        <Num label="并发请求数" hint="同时进行的请求数。提高可加快整体速度，但受模型供应商限流约束。" value={params.concurrency} min={1} max={20} onChange={(v) => setParams({ concurrency: v })} />
        <Num label="最大重试次数" value={params.maxRetries} min={0} max={6} onChange={(v) => setParams({ maxRetries: v })} />
        <Num label="上下文参考条数（前文）" hint="额外携带前文几条作为参考（不翻译），提升连贯性；0 表示不带，速度更快。" value={params.contextLines} min={0} max={5} onChange={(v) => setParams({ contextLines: v })} />
        <Num label="上下文参考条数（后文）" hint="批内条目能互相看见，但批尾那条看不到下一条；一句话正好跨批次切开时缺少判断依据。带上后文可缓解。" value={params.trailingContextLines} min={0} max={5} onChange={(v) => setParams({ trailingContextLines: v })} />
        <Num label="每批字符上限" hint="按原文字符数动态分批，与「请求最大段落数」取先到者；0=不限。遇到成段独白时，固定条数会让一次请求要生成很长的 JSON，顶破 max tokens。" value={params.maxCharsPerBatch} min={0} max={20000} step={100} onChange={(v) => setParams({ maxCharsPerBatch: v })} />
        <div className="sm:col-span-2 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="mt-0.5" checked={params.autoDetectSource} onChange={(e) => setParams({ autoDetectSource: e.target.checked })} />
            <span>
              解析后自动判定源语言
              <Tooltip content={"内封字幕的语言标签本身就不可信（标 lat 实际是西班牙语、标 eng 实际已含中文）。\n按正文内容判定更准，顺带让双语文件名从「AI中文双语」变成「AI中英双语」。"} />
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="mt-0.5" checked={params.useGlossary} onChange={(e) => setParams({ useGlossary: e.target.checked })} />
            <span>
              翻译时使用术语表
              <Tooltip content={"术语表在主界面「术语表」按钮里生成与编辑。\n确认后的词条用于跨批次统一人名与术语；模型输出仍需检查。"} />
            </span>
          </label>
        </div>
      </div>
      <p className="text-xs text-slate-500">模型温度、思考与输出预算在「翻译服务」中按服务和模型独立保存。</p>
      <div>
        <label className="label">目标语言地区 / 用词风格（可选）</label>
        <input className="input" value={params.targetLocale} placeholder="留空跟随目标语言，例如：中国大陆通用" onChange={(e) => setParams({ targetLocale: e.target.value })} />
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
        引擎会自动追加固定输出协议，并校验 ID、重复项和缺失项。提示词不能保证语义准确，请避免要求合并或重排字幕。
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
  assStyle,
  setAssStyle,
  params,
}: {
  bilingual: BilingualParams;
  setBilingual: (p: Partial<BilingualParams>) => void;
  style: StyleConfig;
  setStyle: (p: Partial<StyleConfig>) => void;
  assStyle: AssStyleConfig;
  setAssStyle: (p: Partial<AssStyleConfig>) => void;
  params: TranslateParams;
}) {
  const applyScheme = (name: string) => {
    const sc = COLOR_SCHEMES.find((s) => s.name === name);
    if (!sc) return;
    setStyle({ scheme: sc.name, enableSrtColor: sc.enableSrtColor, original: { ...sc.original }, translation: { ...sc.translation } });
  };

  // 译文/原文颜色的兜底默认（与下方取色器一致）：译文白、原文金黄。
  const ORIG_FALLBACK = "#D4A52A";

  // 启用 SRT 颜色：若当前尚无分色，默认套用第一个分色方案（译文白 / 金黄原文）。
  const toggleSrtColor = (checked: boolean) => {
    if (!checked) {
      setStyle({ enableSrtColor: false, scheme: COLOR_SCHEMES[0].name });
      return;
    }
    const hasColor = !!(style.original.primaryColor || style.translation.primaryColor);
    if (hasColor) {
      setStyle({ enableSrtColor: true });
    } else {
      const def = COLOR_SCHEMES[1]; // 译文白 / 金黄原文
      setStyle({ enableSrtColor: true, scheme: def.name, original: { ...def.original }, translation: { ...def.translation } });
    }
  };

  // 一键调换原文 / 译文颜色。
  const swapColors = () => {
    const orig = style.original.primaryColor ?? ORIG_FALLBACK;
    const trans = style.translation.primaryColor ?? TRANSLATION_WHITE;
    setStyle({
      original: { ...style.original, primaryColor: trans },
      translation: { ...style.translation, primaryColor: orig },
      scheme: "自定义",
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label flex items-center gap-1.5">
          双语布局
          <Tooltip content={"单轨：译文与原文写在同一条字幕的两行里。\n\n双轨：译文与原文拆成两条字幕、共用同一时间轴，如：\n00:00:00 → 00:00:03  译文…\n00:00:00 → 00:00:03  原文…"} />
        </label>
        <select className="input" value={bilingual.layout} onChange={(e) => setBilingual({ layout: e.target.value as any })}>
          <option value="single-entry">单轨（一条字幕，两行，推荐）</option>
          <option value="dual-entry">双轨（两条字幕，同一时间轴，部分播放器只显示一行）</option>
          <option value="translated-only">仅译文</option>
        </select>
        {bilingual.layout === "dual-entry" && (
          <p className="mt-1 text-xs text-amber-600">
            双轨会对同一时间轴输出两条独立字幕，Emby / Plex / Jellyfin 对重叠字幕的堆叠渲染不一致，可能只显示其中一条。
          </p>
        )}
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
        <p className="mt-1 text-xs text-slate-400">译文恒为白色、原文用彩色区分；颜色需播放器支持 &lt;font color&gt; 才生效，默认不分色。</p>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={style.enableSrtColor} onChange={(e) => toggleSrtColor(e.target.checked)} />
        启用 SRT 颜色（&lt;font color&gt;）
      </label>
      {style.enableSrtColor && (
        <div className="space-y-2">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Color label="原文颜色" value={style.original.primaryColor ?? ORIG_FALLBACK} onChange={(c) => setStyle({ original: { ...style.original, primaryColor: c }, scheme: "自定义" })} />
            <button
              type="button"
              onClick={swapColors}
              title="调换原文 / 译文颜色"
              aria-label="调换原文与译文颜色"
              className="mb-1 flex h-9 w-9 items-center justify-center self-end rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              ⇄
            </button>
            <Color label="译文颜色" value={style.translation.primaryColor ?? TRANSLATION_WHITE} onChange={(c) => setStyle({ translation: { ...style.translation, primaryColor: c }, scheme: "自定义" })} />
          </div>
          <p className="text-xs text-slate-400">译文默认白色；点击 ⇄ 可一键调换原文 / 译文颜色。</p>
        </div>
      )}

      {/* ASS 样式（仅 .ass 导出生效） */}
      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
          <input type="checkbox" checked={assStyle.forceStyle} onChange={(e) => setAssStyle({ forceStyle: e.target.checked })} />
          强制统一 ASS 样式（译文大、原文小）
          <Tooltip content={"默认关闭＝忠实保留源字幕原有的字体/字号/颜色，只翻译文字，绝不弄崩已排版好的字幕。\n\n开启后会剥离源对白的内联字体/字号/颜色，统一套用下面的「译文大、原文小」（适合无样式或想统一外观的字幕）。\n\n字号按「占视频高度的百分比」设置，随分辨率等比缩放，手机/电脑相对画面大小一致；源文件未声明分辨率时按播放器默认 384×288 处理。"} />
        </label>
        <p className="mt-1 text-xs text-slate-400">默认保留源样式；仅当你想统一外观、或源字幕没样式时才需开启。</p>

        {assStyle.forceStyle && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">快捷档位</span>
              {ASS_SIZE_PRESETS.map((p) => {
                const active = assStyle.translationPct === p.translationPct && assStyle.originalPct === p.originalPct;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setAssStyle({ translationPct: p.translationPct, originalPct: p.originalPct })}
                    className={`rounded-md px-2.5 py-1 text-xs ${active ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"}`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <PctField
                label="译文字号"
                value={assStyle.translationPct}
                onChange={(v) => setAssStyle({ translationPct: v })}
              />
              <PctField
                label="原文字号"
                value={assStyle.originalPct}
                onChange={(v) => setAssStyle({ originalPct: v })}
              />
            </div>

            <div>
              <label className="label">统一字体（可选）</label>
              <input
                className="input"
                value={assStyle.fontName}
                placeholder="留空＝沿用原字幕字体"
                onChange={(e) => setAssStyle({ fontName: e.target.value })}
              />
              <p className="mt-1 text-xs text-slate-400">字体需播放端已安装，否则回退默认字体。</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 字号百分比输入（占视频高度），附 1080p 下的等效像素提示。 */
function PctField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="label">{label}（占视频高度 %）</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="input w-24"
          min={1}
          max={20}
          step={0.1}
          value={value}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(Math.min(20, Math.max(1, v)));
          }}
        />
        <span className="text-xs text-slate-400">≈ 1080p 视频上 {Math.round((value / 100) * 1080)}px</span>
      </div>
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
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, step === 1 ? Math.round(n) : n)));
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
