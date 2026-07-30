import { describe, expect, it } from "vitest";
import { ChangeManager, type ChangeWorkspaceGateway } from "../../src/changes/ChangeManager.js";
import type { FileChange } from "../../src/domain/change.js";

class MemoryWorkspace implements ChangeWorkspaceGateway {
  public readonly files = new Map<string, string>();
  public previewed: string | undefined;

  public read(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }

  public showDiff(change: FileChange): Promise<void> {
    this.previewed = change.id;
    return Promise.resolve();
  }

  public apply(change: FileChange): Promise<void> {
    this.files.set(change.path, change.proposedContent);
    return Promise.resolve();
  }

  public rollback(change: FileChange): Promise<void> {
    if (change.operation === "create") {
      this.files.delete(change.path);
    } else {
      this.files.set(change.path, change.originalContent ?? "");
    }
    return Promise.resolve();
  }
}

describe("ChangeManager", () => {
  it("refuses to apply a pending change before approval", async () => {
    const workspace = new MemoryWorkspace();
    workspace.files.set("src/a.ts", "old");
    const manager = new ChangeManager(workspace);
    const [change] = await manager.propose([
      {
        path: "src/a.ts",
        operation: "update",
        content: "new",
      },
    ]);

    expect(change).toBeDefined();
    await expect(manager.apply(change!.id)).rejects.toThrow("尚未获得用户批准");
    expect(workspace.files.get("src/a.ts")).toBe("old");
  });

  it("applies an approved update", async () => {
    const workspace = new MemoryWorkspace();
    workspace.files.set("src/a.ts", "old");
    const manager = new ChangeManager(workspace);
    const [change] = await manager.propose([
      {
        path: "src/a.ts",
        operation: "update",
        content: "new",
      },
    ]);
    manager.approve(change!.id);
    const result = await manager.apply(change!.id);

    expect(result.status).toBe("applied");
    expect(workspace.files.get("src/a.ts")).toBe("new");
  });

  it("blocks a stale approved change instead of overwriting user edits", async () => {
    const workspace = new MemoryWorkspace();
    workspace.files.set("src/a.ts", "baseline");
    const manager = new ChangeManager(workspace);
    const [change] = await manager.propose([
      {
        path: "src/a.ts",
        operation: "update",
        content: "model edit",
      },
    ]);
    manager.approve(change!.id);
    workspace.files.set("src/a.ts", "user edit");

    const result = await manager.apply(change!.id);
    expect(result.status).toBe("conflicted");
    expect(workspace.files.get("src/a.ts")).toBe("user edit");
  });

  it("restores an applied update from its safety checkpoint", async () => {
    const workspace = new MemoryWorkspace();
    workspace.files.set("src/a.ts", "old\nline");
    const manager = new ChangeManager(workspace);
    const [change] = await manager.propose([
      {
        path: "src/a.ts",
        operation: "update",
        content: "new\nline",
      },
    ]);
    manager.approve(change!.id);
    await manager.apply(change!.id);

    const result = await manager.rollback(change!.id);

    expect(result.status).toBe("rolled-back");
    expect(workspace.files.get("src/a.ts")).toBe("old\nline");
  });

  it("removes a newly created file when rolling back its checkpoint", async () => {
    const workspace = new MemoryWorkspace();
    const manager = new ChangeManager(workspace);
    const [change] = await manager.propose([
      {
        path: "src/new.ts",
        operation: "create",
        content: "export const value = 1;\n",
      },
    ]);
    manager.approve(change!.id);
    await manager.apply(change!.id);

    const result = await manager.rollback(change!.id);

    expect(result.status).toBe("rolled-back");
    expect(workspace.files.has("src/new.ts")).toBe(false);
  });

  it("blocks rollback when a user changed the applied file afterward", async () => {
    const workspace = new MemoryWorkspace();
    workspace.files.set("src/a.ts", "old");
    const manager = new ChangeManager(workspace);
    const [change] = await manager.propose([
      {
        path: "src/a.ts",
        operation: "update",
        content: "model edit",
      },
    ]);
    manager.approve(change!.id);
    await manager.apply(change!.id);
    workspace.files.set("src/a.ts", "user edit after model");

    const result = await manager.rollback(change!.id);

    expect(result.status).toBe("rollback-conflicted");
    expect(workspace.files.get("src/a.ts")).toBe("user edit after model");
  });

  it("groups one model response into a task checkpoint and calculates line statistics", async () => {
    const workspace = new MemoryWorkspace();
    workspace.files.set("src/a.ts", "keep\nremove");
    const manager = new ChangeManager(workspace);

    const changes = await manager.propose([
      {
        path: "src/a.ts",
        operation: "update",
        content: "keep\nadd",
      },
      {
        path: "src/b.ts",
        operation: "create",
        content: "one\ntwo",
      },
    ]);

    expect(new Set(changes.map((change) => change.groupId)).size).toBe(1);
    expect(changes[0]).toMatchObject({ addedLines: 1, deletedLines: 1 });
    expect(changes[1]).toMatchObject({ addedLines: 2, deletedLines: 0 });
    expect(manager.latestPendingGroup()).toHaveLength(2);
  });
});
