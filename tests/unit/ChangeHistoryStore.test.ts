import type * as vscode from "vscode";
import { describe, expect, it } from "vitest";
import { ChangeHistoryStore } from "../../src/changes/ChangeHistoryStore.js";
import type { FileChange } from "../../src/domain/change.js";

function createMemento(initial?: unknown): vscode.Memento {
  const values = new Map<string, unknown>();
  if (initial !== undefined) {
    values.set("aiCodingAssistant.changeHistory.v1", initial);
  }
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

const validChange: FileChange = {
  id: "5c69fda2-a042-4b42-9e52-c6a49faf1ea8",
  groupId: "fa6c3c8f-a76f-4b1a-9d97-2c85266f0b9c",
  path: "src/example.ts",
  operation: "update",
  originalContent: "const value = 1;\n",
  proposedContent: "const value = 2;\n",
  originalHash: "a".repeat(64),
  appliedHash: "b".repeat(64),
  addedLines: 1,
  deletedLines: 1,
  reason: "更新示例",
  status: "applied",
  createdAt: "2026-07-30T00:00:00.000Z",
};

describe("ChangeHistoryStore", () => {
  it("persists and restores review and rollback data", async () => {
    const state = createMemento();
    const store = new ChangeHistoryStore(state);

    await store.save([validChange]);

    expect(store.load()).toEqual([validChange]);
  });

  it("drops corrupt, absolute and traversing records independently", () => {
    const store = new ChangeHistoryStore(
      createMemento([
        validChange,
        { ...validChange, id: crypto.randomUUID(), path: "C:\\secret.txt" },
        { ...validChange, id: crypto.randomUUID(), path: "../outside.ts" },
        { ...validChange, id: crypto.randomUUID(), path: ".env" },
        { ...validChange, id: "not-a-uuid" },
      ]),
    );

    expect(store.load()).toEqual([validChange]);
  });

  it("ignores a non-array storage value", () => {
    expect(new ChangeHistoryStore(createMemento({})).load()).toEqual([]);
  });

  it("never persists a partial task checkpoint when the record limit is exceeded", async () => {
    const state = createMemento();
    const store = new ChangeHistoryStore(state);
    const oversizedGroup = Array.from({ length: 101 }, (_, index): FileChange => ({
      ...validChange,
      id: `${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
      path: `src/file-${index}.ts`,
    }));

    await store.save(oversizedGroup);

    expect(store.load()).toEqual([]);
  });
});
