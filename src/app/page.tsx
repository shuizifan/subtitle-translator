"use client";

import { useState } from "react";
import { useAppStore } from "@/store";
import { Toolbar } from "@/components/Toolbar";
import { ControlBar } from "@/components/ControlBar";
import { SubtitleTable } from "@/components/SubtitleTable";
import { EmptyState } from "@/components/EmptyState";
import { SettingsDialog } from "@/components/SettingsDialog";
import { GlobalDropzone } from "@/components/GlobalDropzone";
import { SubtitleLoaderProvider } from "@/lib/SubtitleLoaderContext";
import { useUrlImport } from "@/lib/useUrlImport";

export default function Home() {
  const hasDoc = useAppStore((s) => s.document != null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const urlImport = useUrlImport();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const showBanner = urlImport?.imported && !bannerDismissed;

  return (
    <SubtitleLoaderProvider>
      <GlobalDropzone>
        <main className="min-h-screen">
          {showBanner && (
            <div className="flex items-center justify-between gap-3 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              <span>
                ✓ 已从链接导入 API 配置「{urlImport.profileName}」，可在设置中查看或修改。
              </span>
              <button
                className="shrink-0 text-emerald-600 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-100"
                onClick={() => setBannerDismissed(true)}
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
          )}

          <Toolbar onOpenSettings={() => setSettingsOpen(true)} />

          {hasDoc ? (
            <>
              <ControlBar onOpenSettings={() => setSettingsOpen(true)} />
              <SubtitleTable />
            </>
          ) : (
            <EmptyState />
          )}

          <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </main>
      </GlobalDropzone>
    </SubtitleLoaderProvider>
  );
}
