"use client";

import { useEffect, useState } from "react";
import { useAppStore, newProfile } from "@/store";

export interface UrlImportResult {
  imported: boolean;
  profileName: string;
}

/**
 * 从 URL 参数读取 OpenAI 兼容的 API 配置并导入到 store。
 * 支持的参数：apiKey、baseURL、model、name。
 * 导入后清除 URL 参数，避免刷新重复导入或 API Key 留在历史记录。
 */
export function useUrlImport(): UrlImportResult | null {
  const [result, setResult] = useState<UrlImportResult | null>(null);
  const applySettings = useAppStore((s) => s.applySettings);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const apiKey = params.get("apiKey") ?? params.get("api_key") ?? "";
    const baseURL = params.get("baseURL") ?? params.get("base_url") ?? params.get("base") ?? "";
    const model = params.get("model") ?? "";
    const name = params.get("name") ?? "";

    if (!apiKey && !baseURL) return;

    const state = useAppStore.getState();
    let profileName = name;
    if (!profileName) {
      try { profileName = new URL(baseURL).hostname; } catch { profileName = ""; }
      profileName = profileName || "Shared Config";
    }
    const profile = newProfile({ name: profileName, apiKey, baseURL, model });

    applySettings({
      apiProfiles: [...state.apiProfiles, profile],
      activeProfileId: profile.id,
      params: state.params,
      bilingual: state.bilingual,
      style: state.style,
      assStyle: state.assStyle,
    });

    // 清除 URL 参数，防止 API Key 残留在浏览器历史
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState(null, "", clean);

    setResult({ imported: true, profileName });
  }, [applySettings]);

  return result;
}
