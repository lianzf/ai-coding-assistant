import { z } from "zod";
import type { ProviderConfig, ProviderConfigInput } from "../domain/model.js";

export interface GlobalStatePort {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const storedConfigSchema = z
  .object({
    id: z.literal("default"),
    displayName: z.string().min(1).max(100),
    baseUrl: z.string().url().max(2048),
    modelId: z.string().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(600_000),
    updatedAt: z.string(),
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
  private static readonly storageKey = "aiCodingAssistant.provider.default";

  public constructor(
    private readonly state: GlobalStatePort,
    private readonly hasApiKey: () => Promise<boolean>,
  ) {}

  public async get(): Promise<ProviderConfig | undefined> {
    const parsed = storedConfigSchema.safeParse(
      this.state.get<unknown>(ProviderConfigStore.storageKey),
    );
    if (!parsed.success) {
      return undefined;
    }
    return {
      ...parsed.data,
      hasApiKey: await this.hasApiKey(),
    };
  }

  public async save(input: ProviderConfigInput): Promise<ProviderConfig> {
    const parsed = inputSchema.parse(input);
    const stored: StoredConfig = {
      id: "default",
      ...parsed,
      baseUrl: parsed.baseUrl.replace(/\/+$/, ""),
      updatedAt: new Date().toISOString(),
    };
    await this.state.update(ProviderConfigStore.storageKey, stored);
    return {
      ...stored,
      hasApiKey: await this.hasApiKey(),
    };
  }
}
