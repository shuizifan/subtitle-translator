"use client";

import { useState } from "react";
import { useAppStore } from "@/store";
import { Toolbar } from "@/components/Toolbar";
import { ControlBar } from "@/components/ControlBar";
import { SubtitleTable } from "@/components/SubtitleTable";
import { EmptyState } from "@/components/EmptyState";
import { SettingsDialog } from "@/components/SettingsDialog";

export default function Home() {
  const hasDoc = useAppStore((s) => s.document != null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <main className="min-h-screen">
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
  );
}
