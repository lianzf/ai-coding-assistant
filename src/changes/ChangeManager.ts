import { createHash, randomUUID } from "node:crypto";
import type { ChangeSpec, FileChange } from "../domain/change.js";

export interface ChangeWorkspaceGateway {
  read(path: string): Promise<string | undefined>;
  showDiff(change: FileChange): Promise<void>;
  apply(change: FileChange): Promise<void>;
}

type ChangeListener = (changes: readonly FileChange[]) => void;

export class ChangeManager {
  private readonly changes = new Map<string, FileChange>();
  private readonly listeners = new Set<ChangeListener>();

  public constructor(private readonly workspace: ChangeWorkspaceGateway) {}

  public onDidChange(listener: ChangeListener): { dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public list(): readonly FileChange[] {
    return [...this.changes.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public latestPending(): FileChange | undefined {
    return this.list().find(
      (change) => change.status === "pending" || change.status === "approved",
    );
  }

  public get(id: string): FileChange {
    const change = this.changes.get(id);
    if (!change) {
      throw new Error("待审核修改不存在或已失效。");
    }
    return change;
  }

  public async propose(specs: readonly ChangeSpec[]): Promise<readonly FileChange[]> {
    const proposed: FileChange[] = [];
    for (const spec of specs) {
      const originalContent = await this.workspace.read(spec.path);
      if (spec.operation === "create" && originalContent !== undefined) {
        throw new Error(`无法创建已存在的文件：${spec.path}`);
      }
      if (spec.operation === "update" && originalContent === undefined) {
        throw new Error(`无法修改不存在的文件：${spec.path}`);
      }
      const change: FileChange = {
        id: randomUUID(),
        path: spec.path,
        operation: spec.operation,
        ...(originalContent !== undefined
          ? {
              originalContent,
              originalHash: this.hash(originalContent),
            }
          : {}),
        proposedContent: spec.content,
        ...(spec.reason ? { reason: spec.reason } : {}),
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      this.changes.set(change.id, change);
      proposed.push(change);
    }
    this.emit();
    return proposed;
  }

  public preview(id: string): Promise<void> {
    return this.workspace.showDiff(this.get(id));
  }

  public approve(id: string): FileChange {
    const current = this.get(id);
    if (current.status !== "pending") {
      throw new Error("只有待审核修改可以批准。");
    }
    const approved = { ...current, status: "approved" as const };
    this.changes.set(id, approved);
    this.emit();
    return approved;
  }

  public reject(id: string): FileChange {
    const current = this.get(id);
    if (current.status !== "pending") {
      throw new Error("只有待审核修改可以拒绝。");
    }
    const rejected = { ...current, status: "rejected" as const };
    this.changes.set(id, rejected);
    this.emit();
    return rejected;
  }

  public async apply(id: string): Promise<FileChange> {
    const current = this.get(id);
    if (current.status !== "approved") {
      throw new Error("修改尚未获得用户批准，禁止应用。");
    }
    const actual = await this.workspace.read(current.path);
    const conflicted =
      current.operation === "create"
        ? actual !== undefined
        : actual === undefined || this.hash(actual) !== current.originalHash;
    if (conflicted) {
      const next = {
        ...current,
        status: "conflicted" as const,
        error: "文件在审核后发生变化，已阻止覆盖。",
      };
      this.changes.set(id, next);
      this.emit();
      return next;
    }

    try {
      await this.workspace.apply(current);
      const applied = {
        ...current,
        status: "applied" as const,
        appliedHash: this.hash(current.proposedContent),
      };
      this.changes.set(id, applied);
      this.emit();
      return applied;
    } catch (error) {
      const failed = {
        ...current,
        status: "failed" as const,
        error: error instanceof Error ? error.message : String(error),
      };
      this.changes.set(id, failed);
      this.emit();
      return failed;
    }
  }

  private hash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }

  private emit(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
