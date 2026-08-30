// Zustand：贯穿全程的「任务 / 工作流」状态（见规范 §2、§4）。
"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import type { ParseIssue, SubtitleDocument } from "@/core/model";
import { DEFAULT_STYLE_PROMPT } from "@/core/translator/prompt";
import type { ReasoningEffort } from "@/core/translator/llmClient";
import type { BilingualLayout, LanguageOrder } from "@/core/bilingual";
import type { StyleConfig, AssStyleConfig } from "@/core/styling";
import { DEFAULT_STYLE, DEFAULT_ASS_STYLE } from "@/core/styling";

/** 一个翻译服务配置（OpenAI 兼容）。支持多个、可切换。 */
export interface ApiProfile {
  id: string;
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface TranslateParams {
  sourceLang: string; // "auto" = 自动检测
  targetLang: string;
  customStyle: string;
  /** 可编辑的系统提示词模板（含 {{to}} {{from}} 占位符） */
  systemPrompt: string;
  /** 每次请求最大段落数（batch size），默认 20 */
  batchSize: number;
  concurrency: number;
  maxRetries: number;
  contextLines: number;
  /** 温度，默认 0 */
  temperature: number;
  maxTokens: number;
  /**
   * 思考强度。字幕是逐条直译，推理帮不上忙，但思考 token 会占满 max_tokens
   * 导致 JSON 被截断、整批重试，所以默认关闭。"auto" = 不发送该字段。
   */
  reasoningEffort: ReasoningEffort;
}

export interface BilingualParams {
  layout: BilingualLayout; // dual-entry(双轨) / single-entry(单轨) / translated-only
  order: LanguageOrder;
  /** 导出语言码覆盖；空串=按目标语言自动推断 */
  langCode: string;
  /** 「仅译文」附加文字；空串=自动（AI中文） */
  translatedLabel: string;
  /** 「双语」附加文字；空串=自动（AI中英双语） */
  bilingualLabel: string;
  /** 合并每种语言内部换行为一行，避免双语行数翻倍（默认 true） */
  collapseLines: boolean;
}

export type Phase = "idle" | "parsed" | "translating" | "done";

/** 可在设置弹窗里以「草稿」方式编辑、保存时整体写回的配置集合。 */
export interface SettingsSnapshot {
  apiProfiles: ApiProfile[];
  activeProfileId: string | null;
  params: TranslateParams;
  bilingual: BilingualParams;
  style: StyleConfig;
  assStyle: AssStyleConfig;
}

interface AppState extends SettingsSnapshot {
  // 文档
  fileName: string | null;
  detectedEncoding: string | null;
  document: SubtitleDocument | null;
  parseIssues: ParseIssue[];
  phase: Phase;

  // 进度
  progress: {
    completedBatches: number;
    totalBatches: number;
    translatedEntries: number;
    totalEntries: number;
    failedEntries: number;
  } | null;
  failedIds: number[];
  docVersion: number;
  /** 上传时检测到「疑似已是双语」的提示（再翻译会覆盖已有译文）；可关闭。 */
  bilingualWarning: boolean;

  // actions
  setDocument: (doc: SubtitleDocument, fileName: string, encoding: string, issues: ParseIssue[]) => void;
  reset: () => void;
  updateTranslation: (id: number, text: string) => void;

  // 这些只供「快捷控制条」即时切换（不走草稿）
  selectProfile: (id: string) => void;
  setSourceLang: (v: string) => void;
  setTargetLang: (v: string) => void;

  /** 设置弹窗「保存」时整体写回 */
  applySettings: (s: SettingsSnapshot) => void;

