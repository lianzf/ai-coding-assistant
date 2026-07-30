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
});
