import { describe, expect, it } from "vitest";
import { PermissionStore, type PermissionStatePort } from "../../src/security/PermissionStore.js";

class MemoryState implements PermissionStatePort {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  public update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

describe("PermissionStore", () => {
  it("uses safe defaults and persists independent permission modes", async () => {
    const store = new PermissionStore(new MemoryState());

    expect(store.get()).toEqual({
      read: "allow",
      network: "allow",
      modify: "ask",
      command: "ask",
    });

    await store.update("network", "deny");
    await store.update("read", "ask");

    expect(store.get()).toEqual({
      read: "ask",
      network: "deny",
      modify: "ask",
      command: "ask",
    });
    expect(() => store.assertAvailable("network")).toThrow("离线模式");
    expect(() => store.assertAvailable("read")).not.toThrow();
  });

  it("notifies views and ignores malformed stored state", async () => {
    const state = new MemoryState();
    await state.update("aiCodingAssistant.permissions.v1", { network: "deny" });
    const store = new PermissionStore(state);
    let notifications = 0;
    const subscription = store.onDidChange(() => {
      notifications += 1;
    });

    expect(store.get().read).toBe("allow");
    await store.update("command", "deny");
    subscription.dispose();
    await store.update("command", "allow");

    expect(notifications).toBe(1);
  });
});
