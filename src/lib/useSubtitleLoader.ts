"use client";

import { useCallback, useState } from "react";
import { v4 as uuid } from "uuid";
import { decodeBytes, normalizeLabel } from "@/core/encoding";
import { parseSrt } from "@/core/parsers/srt";
import { parseAss } from "@/core/parsers/ass";
import { looksAlreadyBilingual } from "@/core/bilingual";
import { useAppStore } from "@/store";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

/** 集中处理「字节 → 探测编码 → 解析 → 入 store」，供上传区与顶部「打开新文件」复用。 */
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
        const parse = /\.ass$/i.test(name) ? parseAss : parseSrt;
        const { document, issues } = parse(decoded.text, uuid());
        setDocument(document, name, decoded.encoding, issues);
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
      if (!/\.(srt|ass)$/i.test(file.name)) {
        setError("文件类型不支持，目前支持 .srt / .ass（后续将支持 .vtt/.lrc）");
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

  return { loadFile, reloadWithEncoding, error, lowConfidence, hasBytes: !!lastBytes, MAX_SIZE };
}
