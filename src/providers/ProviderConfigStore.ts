import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ChatMode,
  ProviderAssignments,
  ProviderConfig,
  ProviderConfigInput,
} from "../domain/model.js";

export interface GlobalStatePort {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const providerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);

const storedConfigSchema = z
  .object({
    id: providerIdSchema,
    displayName: z.string().min(1).max(100),
    baseUrl: z.string().url().max(2048),
    modelId: z.string().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(600_000),
    updatedAt: z.string(),
  })
  .strict();

const storedConfigsSchema = z.array(storedConfigSchema).max(50);

const assignmentsSchema = z
  .object({
    ask: providerIdSchema.optional(),
    plan: providerIdSchema.optional(),
    agent: providerIdSchema.optional(),
  })
  .strict();

const inputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    baseUrl: z.string().url().max(2048),
    modelId: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(600_000),
  })
  .strict();

type StoredConfig = z.infer<typeof storedConfigSchema>;

export class ProviderConfigStore {
  private static readonly legacyStorageKey = "aiCodingAssistant.provider.default";
  private static readonly storageKey = "aiCodingAssistant.providers.v2";
  private static readonly assignmentsKey = "aiCodingAssistant.provider.assignments.v2";
  private readonly listeners = new Set<() => void>();

  public constructor(
    private readonly state: GlobalStatePort,
    private readonly hasApiKey: (providerId: string) => Promise<boolean>,
  ) {}

  public onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  }

  public async list(): Promise<readonly ProviderConfig[]> {
    return await Promise.all(
      this.storedConfigs().map(async (config) => ({
        ...config,
        hasApiKey: await this.hasApiKey(config.id),
      })),
    );
  }

  public async get(providerId?: string): Promise<ProviderConfig | undefined> {
    const configs = await this.list();
    return providerId ? configs.find((config) => config.id === providerId) : configs[0];
  }

  public async getForMode(mode: ChatMode): Promise<ProviderConfig | undefined> {
    const assignments = this.getAssignments();
    const assigned = assignments[mode];
    return (assigned ? await this.get(assigned) : undefined) ?? (await this.get());
  }

  public getAssignments(): ProviderAssignments {
    const parsed = assignmentsSchema.safeParse(
      this.state.get<unknown>(ProviderConfigStore.assignmentsKey),
    );
    if (!parsed.success) {
      return {};
    }
    const existing = new Set(this.storedConfigs().map((config) => config.id));
    return Object.fromEntries(
      Object.entries(parsed.data).filter(
        (entry): entry is [ChatMode, string] =>
          typeof entry[1] === "string" && existing.has(entry[1]),
      ),
    );
  }

  public async save(input: ProviderConfigInput, providerId?: string): Promise<ProviderConfig> {
    const parsed = inputSchema.parse(input);
    const id = providerIdSchema.parse(providerId ?? randomUUID());
    const stored: StoredConfig = {
      id,
      ...parsed,
      baseUrl: parsed.baseUrl.replace(/\/+$/, ""),
      updatedAt: new Date().toISOString(),
    };
    const configs = this.storedConfigs();
    const existingIndex = configs.findIndex((config) => config.id === id);
    const next =
      existingIndex >= 0
        ? configs.map((config) => (config.id === id ? stored : config))
        : [...configs, stored];
    await this.state.update(ProviderConfigStore.storageKey, next);
    if (next.length === 1) {
      await this.assignAll(id);
    }
    this.emitChange();
    return {
      ...stored,
      hasApiKey: await this.hasApiKey(id),
    };
  }

  public async assign(mode: ChatMode, providerId: string): Promise<void> {
    const id = providerIdSchema.parse(providerId);
    if (!this.storedConfigs().some((config) => config.id === id)) {
      throw new Error("要分配的模型配置不存在。");
    }
    const next = { ...this.getAssignments(), [mode]: id };
    await this.state.update(ProviderConfigStore.assignmentsKey, next);
    this.emitChange();
  }

  public async remove(providerId: string): Promise<void> {
    const id = providerIdSchema.parse(providerId);
    const next = this.storedConfigs().filter((config) => config.id !== id);
    await this.state.update(ProviderConfigStore.storageKey, next);
    const assignments: ProviderAssignments = Object.fromEntries(
      Object.entries(this.getAssignments()).filter(([, assigned]) => assigned !== id),
    );
    const fallback = next[0];
    if (fallback) {
      for (const mode of ["ask", "plan", "agent"] as const) {
        assignments[mode] ??= fallback.id;
      }
    }
    await this.state.update(ProviderConfigStore.assignmentsKey, assignments);
    this.emitChange();
  }

  private async assignAll(providerId: string): Promise<void> {
    await this.state.update(ProviderConfigStore.assignmentsKey, {
      ask: providerId,
      plan: providerId,
      agent: providerId,
    });
  }

  private storedConfigs(): readonly StoredConfig[] {
    const current = storedConfigsSchema.safeParse(
      this.state.get<unknown>(ProviderConfigStore.storageKey),
    );
    if (current.success) {
      return current.data;
    }
    const legacy = storedConfigSchema.safeParse(
      this.state.get<unknown>(ProviderConfigStore.legacyStorageKey),
    );
    return legacy.success ? [legacy.data] : [];
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
