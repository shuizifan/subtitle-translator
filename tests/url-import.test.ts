import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProfileShareUrl } from "@/core/translator/profileSharing";
import { defaultGeneration } from "@/core/translator/config";
import { useUrlImport } from "@/lib/useUrlImport";
import { newProfile, useAppStore } from "@/store";

vi.mock("react", () => ({
  useEffect: (fn: () => void) => fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
}));

const shared = newProfile({ name: "分享服务", baseURL: "https://api.example.com/v1", model: "model-a", apiKey: "test-only-key", modelConfigs: { "model-a": { ...defaultGeneration(), temperature: 0.3 } } });

describe("分享链接导入确认", () => {
  beforeEach(() => useAppStore.setState({ apiProfiles: [], activeProfileId: null }));

  function setup(accepted: boolean, href = buildProfileShareUrl("https://app.test", shared)) {
    const replaceState = vi.fn();
    const confirm = vi.fn(() => {
      expect(replaceState).toHaveBeenCalledWith(null, "", "/");
      expect(useAppStore.getState().apiProfiles).toEqual([]);
      return accepted;
    });
    const alert = vi.fn();
    vi.stubGlobal("window", { location: { href }, history: { replaceState }, confirm, alert });
    return { confirm, alert };
  }

  it("先清理地址，确认后包含密钥和参数并启用新服务", () => {
    const { confirm } = setup(true);
    useUrlImport();
    const state = useAppStore.getState();
    expect(confirm).toHaveBeenCalledOnce();
    expect(JSON.stringify(confirm.mock.calls[0])).not.toContain(shared.apiKey);
    expect(state.apiProfiles).toHaveLength(1);
    expect(state.apiProfiles[0]).toMatchObject({ apiKey: shared.apiKey, rememberKey: true, modelConfigs: shared.modelConfigs });
    expect(state.activeProfileId).toBe(state.apiProfiles[0].id);
  });

  it("取消后不导入、不切换服务", () => {
    setup(false);
    useUrlImport();
    expect(useAppStore.getState().apiProfiles).toEqual([]);
    expect(useAppStore.getState().activeProfileId).toBeNull();
  });

  it("旧 query 链接也需确认并导入密钥", () => {
    setup(true, "https://app.test/?baseURL=https%3A%2F%2Fapi.example.com%2Fv1&model=a&apiKey=legacy-test-key");
    useUrlImport();
    expect(useAppStore.getState().apiProfiles[0].apiKey).toBe("legacy-test-key");
  });

  it("畸形参数不导入", () => {
    const { confirm, alert } = setup(true, "https://app.test/#baseURL=https%3A%2F%2Fapi.example.com%2Fv1&generation=%7B%7D");
    useUrlImport();
    expect(confirm).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledOnce();
    expect(useAppStore.getState().apiProfiles).toEqual([]);
  });
});
