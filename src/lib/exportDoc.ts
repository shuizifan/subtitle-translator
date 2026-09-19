// 导出内容与文件名的组装（与 React 无关，便于「当前文件」与「批量队列」共用）。

import type { SubtitleDocument } from "@/core/model";
import { assemble, type BilingualLayout } from "@/core/bilingual";
import { serializeSrt } from "@/core/serializers/srt";
import { serializeAss, type AssLayout } from "@/core/serializers/ass";
import { buildExportName, type ExportType } from "@/core/naming";
import type { BilingualParams, TranslateParams } from "@/store";
import type { AssStyleConfig, StyleConfig } from "@/core/styling";

export interface ExportSettings {
  params: Pick<TranslateParams, "sourceLang" | "targetLang">;
  bilingual: BilingualParams;
  style: StyleConfig;
  assStyle: AssStyleConfig;
}

export interface ExportResult {
  filename: string;
  content: string;
  ext: "srt" | "ass";
}

/** 按当前设置生成一份导出内容（VTT/LRC 解析结果统一导出为 SRT）。 */
export function buildExport(
  doc: SubtitleDocument,
  fileName: string,
  type: ExportType,
  s: ExportSettings,
): ExportResult {
  const eol = (doc.meta.eol as "\r\n" | "\n") ?? "\r\n";
  const isAss = doc.sourceFormat === "ass";
  const ext: "srt" | "ass" = isAss ? "ass" : "srt";

  let content: string;
  if (isAss) {
    // ASS：双语统一走「单条目双行（\N 堆叠）」，避免两条同位置 Dialogue 重叠。
    const layout: AssLayout = type === "translated" ? "translated-only" : "stacked";
    content = serializeAss(
      doc,
      { layout, order: s.bilingual.order, collapseLines: s.bilingual.collapseLines },
      s.style,
      s.assStyle,
    );
  } else {
    const layout: BilingualLayout =
      type === "translated"
        ? "translated-only"
        : s.bilingual.layout === "translated-only"
          ? "single-entry"
          : s.bilingual.layout;
    const cues = assemble(doc, { layout, order: s.bilingual.order, collapseLines: s.bilingual.collapseLines }, s.style);
    content = serializeSrt(cues, { eol });
  }

  return {
    filename: exportName(fileName, type, ext, s),
    content,
    ext,
  };
}

/** 只算文件名（供 UI 实时预览）。 */
export function exportName(fileName: string, type: ExportType, ext: "srt" | "ass", s: ExportSettings): string {
  return buildExportName({
    fileName,
    type,
    sourceLang: s.params.sourceLang,
    targetLang: s.params.targetLang,
    langCode: s.bilingual.langCode || undefined,
    translatedLabel: s.bilingual.translatedLabel || undefined,
    bilingualLabel: s.bilingual.bilingualLabel || undefined,
    ext,
  });
}

/** 触发浏览器下载。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, filename: string, ext: string): void {
  downloadBlob(new Blob([content], { type: `text/${ext === "ass" ? "plain" : "srt"};charset=utf-8` }), filename);
}
