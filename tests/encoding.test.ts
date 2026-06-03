import { describe, expect, it } from "vitest";
import { decodeBytes, stripBom, normalizeLabel } from "@/core/encoding";

describe("编码处理", () => {
  it("UTF-8 无 BOM 正常解码", () => {
    const bytes = new TextEncoder().encode("你好 Barry");
    const r = decodeBytes(bytes);
    expect(r.text).toBe("你好 Barry");
  });

  it("去除 UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hi")]);
    const r = decodeBytes(bytes);
    expect(r.encoding).toBe("utf-8");
    expect(r.text).toBe("hi");
  });

  it("stripBom 移除前导 BOM 字符", () => {
    expect(stripBom("﻿abc")).toBe("abc");
    expect(stripBom("abc")).toBe("abc");
  });

  it("normalizeLabel 映射常见传统编码名", () => {
    expect(normalizeLabel("GB2312")).toBe("gbk");
    expect(normalizeLabel("Shift_JIS")).toBe("shift_jis");
    expect(normalizeLabel("Big5")).toBe("big5");
  });

  it("强制 utf-16le 解码", () => {
    // "hi" in UTF-16LE
    const bytes = new Uint8Array([0x68, 0x00, 0x69, 0x00]);
    const r = decodeBytes(bytes, "utf-16le");
    expect(r.text).toBe("hi");
  });
});
