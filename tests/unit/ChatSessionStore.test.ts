import type * as vscode from "vscode";
import { describe, expect, it } from "vitest";
import { ChatSessionStore } from "../../src/chat/ChatSessionStore.js";

function createMemento(): vscode.Memento {
  const values = new Map<string, unknown>();
  return {
    keys: () => [...values.keys()],
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (values.has(key) ? values.get(key) : defaultValue) as T | undefined,
    update: (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

describe("ChatSessionStore", () => {
  it("creates, titles and restores a multi-turn conversation", async () => {
    const store = new ChatSessionStore(createMemento());
    const session = await store.ensure();

    await store.appendUser(session.id, "请分析当前项目的主要模块", "plan");
    await store.appendAssistant(session.id, "request-1", "项目包含三个主要模块。", "plan");

    const restored = store.get(session.id);
    expect(restored?.title).toBe("请分析当前项目的主要模块");
    expect(restored?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(restored?.messages[1]?.mode).toBe("plan");
    expect(store.list()).toEqual([
      expect.objectContaining({
        id: session.id,
        messageCount: 2,
      }),
    ]);
  });

  it("always leaves an active replacement after deleting the last conversation", async () => {
    const store = new ChatSessionStore(createMemento());
    const session = await store.ensure();

    const replacement = await store.remove(session.id);

    expect(replacement.id).not.toBe(session.id);
    expect(store.list()).toHaveLength(1);
  });

  it("archives a conversation read-only and restores it later", async () => {
    const store = new ChatSessionStore(createMemento());
    const session = await store.ensure();

    const fallback = await store.archive(session.id);

    expect(fallback.id).not.toBe(session.id);
    expect(store.list().find((item) => item.id === session.id)?.archived).toBe(true);
    await expect(store.appendUser(session.id, "继续", "ask")).rejects.toThrow("已归档");

    await store.restore(session.id);

    expect(store.get(session.id)?.archivedAt).toBeUndefined();
    expect(store.list().find((item) => item.id === session.id)?.archived).toBe(false);
  });
});
