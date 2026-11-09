"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore, newProfile, snapshotSettings } from "@/store";
import { buildChatCompletionsUrl } from "@/core/translator/config";
import { readSharedProfile } from "@/core/translator/profileSharing";

export interface UrlImportResult { imported: boolean; profileName: string }

/** 打开分享链接时，清理地址并确认后导入、启用服务。 */
export function useUrlImport(): UrlImportResult | null {
  const [result, setResult] = useState<UrlImportResult | null>(null);
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const url = new URL(window.location.href);
    const fields = ["apiKey", "api_key", "baseURL", "base_url", "base", "model", "name", "generation"];
    const fragment = new URLSearchParams(url.hash.slice(1));
    const hasFragment = ["baseURL", "base_url", "base"].some((field) => fragment.has(field));
    if (!hasFragment && !fields.some((field) => url.searchParams.has(field))) return;
    const params = hasFragment ? fragment : new URLSearchParams(url.search);
    fields.forEach((field) => url.searchParams.delete(field));
    if (hasFragment) url.hash = "";
    // 清理不能撤回已传输的旧 URL。
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    try {
      const shared = readSharedProfile(params);
      if (!shared) return;
      if (!window.confirm(`导入并使用此配置？\n\n${shared.name} · ${shared.model || "未填写模型"}\n${buildChatCompletionsUrl(shared.baseURL!)}\n\n${shared.apiKey ? "包含 API Key，将保存到本机。" : "未包含 API Key，导入后需补充。"}`)) return;
      const state = useAppStore.getState();
      const profile = newProfile(shared);
      state.applySettings({ ...snapshotSettings(state), apiProfiles: [...state.apiProfiles, profile], activeProfileId: profile.id });
      setResult({ imported: true, profileName: profile.name });
    } catch (error) {
      window.alert(error instanceof Error ? `配置未导入：${error.message}` : "配置未导入：无效分享链接");
    }
  }, []);
  return result;
}
