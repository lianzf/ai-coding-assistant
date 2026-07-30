import { describe, expect, it } from "vitest";
import {
  ProviderConfigStore,
  type GlobalStatePort,
} from "../../src/providers/ProviderConfigStore.js";

class MemoryState implements GlobalStatePort {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  public update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

describe("ProviderConfigStore", () => {
  it("persists only non-secret provider configuration", async () => {
    const state = new MemoryState();
    const store = new ProviderConfigStore(state, () => Promise.resolve(true));

    const saved = await store.save({
      displayName: "Internal Gateway",
      baseUrl: "https://model.example.test/v1/",
      modelId: "model-a",
      timeoutMs: 30_000,
    });

    expect(saved.baseUrl).toBe("https://model.example.test/v1");
    expect(saved.hasApiKey).toBe(true);
    expect(JSON.stringify(state)).not.toContain("apiKey");
    expect(await store.get()).toMatchObject({
      displayName: "Internal Gateway",
      modelId: "model-a",
    });
  });

  it("ignores malformed stored data", async () => {
    const state = new MemoryState();
    await state.update("aiCodingAssistant.provider.default", {
      baseUrl: "not-a-url",
    });
    const store = new ProviderConfigStore(state, () => Promise.resolve(false));
    expect(await store.get()).toBeUndefined();
  });
});
