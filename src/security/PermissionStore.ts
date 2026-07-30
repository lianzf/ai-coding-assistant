import { z } from "zod";
import {
  defaultPermissionState,
  type PermissionGate,
  type PermissionKind,
  type PermissionMode,
  type PermissionState,
} from "../domain/permission.js";

export interface PermissionStatePort {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const permissionModeSchema = z.enum(["allow", "ask", "deny"]);
const permissionStateSchema = z
  .object({
    read: permissionModeSchema,
    network: permissionModeSchema,
    modify: permissionModeSchema,
    command: permissionModeSchema,
  })
  .strict();

const denialMessages: Readonly<Record<PermissionKind, string>> = {
  read: "工作区读取权限已关闭。请在插件“设置 → 权限与离线模式”中启用。",
  network: "模型网络访问已关闭，当前处于离线模式。请在插件设置中启用网络权限。",
  modify: "文件修改权限已关闭。可以继续预览建议，但不能应用或回滚文件。",
  command: "命令执行权限已关闭。请在插件设置中启用后再运行测试或诊断。",
};

export class PermissionStore implements PermissionGate {
  private static readonly storageKey = "aiCodingAssistant.permissions.v1";
  private readonly listeners = new Set<() => void>();

  public constructor(private readonly state: PermissionStatePort) {}

  public get(): PermissionState {
    const parsed = permissionStateSchema.safeParse(
      this.state.get<unknown>(PermissionStore.storageKey),
    );
    return parsed.success ? parsed.data : defaultPermissionState;
  }

  public async update(kind: PermissionKind, mode: PermissionMode): Promise<void> {
    const validatedMode = permissionModeSchema.parse(mode);
    await this.state.update(PermissionStore.storageKey, {
      ...this.get(),
      [kind]: validatedMode,
    });
    this.emitChange();
  }

  public assertAvailable(kind: PermissionKind): void {
    if (this.get()[kind] === "deny") {
      throw new Error(denialMessages[kind]);
    }
  }

  public onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
