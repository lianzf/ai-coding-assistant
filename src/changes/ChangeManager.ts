import { createHash, randomUUID } from "node:crypto";
import type { ChangeSpec, FileChange } from "../domain/change.js";

export interface ChangeWorkspaceGateway {
  read(path: string): Promise<string | undefined>;
  showDiff(change: FileChange): Promise<void>;
  apply(change: FileChange): Promise<void>;
  rollback(change: FileChange): Promise<void>;
}

type ChangeListener = (changes: readonly FileChange[]) => void;

export class ChangeManager {
  private readonly changes = new Map<string, FileChange>();
  private readonly listeners = new Set<ChangeListener>();

  public constructor(
    private readonly workspace: ChangeWorkspaceGateway,
    initialChanges: readonly FileChange[] = [],
  ) {
    for (const change of initialChanges) {
      this.changes.set(change.id, change);
    }
  }

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

  public latestAppliedGroup(): readonly FileChange[] {
    const latest = this.list().find((change) => change.status === "applied");
    if (!latest) {
      return [];
    }
    return this.list().filter(
      (change) => change.groupId === latest.groupId && change.status === "applied",
    );
  }

  public latestPendingGroup(): readonly FileChange[] {
    const latest = this.list().find((change) => change.status === "pending");
    if (!latest) {
      return [];
    }
    return this.list().filter(
      (change) => change.groupId === latest.groupId && change.status === "pending",
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
    const groupId = randomUUID();
    for (const spec of specs) {
      const originalContent = await this.workspace.read(spec.path);
      if (spec.operation === "create" && originalContent !== undefined) {
        throw new Error(`无法创建已存在的文件：${spec.path}`);
      }
      if (spec.operation === "update" && originalContent === undefined) {
        throw new Error(`无法修改不存在的文件：${spec.path}`);
      }
      const stats = this.lineStats(originalContent ?? "", spec.content);
      const change: FileChange = {
        id: randomUUID(),
        groupId,
        path: spec.path,
        operation: spec.operation,
        ...(originalContent !== undefined
          ? {
              originalContent,
              originalHash: this.hash(originalContent),
            }
          : {}),
        proposedContent: spec.content,
        addedLines: stats.added,
        deletedLines: stats.deleted,
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

  public async rollback(id: string): Promise<FileChange> {
    const current = this.get(id);
    if (current.status !== "applied") {
      throw new Error("只有已经应用且尚未回滚的修改可以恢复。");
    }
    const actual = await this.workspace.read(current.path);
    const conflicted =
      actual === undefined ||
      current.appliedHash === undefined ||
      this.hash(actual) !== current.appliedHash;
    if (conflicted) {
      const next = {
        ...current,
        status: "rollback-conflicted" as const,
        error: "文件在 AI 修改应用后又发生变化，已阻止自动回滚以保护用户内容。",
      };
      this.changes.set(id, next);
      this.emit();
      return next;
    }

    try {
      await this.workspace.rollback(current);
      const rolledBack = {
        ...current,
        status: "rolled-back" as const,
        rolledBackAt: new Date().toISOString(),
      };
      this.changes.set(id, rolledBack);
      this.emit();
      return rolledBack;
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

  private lineStats(
    originalContent: string,
    proposedContent: string,
  ): { readonly added: number; readonly deleted: number } {
    const original = this.lineHistogram(originalContent);
    const proposed = this.lineHistogram(proposedContent);
    let added = 0;
    let deleted = 0;
    const lines = new Set([...original.keys(), ...proposed.keys()]);
    for (const line of lines) {
      const before = original.get(line) ?? 0;
      const after = proposed.get(line) ?? 0;
      added += Math.max(0, after - before);
      deleted += Math.max(0, before - after);
    }
    return { added, deleted };
  }

  private lineHistogram(content: string): ReadonlyMap<string, number> {
    const values = new Map<string, number>();
    const lines = content.length === 0 ? [] : content.split(/\r?\n/);
    for (const line of lines) {
      values.set(line, (values.get(line) ?? 0) + 1);
    }
    return values;
  }

  private emit(): void {
    const snapshot = this.list();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
