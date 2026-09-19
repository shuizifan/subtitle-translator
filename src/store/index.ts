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
import type { CleanupMark, CleanupOptions } from "@/core/cleanup";
import { DEFAULT_CLEANUP } from "@/core/cleanup";
import type { GlossaryEntry } from "@/core/glossary";
import type { QaFinding } from "@/core/qa";

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
  /** 携带后文几条作为参考（批尾条目也能看到下一条），默认 2 */
  trailingContextLines: number;
  /** 每批原文字符数上限（0=不限）；与 batchSize 取先到者 */
  maxCharsPerBatch: number;
  /** 解析后按正文自动判定源语言并回填（默认开） */
  autoDetectSource: boolean;
  /** 翻译时使用术语表（默认开；术语表为空时无影响） */
  useGlossary: boolean;
  /** 温度，默认 0 */
  temperature: number;
  maxTokens: number;
  /**
   * 思考强度。实测关闭思考会让推理型模型把一句话在相邻两条字幕间错误重新分配
   * （"德国人已经对德国马克说了 Auf Wiedersehen" / "对德国马克。"），
   * 这类错误观众能直接看出来，所以默认 "medium"。"auto" = 不发送该字段。
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
  cleanup: CleanupOptions;
}

interface AppState extends SettingsSnapshot {
  // 文档
  fileName: string | null;
  detectedEncoding: string | null;
  document: SubtitleDocument | null;
  parseIssues: ParseIssue[];
  phase: Phase;
  /** 源字幕清理识别出的非台词条目（已应用到 document 上） */
  cleanupMarks: CleanupMark[];
  /** 按正文判定出的源语言（展示用；"auto"=没判定出来） */
  detectedLang: string | null;

  // 术语表
  glossary: GlossaryEntry[];
  glossaryStatus: "idle" | "building" | "ready" | "error";
  glossaryError: string | null;

  /** 译文体检结果（导出前的机械校验；空数组=没跑过或全部通过） */
  qaFindings: QaFinding[];
  qaRan: boolean;

  // 进度
  progress: {
    completedBatches: number;
    totalBatches: number;
    translatedEntries: number;
    totalEntries: number;
    failedEntries: number;
  } | null;
  failedIds: number[];
  /** 最近一次翻译失败的原因（有未翻译条目时解释原因用） */
  translateError: string | null;
  docVersion: number;
  /** 上传时检测到「疑似已是双语」的提示（再翻译会覆盖已有译文）；可关闭。 */
  bilingualWarning: boolean;

  // actions
  setDocument: (
    doc: SubtitleDocument,
    fileName: string,
    encoding: string,
    issues: ParseIssue[],
    extra?: { cleanupMarks?: CleanupMark[]; detectedLang?: string | null },
  ) => void;
  reset: () => void;
  updateTranslation: (id: number, text: string) => void;
  /** 清空指定条目的译文（重译前用） */
  clearTranslations: (ids: number[]) => void;
  /** 恢复被清理排除的条目 */
  restoreExcluded: (id?: number) => void;

  setGlossary: (entries: GlossaryEntry[]) => void;
  setGlossaryStatus: (status: AppState["glossaryStatus"], error?: string | null) => void;
  setQaFindings: (findings: QaFinding[]) => void;

  /** 快捷改单项参数（不走设置弹窗草稿） */
  setParams: (p: Partial<TranslateParams>) => void;
  /** 改源字幕清理选项（改完需由调用方重新解析当前文件） */
  setCleanup: (p: Partial<CleanupOptions>) => void;

  // 这些只供「快捷控制条」即时切换（不走草稿）
  selectProfile: (id: string) => void;
  setSourceLang: (v: string) => void;
  setTargetLang: (v: string) => void;

  /** 设置弹窗「保存」时整体写回 */
  applySettings: (s: SettingsSnapshot) => void;

  setPhase: (p: Phase) => void;
  setProgress: (p: AppState["progress"]) => void;
  setFailedIds: (ids: number[], error?: string | null) => void;
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
  trailingContextLines: 2,
  maxCharsPerBatch: 1600,
  autoDetectSource: true,
  useGlossary: true,
  temperature: 0,
  // 16384 而非 8192：思考型模型的思考 token 也计入这个额度，实跑中 4096 全被思考
  // 吃光、content 长度为 0（finish_reason=length），该批静默失败后走重试拆批。
  maxTokens: 16384,
  // 开思考慢 5 倍、贵 3 倍，但修掉的是「观众能直接看出来」的错译（相邻条目内容互换、
  // 一词多义选错）。要速度可改回 "none"，配合「译文体检」再挑出可疑条目重译。
  reasoningEffort: "medium",
};

