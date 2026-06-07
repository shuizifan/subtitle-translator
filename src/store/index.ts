// Zustand：贯穿全程的「任务 / 工作流」状态（见规范 §2、§4）。
"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import type { ParseIssue, SubtitleDocument } from "@/core/model";
import { DEFAULT_STYLE_PROMPT } from "@/core/translator/prompt";
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
  maxTokens: 4096,
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
    }),
    {
      name: "subtitle-translator",
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
          assStyle: { ...current.assStyle, ...(p.assStyle ?? {}) },
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
