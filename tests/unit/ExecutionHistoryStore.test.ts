import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import { describe, expect, it } from "vitest";
import { ExecutionHistoryStore } from "../../src/chat/ExecutionHistoryStore.js";

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

describe("ExecutionHistoryStore", () => {
  it("persists task status, tool steps and duration by session", async () => {
    const state = createMemento();
    const store = new ExecutionHistoryStore(state);
    const sessionId = randomUUID();
    const requestId = randomUUID();

    await store.start(sessionId, requestId, "chat", "agent");
    await store.setStatus(requestId, "正在读取文件…");
    await store.startStep(requestId, {
      id: "read-1",
      name: "read_workspace_file",
      label: "读取工作区文件",
      input: "src/index.ts",
      status: "running",
      summary: "",
    });
    await store.finishStep(requestId, "read-1", true, "已读取 src/index.ts", 42);
    await store.finish(requestId, "completed", "任务已完成");

    const restored = new ExecutionHistoryStore(state).list(sessionId);
    expect(restored).toEqual([
      expect.objectContaining({
        requestId,
        mode: "agent",
        status: "completed",
        summary: "任务已完成",
        steps: [
          expect.objectContaining({
            id: "read-1",
            status: "completed",
            durationMs: 42,
          }),
        ],
      }),
    ]);
  });

  it("marks an unfinished task as interrupted after extension reload", async () => {
    const state = createMemento();
    const sessionId = randomUUID();
    const requestId = randomUUID();
    const store = new ExecutionHistoryStore(state);

    await store.start(sessionId, requestId, "chat", "plan");
    await store.startStep(requestId, {
      id: "search-1",
      name: "search_workspace",
      label: "搜索工作区",
      input: "createOrder",
      status: "running",
      summary: "",
    });

    const restored = new ExecutionHistoryStore(state).list(sessionId)[0];
    expect(restored).toMatchObject({
      status: "failed",
      summary: "VS Code 已重载，上一任务执行状态已中断。",
      steps: [{ status: "failed", summary: "VS Code 重载时该步骤尚未完成" }],
    });
  });

  it("removes execution history together with a deleted session", async () => {
    const state = createMemento();
    const sessionId = randomUUID();
    const store = new ExecutionHistoryStore(state);

    await store.start(sessionId, randomUUID(), "test");
    await store.removeSession(sessionId);

    expect(store.list(sessionId)).toEqual([]);
  });

  it("keeps valid task records when one stored entry is malformed", async () => {
    const state = createMemento();
    const sessionId = randomUUID();
    const store = new ExecutionHistoryStore(state);

    await store.start(sessionId, randomUUID(), "chat", "ask");
    const stored = state.get<{
      readonly version: 1;
      readonly records: readonly unknown[];
    }>("aiCodingAssistant.executionHistory.v1");
    await state.update("aiCodingAssistant.executionHistory.v1", {
      version: 1,
      records: [...(stored?.records ?? []), { requestId: "not-a-uuid" }],
    });

    expect(new ExecutionHistoryStore(state).list(sessionId)).toHaveLength(1);
  });
});