export const DEFAULT_BILINGUAL: BilingualParams = {
  // single-entry（一条 cue 两行）而非 dual-entry：后者对同一时间轴输出两条独立 cue，
  // Emby / Plex / Jellyfin 对重叠 cue 的堆叠渲染不一致，可能只显示一条。
  layout: "single-entry",
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
      cleanup: DEFAULT_CLEANUP,
      cleanupMarks: [],
      detectedLang: null,
      glossary: [],
      glossaryStatus: "idle",
      glossaryError: null,
      qaFindings: [],
      qaRan: false,
      progress: null,
      failedIds: [],
      translateError: null,
      docVersion: 0,
      bilingualWarning: false,

      setDocument: (doc, fileName, encoding, issues, extra) =>
        set((s) => ({
          document: doc,
          fileName,
          detectedEncoding: encoding,
          parseIssues: issues,
          phase: "parsed",
          progress: null,
          failedIds: [],
          translateError: null,
          cleanupMarks: extra?.cleanupMarks ?? [],
          detectedLang: extra?.detectedLang ?? null,
          glossary: [],
          glossaryStatus: "idle",
          glossaryError: null,
          qaFindings: [],
          qaRan: false,
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
          translateError: null,
          cleanupMarks: [],
          detectedLang: null,
          glossary: [],
          glossaryStatus: "idle",
          glossaryError: null,
          qaFindings: [],
          qaRan: false,
          bilingualWarning: false,
        }),

      updateTranslation: (id, text) =>
        set((s) => {
          if (!s.document) return {};
          const entry = s.document.entries.find((e) => e.id === id);
          if (entry) entry.translatedText = text;
          return { docVersion: s.docVersion + 1 };
        }),

      clearTranslations: (ids) =>
        set((s) => {
          if (!s.document) return {};
          const wanted = new Set(ids);
          for (const e of s.document.entries) if (wanted.has(e.id)) e.translatedText = "";
          return { docVersion: s.docVersion + 1 };
        }),

      restoreExcluded: (id) =>
        set((s) => {
          if (!s.document) return {};
          for (const e of s.document.entries) {
            if (id == null || e.id === id) {
              if (e.excluded) {
                e.excluded = false;
                e.excludedReason = undefined;
              }
            }
          }
          return {
            cleanupMarks: id == null ? [] : s.cleanupMarks.filter((m) => m.id !== id || m.action !== "drop"),
            docVersion: s.docVersion + 1,
          };
        }),

      setGlossary: (entries) => set({ glossary: entries }),
      setGlossaryStatus: (status, error) => set({ glossaryStatus: status, glossaryError: error ?? null }),
      setQaFindings: (findings) => set({ qaFindings: findings, qaRan: true }),

      setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
      setCleanup: (p) => set((s) => ({ cleanup: { ...s.cleanup, ...p } })),

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
          cleanup: snap.cleanup,
        }),

      setPhase: (p) => set({ phase: p }),
      setProgress: (p) => set({ progress: p }),
      setFailedIds: (ids, error) => set({ failedIds: ids, translateError: error ?? null }),
      bumpDocVersion: () => set((s) => ({ docVersion: s.docVersion + 1 })),
      setBilingualWarning: (v) => set({ bilingualWarning: v }),
    }),
    {
      name: "subtitle-translator",
      version: 2,
      // v0 → v1：旧缓存里 maxTokens 停留在 4096（老默认值），思考型模型光是思考
      // 就能吃满，必须抬上来，否则老用户装了新版本依然会整批截断失败。
      // 只动等于老默认值的情况，用户手工调过的数值保持不变。
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        if (version < 1 && p.params && p.params.maxTokens === 4096) {
          p.params = { ...p.params, maxTokens: 8192 };
        }
        // v1 → v2：停留在「老默认值」的三项在实跑中被证明会产出肉眼可见的问题，
        // 一并抬到新默认值；用户手工调过的数值一律保持不变。
        //  · reasoningEffort=none  → 相邻条目内容互换、一词多义选错
        //  · maxTokens=8192        → 开思考后思考 token 吃空额度、整批静默失败
        //  · layout=dual-entry     → 同时间轴两条 cue，部分播放器只显示一条
        if (version < 2) {
          if (p.params) {
            const params = { ...p.params };
            if (params.reasoningEffort === "none") params.reasoningEffort = DEFAULT_PARAMS.reasoningEffort;
            if (params.maxTokens === 8192) params.maxTokens = DEFAULT_PARAMS.maxTokens;
            p.params = params;
          }
          if (p.bilingual && p.bilingual.layout === "dual-entry") {
            p.bilingual = { ...p.bilingual, layout: DEFAULT_BILINGUAL.layout };
          }
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
        cleanup: s.cleanup,
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
          cleanup: { ...current.cleanup, ...(p.cleanup ?? {}) },
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
    cleanup: { ...s.cleanup },
  };
}
