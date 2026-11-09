"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore, newProfile, snapshotSettings } from "@/store";
import { buildChatCompletionsUrl } from "@/core/translator/config";
import { readSharedProfile } from "@/core/translator/profileSharing";

export interface UrlImportResult { imported: boolean; profileName: string }

/** 分享配置先预览确认；旧链接密钥一律忽略，不自动切换活动服务。 */
export function useUrlImport(): UrlImportResult | null {
  const [result, setResult] = useState<UrlImportResult | null>(null);
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const url = new URL(window.location.href);
    const fields = ["apiKey", "api_key", "baseURL", "base_url", "base", "model", "name"];
    if (!fields.some((field) => url.searchParams.has(field))) return;
    const params = new URLSearchParams(url.search);
    fields.forEach((field) => url.searchParams.delete(field));
    // 清理不能撤回已传输的旧 URL。
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    try {
      const shared = readSharedProfile(params);
      if (!shared) return;
      if (!window.confirm(`导入翻译服务配置？\n名称：${shared.name}\n模型：${shared.model || "未填写"}\n请求地址：${buildChatCompletionsUrl(shared.baseURL!)}\n\n链接中的密钥不会导入，请自行填写。导入不会切换当前服务。`)) return;
      const state = useAppStore.getState();
      const profile = newProfile(shared);
      state.applySettings({ ...snapshotSettings(state), apiProfiles: [...state.apiProfiles, profile] });
      setResult({ imported: true, profileName: profile.name });
    } catch (error) {
      window.alert(error instanceof Error ? `配置未导入：${error.message}` : "配置未导入：无效分享链接");
    }
  }, []);
  return result;
}
