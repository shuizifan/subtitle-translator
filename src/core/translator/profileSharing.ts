import type { ApiProfile } from "@/store";
import { buildChatCompletionsUrl } from "./config";

/** 只分享允许的非敏感字段；不序列化整个 profile。 */
export function buildProfileShareUrl(pageUrl: string, profile: ApiProfile): string {
  buildChatCompletionsUrl(profile.baseURL);
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("baseURL", profile.baseURL);
  url.searchParams.set("model", profile.model);
  url.searchParams.set("name", profile.name);
  return url.toString();
}

export function readSharedProfile(params: URLSearchParams): Partial<ApiProfile> | null {
  const baseURL = params.get("baseURL") ?? params.get("base_url") ?? params.get("base") ?? "";
  if (!baseURL) return null;
  buildChatCompletionsUrl(baseURL);
  const model = params.get("model") ?? "";
  const name = params.get("name") || new URL(baseURL).hostname;
  if (baseURL.length > 2048 || model.length > 200 || name.length > 200) throw new Error("分享配置字段过长");
  return { baseURL, model, name, apiKey: "", rememberKey: false, authMode: "bearer" };
}

/** 改变服务器 origin 清除旧 Key；改变端点使旧能力/参数覆盖失效。 */
export function updateProfileSafely(profile: ApiProfile, patch: Partial<ApiProfile>): ApiProfile {
  const next = { ...profile, ...patch };
  if (patch.baseURL !== undefined && patch.baseURL !== profile.baseURL) {
    let sameOrigin = false;
    try { sameOrigin = new URL(patch.baseURL).origin === new URL(profile.baseURL).origin; } catch { /* 无效地址不复用密钥 */ }
    if (!sameOrigin) next.apiKey = "";
    next.modelConfigs = {};
  }
  return next;
}
