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

/** ASS 时间码 "H:MM:SS.cc"（cc 为厘秒，两位）→ 毫秒。 */
export function assTimecodeToMs(tc: string): number {
  const m = /^\s*(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,2})\s*$/.exec(tc);
  if (!m) return 0;
  const cs = (m[4] + "00").slice(0, 2); // 兼容 1~2 位厘秒
  return (
    parseInt(m[1], 10) * 3_600_000 +
    parseInt(m[2], 10) * 60_000 +
    parseInt(m[3], 10) * 1_000 +
    parseInt(cs, 10) * 10
  );
}

/** 毫秒 → ASS 时间码 "H:MM:SS.cc"。 */
export function msToAssTimecode(totalMs: number): string {
  // 先四舍五入到厘秒再拆分，避免 cs=round(995/10)=100 这类溢出未进位
  const totalCs = Math.max(0, Math.round(totalMs / 10));
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60) % 60;
  const h = Math.floor(totalS / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}
