"use client";

import { useAppStore } from "@/store";
import { buildExport, downloadText, exportName, type ExportSettings } from "@/lib/exportDoc";
import type { ExportType } from "@/core/naming";

function settingsOf(s: ReturnType<typeof useAppStore.getState>): ExportSettings {
  return { params: s.params, bilingual: s.bilingual, style: s.style, assStyle: s.assStyle };
}

/** 顶部「导出仅译文 / 导出双语」按钮共用的导出逻辑。 */
export function useExport() {
  const exportAs = (type: ExportType) => {
    const s = useAppStore.getState();
    if (!s.document || !s.fileName) return;
    const out = buildExport(s.document, s.fileName, type, settingsOf(s));
    downloadText(out.content, out.filename, out.ext);
  };

  const previewName = (type: ExportType): string => {
    const s = useAppStore.getState();
    if (!s.fileName) return "";
    return exportName(s.fileName, type, s.document?.sourceFormat === "ass" ? "ass" : "srt", settingsOf(s));
  };

  return { exportTranslated: () => exportAs("translated"), exportBilingual: () => exportAs("bilingual"), previewName };
}
