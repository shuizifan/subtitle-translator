import { describe, expect, it } from "vitest";
import { buildZip, crc32 } from "@/core/zip";

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("zip 打包", () => {
  it("CRC32 与已知值一致", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("结构正确且内容可还原", async () => {
    const files = [
      { path: "movie/a.AI中英双语.chs.srt", content: "1\r\n00:00:01,000 --> 00:00:02,000\r\n你好\r\n".repeat(50) },
      { path: "movie/b.srt", content: "hello" },
    ];
    const zip = await buildZip(files);
    const view = dv(zip);

    // EOCD 在末尾，记录 2 个条目
    const eocd = zip.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);

    // 第一个本地文件头
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const method = view.getUint16(8, true);
    const compSize = view.getUint32(18, true);
    const rawSize = view.getUint32(22, true);
    const nameLen = view.getUint16(26, true);
    const extraLen = view.getUint16(28, true);
    const name = new TextDecoder().decode(zip.slice(30, 30 + nameLen));
    expect(name).toBe("movie/a.AI中英双语.chs.srt");

    const dataStart = 30 + nameLen + extraLen;
    const data = zip.slice(dataStart, dataStart + compSize);
    const restored = method === 8 ? await inflateRaw(data) : data;
    expect(new TextDecoder().decode(restored)).toBe(files[0].content);
    expect(rawSize).toBe(new TextEncoder().encode(files[0].content).length);
    // 重复度高的字幕文本应当被压缩
    expect(method).toBe(8);
    expect(compSize).toBeLessThan(rawSize);
  });

  it("路径规范化（去前导斜杠、反斜杠转斜杠）", async () => {
    const zip = await buildZip([{ path: "\\sub\\x.srt", content: "x" }]);
    const view = dv(zip);
    const nameLen = view.getUint16(26, true);
    expect(new TextDecoder().decode(zip.slice(30, 30 + nameLen))).toBe("sub/x.srt");
  });
});
