"use client";

import { useAppStore } from "@/store";
import { assemble, type BilingualLayout } from "@/core/bilingual";
import { serializeSrt } from "@/core/serializers/srt";
import { serializeAss, type AssLayout } from "@/core/serializers/ass";
import { buildExportName, type ExportType } from "@/core/naming";

function download(content: string, filename: string, ext: string) {
  const blob = new Blob([content], { type: `text/${ext === "ass" ? "plain" : "srt"};charset=utf-8` });
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
    const isAss = s.document.sourceFormat === "ass";
    const ext = isAss ? "ass" : "srt";

    let content: string;
    if (isAss) {
      // ASS：双语统一走「单条目双行（\N 堆叠）」，避免两条同位置 Dialogue 重叠。
      const layout: AssLayout = type === "translated" ? "translated-only" : "stacked";
      content = serializeAss(
        s.document,
        { layout, order: s.bilingual.order, collapseLines: s.bilingual.collapseLines },
        s.style,
        s.assStyle,
      );
    } else {
      const layout: BilingualLayout =
        type === "translated" ? "translated-only" : s.bilingual.layout === "translated-only" ? "dual-entry" : s.bilingual.layout;
      const cues = assemble(
        s.document,
        { layout, order: s.bilingual.order, collapseLines: s.bilingual.collapseLines },
        s.style,
      );
      content = serializeSrt(cues, { eol });
    }

    const filename = buildExportName({
      fileName: s.fileName,
      type,
      sourceLang: s.params.sourceLang,
      targetLang: s.params.targetLang,
      langCode: s.bilingual.langCode || undefined,
      translatedLabel: s.bilingual.translatedLabel || undefined,
      bilingualLabel: s.bilingual.bilingualLabel || undefined,
      ext,
    });
    download(content, filename, ext);
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
      ext: s.document?.sourceFormat === "ass" ? "ass" : "srt",
    });
  };

  return { exportTranslated: () => exportAs("translated"), exportBilingual: () => exportAs("bilingual"), previewName };
}
