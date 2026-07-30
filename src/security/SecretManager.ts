export interface SecretStoragePort {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export class SecretManager {
  private static readonly apiKeyName = "aiCodingAssistant.provider.default.apiKey";

  public constructor(private readonly secrets: SecretStoragePort) {}

  public async getApiKey(): Promise<string | undefined> {
    return await this.secrets.get(SecretManager.apiKeyName);
  }

  public async setApiKey(value: string): Promise<void> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("API Key 不能为空。");
    }
    await this.secrets.store(SecretManager.apiKeyName, trimmed);
  }

  public async deleteApiKey(): Promise<void> {
    await this.secrets.delete(SecretManager.apiKeyName);
  }

  public async hasApiKey(): Promise<boolean> {
    return (await this.getApiKey()) !== undefined;
  }
}
