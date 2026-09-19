// 极简 ZIP 打包器（批量导出用，见改进建议 #7）。
//
// 只为「几十个字幕文本文件」服务，因此不做 zip64、不做加密、不做多盘卷：
// 文件全在内存里、大小已知，写「本地文件头 + 数据 + 中央目录 + EOCD」即可。
// 浏览器支持 CompressionStream 时用 deflate 压缩（字幕文本压缩率很高），否则原样存储。

export interface ZipFile {
  /** zip 内路径，用 / 分隔；保留原目录结构可省掉手工归位 */
  path: string;
  content: string | Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // 环境不支持 deflate-raw：退回「存储」模式
  }
}

/** DOS 时间/日期（ZIP 的时间戳格式，精度 2 秒）。 */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

class ByteWriter {
  private parts: Uint8Array[] = [];
  length = 0;
  push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.length += bytes.length;
  }
  u16(v: number) {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }
  u32(v: number) {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  toBlob(type: string): Blob {
    return new Blob(this.parts as BlobPart[], { type });
  }
  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** 打成一个 zip。路径里的反斜杠与前导斜杠会被规范化。 */
export async function buildZip(files: ZipFile[], now = new Date()): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const body = new ByteWriter();
  const central = new ByteWriter();
  let count = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.path.replace(/\\/g, "/").replace(/^\/+/, ""));
    const raw = typeof f.content === "string" ? enc.encode(f.content) : f.content;
    const crc = crc32(raw);
    const deflated = await deflateRaw(raw);
    const useDeflate = deflated != null && deflated.length < raw.length;
    const data = useDeflate ? deflated! : raw;
    const method = useDeflate ? 8 : 0;
    const offset = body.length;

    // 本地文件头
    body.u32(0x04034b50);
    body.u16(20); // version needed
    body.u16(0x0800); // 文件名为 UTF-8
    body.u16(method);
    body.u16(time);
    body.u16(date);
    body.u32(crc);
    body.u32(data.length);
    body.u32(raw.length);
    body.u16(nameBytes.length);
    body.u16(0); // extra
    body.push(nameBytes);
    body.push(data);

    // 中央目录项
    central.u32(0x02014b50);
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(0x0800);
    central.u16(method);
    central.u16(time);
    central.u16(date);
    central.u32(crc);
    central.u32(data.length);
    central.u32(raw.length);
    central.u16(nameBytes.length);
    central.u16(0); // extra
    central.u16(0); // comment
    central.u16(0); // disk number
    central.u16(0); // internal attrs
    central.u32(0); // external attrs
    central.u32(offset);
    central.push(nameBytes);
    count++;
  }

  const out = new ByteWriter();
  out.push(body.toBytes());
  const centralBytes = central.toBytes();
  const centralOffset = out.length;
  out.push(centralBytes);
  // EOCD
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(count);
  out.u16(count);
  out.u32(centralBytes.length);
  out.u32(centralOffset);
  out.u16(0);
  return out.toBytes();
}

export async function buildZipBlob(files: ZipFile[]): Promise<Blob> {
  const bytes = await buildZip(files);
  return new Blob([bytes as BlobPart], { type: "application/zip" });
}
