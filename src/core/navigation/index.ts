import type { SubtitleEntry } from "@/core/model";

/** 失败行按字幕顺序排列；手动补译或排除后不再参与定位。 */
export function getFailedEntryIds(entries: SubtitleEntry[], failedIds: number[]): number[] {
  const failed = new Set(failedIds);
  return entries
    .filter((entry) => failed.has(entry.id) && !entry.excluded && entry.originalText.trim() && !entry.translatedText?.trim())
    .map((entry) => entry.id);
}

/** 首尾循环，当前行修复后仍从原行号继续查找。字幕行号随顺序递增。 */
export function adjacentFailedId(ids: number[], currentId: number | null, direction: 1 | -1): number | null {
  if (ids.length === 0) return null;
  if (currentId === null) return direction === 1 ? ids[0] : ids[ids.length - 1];
  if (direction === 1) return ids.find((id) => id > currentId) ?? ids[0];
  return [...ids].reverse().find((id) => id < currentId) ?? ids[ids.length - 1];
}
