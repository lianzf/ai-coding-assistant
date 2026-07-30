export interface SecretStoragePort {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export class SecretManager {
  private static readonly legacyApiKeyName = "aiCodingAssistant.provider.default.apiKey";

  public constructor(private readonly secrets: SecretStoragePort) {}

  public async getApiKey(providerId = "default"): Promise<string | undefined> {
    return await this.secrets.get(this.apiKeyName(providerId));
  }

  public async setApiKey(value: string, providerId = "default"): Promise<void> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("API Key 不能为空。");
    }
    await this.secrets.store(this.apiKeyName(providerId), trimmed);
  }

  public async deleteApiKey(providerId = "default"): Promise<void> {
    await this.secrets.delete(this.apiKeyName(providerId));
  }

  public async hasApiKey(providerId = "default"): Promise<boolean> {
    return (await this.getApiKey(providerId)) !== undefined;
  }

  private apiKeyName(providerId: string): string {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(providerId)) {
      throw new Error("模型配置 ID 无效。");
    }
    return providerId === "default"
      ? SecretManager.legacyApiKeyName
      : `aiCodingAssistant.provider.${providerId}.apiKey`;
  }
}
