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

  it("stores multiple providers and routes each mode independently", async () => {
    const state = new MemoryState();
    const keyedProviders = new Set(["deepseek"]);
    const store = new ProviderConfigStore(state, (providerId) =>
      Promise.resolve(keyedProviders.has(providerId)),
    );

    await store.save(
      {
        displayName: "DeepSeek",
        baseUrl: "https://deepseek.example.test/v1",
        modelId: "deepseek-chat",
        timeoutMs: 120_000,
      },
      "deepseek",
    );
    await store.save(
      {
        displayName: "Local",
        baseUrl: "http://127.0.0.1:11434/v1",
        modelId: "qwen",
        timeoutMs: 60_000,
      },
      "local",
    );
    await store.assign("agent", "local");

    expect(await store.list()).toHaveLength(2);
    expect((await store.get("deepseek"))?.hasApiKey).toBe(true);
    expect((await store.getForMode("ask"))?.id).toBe("deepseek");
    expect((await store.getForMode("agent"))?.id).toBe("local");
    expect(store.getAssignments()).toEqual({
      ask: "deepseek",
      plan: "deepseek",
      agent: "local",
    });
  });

  it("retains the legacy default provider and reassigns modes after deletion", async () => {
    const state = new MemoryState();
    await state.update("aiCodingAssistant.provider.default", {
      id: "default",
      displayName: "Legacy",
      baseUrl: "https://legacy.example.test/v1",
      modelId: "legacy-model",
      timeoutMs: 30_000,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const store = new ProviderConfigStore(state, () => Promise.resolve(true));

    expect((await store.getForMode("ask"))?.id).toBe("default");
    await store.save(
      {
        displayName: "Replacement",
        baseUrl: "https://new.example.test/v1",
        modelId: "new-model",
        timeoutMs: 30_000,
      },
      "replacement",
    );
    await store.assign("ask", "default");
    await store.remove("default");

    expect((await store.getForMode("ask"))?.id).toBe("replacement");
    expect(store.getAssignments()).toEqual({
      ask: "replacement",
      plan: "replacement",
      agent: "replacement",
    });
  });

  it("notifies all open views when provider state changes", async () => {
    const state = new MemoryState();
    const store = new ProviderConfigStore(state, () => Promise.resolve(false));
    let notifications = 0;
    const subscription = store.onDidChange(() => {
      notifications += 1;
    });

    await store.save(
      {
        displayName: "Shared",
        baseUrl: "https://shared.example.test/v1",
        modelId: "shared-model",
        timeoutMs: 30_000,
      },
      "shared",
    );
    await store.assign("plan", "shared");
    subscription.dispose();
    await store.remove("shared");

    expect(notifications).toBe(2);
  });
});
