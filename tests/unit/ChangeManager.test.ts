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
});