  setPhase: (p: Phase) => void;
  setProgress: (p: AppState["progress"]) => void;
  setFailedIds: (ids: number[]) => void;
  bumpDocVersion: () => void;
  setBilingualWarning: (v: boolean) => void;
}

export const DEFAULT_PARAMS: TranslateParams = {
  sourceLang: "auto",
  targetLang: "Simplified Chinese",
  customStyle: "",
  systemPrompt: DEFAULT_STYLE_PROMPT,
  batchSize: 20,
  concurrency: 6,
  maxRetries: 3,
  contextLines: 3,
  temperature: 0,
  // 8192 而非 4096：思考型模型的思考 token 也计入这个额度，4096 很容易被吃满，
  // 导致返回的 JSON 数组被截断、整批判为失败并反复重试。
  maxTokens: 8192,
  reasoningEffort: "none",
};

export const DEFAULT_BILINGUAL: BilingualParams = {
  layout: "dual-entry",
  order: "translation-first",
  langCode: "",
  translatedLabel: "",
  bilingualLabel: "",
  collapseLines: true,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      fileName: null,
      detectedEncoding: null,
      document: null,
      parseIssues: [],
      phase: "idle",
      apiProfiles: [],
      activeProfileId: null,
      params: DEFAULT_PARAMS,
      style: DEFAULT_STYLE,
      assStyle: DEFAULT_ASS_STYLE,
      bilingual: DEFAULT_BILINGUAL,
      progress: null,
      failedIds: [],
      docVersion: 0,
      bilingualWarning: false,

      setDocument: (doc, fileName, encoding, issues) =>
        set((s) => ({
          document: doc,
          fileName,
          detectedEncoding: encoding,
          parseIssues: issues,
          phase: "parsed",
          progress: null,
          failedIds: [],
          docVersion: s.docVersion + 1,
          bilingualWarning: false,
        })),

      reset: () =>
        set({
          document: null,
          fileName: null,
          detectedEncoding: null,
          parseIssues: [],
          phase: "idle",
          progress: null,
          failedIds: [],
          bilingualWarning: false,
        }),

      updateTranslation: (id, text) =>
        set((s) => {
          if (!s.document) return {};
          const entry = s.document.entries.find((e) => e.id === id);
          if (entry) entry.translatedText = text;
          return { docVersion: s.docVersion + 1 };
        }),

      selectProfile: (id) => set({ activeProfileId: id }),
      setSourceLang: (v) => set((s) => ({ params: { ...s.params, sourceLang: v } })),
      setTargetLang: (v) => set((s) => ({ params: { ...s.params, targetLang: v } })),

      applySettings: (snap) =>
        set({
          apiProfiles: snap.apiProfiles,
          activeProfileId: snap.activeProfileId,
          params: snap.params,
          bilingual: snap.bilingual,
          style: snap.style,
          assStyle: snap.assStyle,
        }),

      setPhase: (p) => set({ phase: p }),
      setProgress: (p) => set({ progress: p }),
      setFailedIds: (ids) => set({ failedIds: ids }),
      bumpDocVersion: () => set((s) => ({ docVersion: s.docVersion + 1 })),
      setBilingualWarning: (v) => set({ bilingualWarning: v }),
    }),
    {
      name: "subtitle-translator",
      version: 1,
      // v0 → v1：旧缓存里 maxTokens 停留在 4096（老默认值），思考型模型光是思考
      // 就能吃满，必须抬上来，否则老用户装了新版本依然会整批截断失败。
      // 只动等于老默认值的情况，用户手工调过的数值保持不变。
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        if (version < 1 && p.params && p.params.maxTokens === 4096) {
          p.params = { ...p.params, maxTokens: DEFAULT_PARAMS.maxTokens };
        }
        return p as AppState;
      },
      partialize: (s) => ({
        apiProfiles: s.apiProfiles,
        activeProfileId: s.activeProfileId,
        params: s.params,
        style: s.style,
        assStyle: s.assStyle,
        bilingual: s.bilingual,
      }),
      // 深合并：保证新增字段（systemPrompt / 标签 / 配色方案等）在老缓存上也能取到默认值
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          params: { ...current.params, ...(p.params ?? {}) },
          bilingual: { ...current.bilingual, ...(p.bilingual ?? {}) },
          style: { ...current.style, ...(p.style ?? {}) },
          // 旧缓存的 assStyle 形态不同（resizeEnabled / 旧默认值），缺 forceStyle 则回退到新默认
          assStyle: p.assStyle && "forceStyle" in p.assStyle ? { ...current.assStyle, ...p.assStyle } : current.assStyle,
          apiProfiles: p.apiProfiles ?? current.apiProfiles,
          activeProfileId: p.activeProfileId ?? current.activeProfileId,
        };
      },
    },
  ),
);

/** 取当前激活的服务配置。 */
export function getActiveProfile(s: AppState): ApiProfile | null {
  return s.apiProfiles.find((p) => p.id === s.activeProfileId) ?? null;
}

/** 生成一份新的服务配置（供设置草稿用）。 */
export function newProfile(partial?: Partial<ApiProfile>): ApiProfile {
  return {
    id: uuid(),
    name: partial?.name ?? "新服务",
    baseURL: partial?.baseURL ?? "",
    apiKey: partial?.apiKey ?? "",
    model: partial?.model ?? "",
  };
}

/** 取当前完整配置快照（供设置弹窗初始化草稿）。 */
export function snapshotSettings(s: AppState): SettingsSnapshot {
  return {
    apiProfiles: s.apiProfiles.map((p) => ({ ...p })),
    activeProfileId: s.activeProfileId,
    params: { ...s.params },
    bilingual: { ...s.bilingual },
    style: { ...s.style, original: { ...s.style.original }, translation: { ...s.style.translation } },
    assStyle: { ...s.assStyle },
  };
}
