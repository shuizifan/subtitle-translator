// 时间表示统一为毫秒（见规范 §3：避免各格式时间表示污染核心逻辑）。

/** "HH:MM:SS,mmm" 或 "HH:MM:SS.mmm" → 毫秒 */
export function timecodeToMs(h: string, m: string, s: string, ms: string): number {
  const millis = (ms + "000").slice(0, 3); // 兼容 1~3 位毫秒
  return (
    parseInt(h, 10) * 3_600_000 +
    parseInt(m, 10) * 60_000 +
    parseInt(s, 10) * 1_000 +
    parseInt(millis, 10)
  );
}

/** 毫秒 → SRT 时间码 "HH:MM:SS,mmm" */
export function msToSrtTimecode(totalMs: number): string {
  const ms = Math.max(0, Math.round(totalMs));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const millis = ms % 1_000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(millis, 3)}`;
}
