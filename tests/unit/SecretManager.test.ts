import { describe, expect, it } from "vitest";
import { SecretManager, type SecretStoragePort } from "../../src/security/SecretManager.js";

class MemorySecrets implements SecretStoragePort {
  public readonly values = new Map<string, string>();

  public get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  public store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  public delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

describe("SecretManager", () => {
  it("stores, reports and deletes the API key only through the secret port", async () => {
    const storage = new MemorySecrets();
    const manager = new SecretManager(storage);

    expect(await manager.hasApiKey()).toBe(false);
    await manager.setApiKey("  sk-private-value  ");

    expect(await manager.hasApiKey()).toBe(true);
    expect(await manager.getApiKey()).toBe("sk-private-value");
    expect([...storage.values.values()]).toEqual(["sk-private-value"]);

    await manager.deleteApiKey();
    expect(await manager.getApiKey()).toBeUndefined();
  });

  it("rejects an empty secret", async () => {
    const manager = new SecretManager(new MemorySecrets());
    await expect(manager.setApiKey("   ")).rejects.toThrow("不能为空");
  });

  it("isolates API keys between provider configurations while retaining the legacy default key", async () => {
    const storage = new MemorySecrets();
    const manager = new SecretManager(storage);

    await manager.setApiKey("legacy-secret");
    await manager.setApiKey("deepseek-secret", "deepseek");
    await manager.setApiKey("local-secret", "local_model");

    expect(await manager.getApiKey()).toBe("legacy-secret");
    expect(await manager.getApiKey("deepseek")).toBe("deepseek-secret");
    expect(await manager.getApiKey("local_model")).toBe("local-secret");
    expect([...storage.values.keys()]).toEqual([
      "aiCodingAssistant.provider.default.apiKey",
      "aiCodingAssistant.provider.deepseek.apiKey",
      "aiCodingAssistant.provider.local_model.apiKey",
    ]);
  });

  it("rejects unsafe provider IDs", async () => {
    const manager = new SecretManager(new MemorySecrets());
    await expect(manager.setApiKey("secret", "../unsafe")).rejects.toThrow("ID 无效");
  });
});
