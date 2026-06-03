"use client";

import { useAppStore } from "@/store";
import { assemble, type BilingualLayout } from "@/core/bilingual";
import { serializeSrt } from "@/core/serializers/srt";
import { buildExportName, type ExportType } from "@/core/naming";

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/srt;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 顶部「导出仅译文 / 导出双语」按钮共用的导出逻辑。 */
export function useExport() {
  const exportAs = (type: ExportType) => {
    const s = useAppStore.getState();
    if (!s.document || !s.fileName) return;
    const eol = (s.document.meta.eol as "\r\n" | "\n") ?? "\r\n";

    const layout: BilingualLayout =
      type === "translated" ? "translated-only" : s.bilingual.layout === "translated-only" ? "dual-entry" : s.bilingual.layout;

    const cues = assemble(
      s.document,
      { layout, order: s.bilingual.order, collapseLines: s.bilingual.collapseLines },
      s.style,
    );
    const srt = serializeSrt(cues, { eol });
    const filename = buildExportName({
      fileName: s.fileName,
      type,
      sourceLang: s.params.sourceLang,
      targetLang: s.params.targetLang,
      langCode: s.bilingual.langCode || undefined,
      translatedLabel: s.bilingual.translatedLabel || undefined,
      bilingualLabel: s.bilingual.bilingualLabel || undefined,
    });
    download(srt, filename);
  };

  const previewName = (type: ExportType): string => {
    const s = useAppStore.getState();
    if (!s.fileName) return "";
    return buildExportName({
      fileName: s.fileName,
      type,
      sourceLang: s.params.sourceLang,
      targetLang: s.params.targetLang,
      langCode: s.bilingual.langCode || undefined,
      translatedLabel: s.bilingual.translatedLabel || undefined,
      bilingualLabel: s.bilingual.bilingualLabel || undefined,
    });
  };

  return { exportTranslated: () => exportAs("translated"), exportBilingual: () => exportAs("bilingual"), previewName };
}
