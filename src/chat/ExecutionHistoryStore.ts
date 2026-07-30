import type * as vscode from "vscode";
import { z } from "zod";
import type { ExecutionStepRecord, TaskExecutionRecord } from "../domain/execution.js";
import type { ChatMode } from "../domain/model.js";

const storageKey = "aiCodingAssistant.executionHistory.v1";
const maximumRecords = 100;
const maximumRecordsPerSession = 20;
const maximumStepsPerRecord = 40;

const stepSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    input: z.string().max(2_000),
    status: z.enum(["running", "completed", "failed"]),
    summary: z.string().max(5_000),
    durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  })
  .strict();

const recordSchema = z
  .object({
    sessionId: z.string().uuid(),
    requestId: z.string().uuid(),
    kind: z.enum(["chat", "test"]),
    mode: z.enum(["ask", "plan", "agent"]).optional(),
    status: z.enum(["running", "completed", "failed", "cancelled"]),
    summary: z.string().max(5_000),
    steps: z.array(stepSchema).max(maximumStepsPerRecord),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

const storedSchema = z
  .object({
    version: z.literal(1),
    records: z.array(z.unknown()).max(maximumRecords),
  })
  .strict();

type StoredRecord = z.infer<typeof recordSchema>;

export class ExecutionHistoryStore {
  private records: readonly TaskExecutionRecord[];
  private saveQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly state: vscode.Memento) {
    this.records = this.load();
    this.recoverInterrupted();
  }

  public list(sessionId: string): readonly TaskExecutionRecord[] {
    return this.records
      .filter((record) => record.sessionId === sessionId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, maximumRecordsPerSession);
  }

  public start(
    sessionId: string,
    requestId: string,
    kind: TaskExecutionRecord["kind"],
    mode?: ChatMode,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    const record: TaskExecutionRecord = {
      sessionId,
      requestId,
      kind,
      status: "running",
      summary: kind === "test" ? "正在运行项目测试…" : "正在准备任务…",
      steps: [],
      startedAt,
      ...(mode ? { mode } : {}),
    };
    this.records = [record, ...this.records.filter((item) => item.requestId !== requestId)].slice(
      0,
      maximumRecords,
    );
    return this.persist();
  }

  public setStatus(requestId: string, summary: string): Promise<void> {
    this.update(requestId, (record) => ({
      ...record,
      summary: summary.slice(0, 5_000),
    }));
    return this.persist();
  }

  public startStep(requestId: string, step: ExecutionStepRecord): Promise<void> {
    this.update(requestId, (record) => ({
      ...record,
      summary: `${step.label}…`,
      steps: [
        ...record.steps.filter((item) => item.id !== step.id),
        {
          id: step.id.slice(0, 200),
          name: step.name.slice(0, 100),
          label: step.label.slice(0, 200),
          input: step.input.slice(0, 2_000),
          status: "running" as const,
          summary: "",
        },
      ].slice(-maximumStepsPerRecord),
    }));
    return this.persist();
  }

  public finishStep(
    requestId: string,
    stepId: string,
    ok: boolean,
    summary: string,
    durationMs?: number,
  ): Promise<void> {
    this.update(requestId, (record) => ({
      ...record,
      summary: summary.slice(0, 5_000),
      steps: record.steps.map((step) =>
        step.id === stepId
          ? {
              ...step,
              status: ok ? ("completed" as const) : ("failed" as const),
              summary: summary.slice(0, 5_000),
              ...(durationMs !== undefined
                ? { durationMs: Math.max(0, Math.min(Math.trunc(durationMs), 86_400_000)) }
                : {}),
            }
          : step,
      ),
    }));
    return this.persist();
  }

  public finish(
    requestId: string,
    status: Exclude<TaskExecutionRecord["status"], "running">,
    summary: string,
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    this.update(requestId, (record) => ({
      ...record,
      status,
      summary: summary.slice(0, 5_000),
      completedAt,
      steps: record.steps.map((step) =>
        step.status === "running"
          ? {
              ...step,
              status: "failed" as const,
              summary: status === "cancelled" ? "任务已停止" : "任务在步骤完成前结束",
            }
          : step,
      ),
    }));
    return this.persist();
  }

  public removeSession(sessionId: string): Promise<void> {
    this.records = this.records.filter((record) => record.sessionId !== sessionId);
    return this.persist();
  }

  private recoverInterrupted(): void {
    const completedAt = new Date().toISOString();
    let changed = false;
    this.records = this.records.map((record) => {
      if (record.status !== "running") {
        return record;
      }
      changed = true;
      return {
        ...record,
        status: "failed",
        summary: "VS Code 已重载，上一任务执行状态已中断。",
        completedAt,
        steps: record.steps.map((step) =>
          step.status === "running"
            ? {
                ...step,
                status: "failed" as const,
                summary: "VS Code 重载时该步骤尚未完成",
              }
            : step,
        ),
      };
    });
    if (changed) {
      void this.persist();
    }
  }

  private update(
    requestId: string,
    updater: (record: TaskExecutionRecord) => TaskExecutionRecord,
  ): void {
    this.records = this.records.map((record) =>
      record.requestId === requestId ? updater(record) : record,
    );
  }

  private load(): readonly TaskExecutionRecord[] {
    const parsed = storedSchema.safeParse(this.state.get<unknown>(storageKey));
    if (!parsed.success) {
      return [];
    }
    return parsed.data.records
      .map((record) => recordSchema.safeParse(record))
      .filter((record) => record.success)
      .map((record) => toRecord(record.data));
  }

  private persist(): Promise<void> {
    const snapshot = {
      version: 1 as const,
      records: this.records.slice(0, maximumRecords),
    };
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(async () => await this.state.update(storageKey, snapshot));
    return this.saveQueue;
  }
}

function toRecord(value: StoredRecord): TaskExecutionRecord {
  return {
    sessionId: value.sessionId,
    requestId: value.requestId,
    kind: value.kind,
    status: value.status,
    summary: value.summary,
    steps: value.steps.map(toStep),
    startedAt: value.startedAt,
    ...(value.mode !== undefined ? { mode: value.mode } : {}),
    ...(value.completedAt !== undefined ? { completedAt: value.completedAt } : {}),
  };
}

function toStep(value: z.infer<typeof stepSchema>): ExecutionStepRecord {
  return {
    id: value.id,
    name: value.name,
    label: value.label,
    input: value.input,
    status: value.status,
    summary: value.summary,
    ...(value.durationMs !== undefined ? { durationMs: value.durationMs } : {}),
  };
}
