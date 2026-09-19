import { describe, expect, it } from "vitest";
import { detectLanguage } from "@/core/detect";

describe("源语言判定", () => {
  it("英语", () => {
    const r = detectLanguage([
      "What are you doing here?",
      "I told you that we have to leave before the sun comes up.",
      "But the others are not ready and they will not wait for us.",
    ]);
    expect(r.lang).toBe("English");
  });

  it("西班牙语（容器标签常误标为 lat）", () => {
    const r = detectLanguage([
      "¿Qué estás haciendo aquí?",
      "Te dije que los otros no están listos para salir.",
      "Pero esto es más difícil de lo que parece, y no hay tiempo.",
    ]);
    expect(r.lang).toBe("Spanish");
  });

  it("德语", () => {
    const r = detectLanguage([
      "Ich habe dir gesagt, dass wir nicht warten können.",
      "Die anderen sind noch nicht bereit und das ist ein Problem.",
      "Aber wir haben keine Zeit mehr, wir werden schon sehen.",
    ]);
    expect(r.lang).toBe("German");
  });

  it("俄语按字母表判定", () => {
    const r = detectLanguage(["Что ты здесь делаешь?", "Я же сказал тебе уходить."]);
    expect(r.lang).toBe("Russian");
  });

  it("日语（假名优先于汉字）", () => {
    const r = detectLanguage(["ここで何をしているの？", "もう時間がないから、行きましょう。"]);
    expect(r.lang).toBe("Japanese");
  });

  it("中文", () => {
    const r = detectLanguage(["你在这里做什么？", "我告诉过你，我们得在天亮前离开。"]);
    expect(r.lang).toBe("Chinese");
  });

  it("无法判定时回落 auto", () => {
    expect(detectLanguage(["♪", "- 1997 -", "..."]).lang).toBe("auto");
    expect(detectLanguage([]).lang).toBe("auto");
  });
});
