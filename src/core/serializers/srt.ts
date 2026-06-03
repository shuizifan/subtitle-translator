// SRT 序列化器（见规范 §3、§7）：输出 cue 列表 → SRT 文本。
// 序号连续重编（双条目布局下两条共用时间轴、序号连续，匹配用户参考字幕）。

import type { OutputCue } from "@/core/bilingual";
import { msToSrtTimecode } from "@/core/time";

export interface SerializeSrtOptions {
  /** 换行符，默认 CRLF（多数播放器与参考字幕一致） */
  eol?: "\r\n" | "\n";
}

export function serializeSrt(cues: OutputCue[], opts: SerializeSrtOptions = {}): string {
  const eol = opts.eol ?? "\r\n";
  const blocks = cues.map((cue, idx) => {
    const num = idx + 1;
    const tc = `${msToSrtTimecode(cue.start)} --> ${msToSrtTimecode(cue.end)}`;
    const body = cue.text.replace(/\r\n/g, "\n").replace(/\n/g, eol);
    return `${num}${eol}${tc}${eol}${body}`;
  });
  // 块间空行分隔，文件以换行结尾
  return blocks.join(eol + eol) + eol;
}
