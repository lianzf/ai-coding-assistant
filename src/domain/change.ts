export type ChangeOperation = "create" | "update";
export type ChangeStatus =
  | "pending"
  | "approved"
  | "applied"
  | "rejected"
  | "conflicted"
  | "failed"
  | "rollback-conflicted"
  | "rolled-back";

export interface ChangeSpec {
  readonly path: string;
  readonly operation: ChangeOperation;
  readonly content: string;
  readonly reason?: string;
}

export interface FileChange {
  readonly id: string;
  readonly groupId: string;
  readonly path: string;
  readonly operation: ChangeOperation;
  readonly originalContent?: string;
  readonly proposedContent: string;
  readonly originalHash?: string;
  readonly appliedHash?: string;
  readonly addedLines: number;
  readonly deletedLines: number;
  readonly reason?: string;
  readonly status: ChangeStatus;
  readonly createdAt: string;
  readonly rolledBackAt?: string;
  readonly error?: string;
}
