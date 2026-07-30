import type * as vscode from "vscode";
import { z } from "zod";
import type { FileChange } from "../domain/change.js";
import { isSensitivePath } from "../security/PathPolicy.js";

const storageKey = "aiCodingAssistant.changeHistory.v1";
const maximumChanges = 100;
const maximumStoredCharacters = 20_000_000;

const safeRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine((value) => !/^(?:[a-zA-Z]:|\/|\\\\)/.test(value), "只允许工作区相对路径")
  .refine(
    (value) =>
      !value
        .replaceAll("\\", "/")
        .split("/")
        .some((part) => part === "." || part === ".."),
    "路径不能包含 . 或 ..",
  )
  .refine((value) => !isSensitivePath(value), "安全策略禁止保存敏感路径");

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const changeSchema = z
  .object({
    id: z.string().uuid(),
    groupId: z.string().uuid(),
    path: safeRelativePathSchema,
    operation: z.enum(["create", "update"]),
    originalContent: z.string().max(2_000_000).optional(),
    proposedContent: z.string().max(2_000_000),
    originalHash: hashSchema.optional(),
    appliedHash: hashSchema.optional(),
    addedLines: z.number().int().min(0),
    deletedLines: z.number().int().min(0),
    reason: z.string().max(5_000).optional(),
    status: z.enum([
      "pending",
      "approved",
      "applied",
      "rejected",
      "conflicted",
      "failed",
      "rollback-conflicted",
      "rolled-back",
    ]),
    createdAt: z.string().datetime(),
    rolledBackAt: z.string().datetime().optional(),
    error: z.string().max(5_000).optional(),
  })
  .strict();

export class ChangeHistoryStore {
  private saveQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly state: vscode.Memento) {}

  public load(): readonly FileChange[] {
    const stored = this.state.get<unknown>(storageKey, []);
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored
      .map((value) => changeSchema.safeParse(value))
      .filter((result) => result.success)
      .map((result) => toFileChange(result.data))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, maximumChanges);
  }

  public save(changes: readonly FileChange[]): Thenable<void> {
    let storedCharacters = 0;
    const bounded: FileChange[] = [];
    const sorted = [...changes].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
    const groups = new Map<string, FileChange[]>();
    for (const change of sorted) {
      const group = groups.get(change.groupId) ?? [];
      group.push(change);
      groups.set(change.groupId, group);
    }
    for (const group of groups.values()) {
      const parsed = group
        .map((change) => changeSchema.safeParse(change))
        .filter((result) => result.success)
        .map((result) => toFileChange(result.data));
      if (parsed.length !== group.length || bounded.length + parsed.length > maximumChanges) {
        continue;
      }
      const characters = parsed.reduce(
        (total, change) =>
          total +
          change.proposedContent.length +
          (change.originalContent?.length ?? 0) +
          (change.reason?.length ?? 0) +
          (change.error?.length ?? 0),
        0,
      );
      if (storedCharacters + characters > maximumStoredCharacters) {
        continue;
      }
      bounded.push(...parsed);
      storedCharacters += characters;
    }
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(async () => await this.state.update(storageKey, bounded));
    return this.saveQueue;
  }
}

function toFileChange(value: z.infer<typeof changeSchema>): FileChange {
  return {
    id: value.id,
    groupId: value.groupId,
    path: value.path,
    operation: value.operation,
    proposedContent: value.proposedContent,
    addedLines: value.addedLines,
    deletedLines: value.deletedLines,
    status: value.status,
    createdAt: value.createdAt,
    ...(value.originalContent !== undefined ? { originalContent: value.originalContent } : {}),
    ...(value.originalHash !== undefined ? { originalHash: value.originalHash } : {}),
    ...(value.appliedHash !== undefined ? { appliedHash: value.appliedHash } : {}),
    ...(value.reason !== undefined ? { reason: value.reason } : {}),
    ...(value.rolledBackAt !== undefined ? { rolledBackAt: value.rolledBackAt } : {}),
    ...(value.error !== undefined ? { error: value.error } : {}),
  };
}
