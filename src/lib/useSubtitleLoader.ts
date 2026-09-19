"use client";

import { useCallback, useState } from "react";
import { v4 as uuid } from "uuid";
import { decodeBytes, normalizeLabel } from "@/core/encoding";
import { parseSrt } from "@/core/parsers/srt";
import { parseAss } from "@/core/parsers/ass";
import { parseVtt } from "@/core/parsers/vtt";
import { parseLrc } from "@/core/parsers/lrc";
import { looksAlreadyBilingual } from "@/core/bilingual";
import { analyzeCleanup, applyCleanup } from "@/core/cleanup";
import { detectLanguage } from "@/core/detect";
import { useAppStore } from "@/store";

// 纯文本字幕极少超过 1 MB，但带大量 ASS 特效时会顶到几 MB，给足余量。
const MAX_SIZE = 20 * 1024 * 1024; // 20 MB

export const SUPPORTED_EXT = /\.(srt|ass|ssa|vtt|lrc)$/i;

function parserFor(name: string) {
  if (/\.(ass|ssa)$/i.test(name)) return parseAss;
  if (/\.vtt$/i.test(name)) return parseVtt;
  if (/\.lrc$/i.test(name)) return parseLrc;
  return parseSrt;
}

/** 集中处理「字节 → 探测编码 → 解析 → 清理/判定语种 → 入 store」，供上传区与顶部「打开新文件」复用。 */
export function useSubtitleLoader() {
  const setDocument = useAppStore((s) => s.setDocument);
  const setBilingualWarning = useAppStore((s) => s.setBilingualWarning);
  const [error, setError] = useState<string | null>(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [lastBytes, setLastBytes] = useState<Uint8Array | null>(null);
  const [lastName, setLastName] = useState("subtitle.srt");

  const loadBytes = useCallback(
    (bytes: Uint8Array, name: string, forced?: string) => {
      setError(null);
      try {
        const decoded = decodeBytes(bytes, forced && forced !== "auto" ? forced : undefined);
        setLowConfidence((!forced || forced === "auto") && decoded.confidence < 0.6);
        const { document, issues } = parserFor(name)(decoded.text, uuid());

        // 源字幕清理：识别水印/占位条并就地应用（排除的条目仍在预览里标灰可见）
        const state = useAppStore.getState();
        const marks = analyzeCleanup(document, state.cleanup);
        applyCleanup(document, marks);

        // 源语言判定：容器/文件名里的语言标签并不可信，按正文判断更准
        const texts = document.entries.filter((e) => !e.excluded).map((e) => e.originalText);
        const detected = detectLanguage(texts);

        setDocument(document, name, decoded.encoding, issues, {
          cleanupMarks: marks,
          detectedLang: detected.lang,
        });
        if (state.params.autoDetectSource && detected.lang !== "auto") {
          useAppStore.getState().setSourceLang(detected.lang);
        }
        setBilingualWarning(looksAlreadyBilingual(document));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [setDocument, setBilingualWarning],
  );

  const loadFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!SUPPORTED_EXT.test(file.name)) {
        setError("文件类型不支持，目前支持 .srt / .ass / .ssa / .vtt / .lrc");
        return;
      }
      if (file.size > MAX_SIZE) {
        setError(`文件超过 ${MAX_SIZE / 1024 / 1024} MB 上限`);
        return;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      setLastBytes(buf);
      setLastName(file.name);
      loadBytes(buf, file.name, "auto");
    },
    [loadBytes],
  );

  const reloadWithEncoding = useCallback(
    (enc: string) => {
      if (lastBytes) loadBytes(lastBytes, lastName, enc === "auto" ? "auto" : normalizeLabel(enc));
    },
    [lastBytes, lastName, loadBytes],
  );

  /** 清理选项改动后按最新设置重新解析（清理是在解析结果上就地应用的，无法原地撤销）。 */
  const reparse = useCallback(() => {
    if (lastBytes) loadBytes(lastBytes, lastName, "auto");
  }, [lastBytes, lastName, loadBytes]);

  return { loadFile, loadBytes, reloadWithEncoding, reparse, error, lowConfidence, hasBytes: !!lastBytes, MAX_SIZE };
}
