import type { ChatMode } from "./model.js";

export interface ExecutionStepRecord {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly input: string;
  readonly status: "running" | "completed" | "failed";
  readonly summary: string;
  readonly durationMs?: number;
}

export interface TaskExecutionRecord {
  readonly sessionId: string;
  readonly requestId: string;
  readonly kind: "chat" | "test";
  readonly mode?: ChatMode;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly summary: string;
  readonly steps: readonly ExecutionStepRecord[];
  readonly startedAt: string;
  readonly completedAt?: string;
}
