export type ChatMode = "ask" | "explain" | "edit" | "agent" | "review" | "test" | "document";

export interface ProviderConfig {
  readonly id: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly timeoutMs: number;
  readonly hasApiKey: boolean;
  readonly updatedAt: string;
}

export interface ProviderConfigInput {
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly timeoutMs: number;
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ModelChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly signal: AbortSignal;
}

export type ModelStreamEvent =
  | { readonly type: "start"; readonly requestId?: string }
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "finish";
      readonly reason: string;
      readonly inputTokens?: number;
      readonly outputTokens?: number;
    };

export interface ConnectionResult {
  readonly ok: boolean;
  readonly message: string;
  readonly latencyMs?: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly displayName: string;

  testConnection(
    config: ProviderConfig,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ConnectionResult>;

  streamChat(
    config: ProviderConfig,
    apiKey: string,
    request: ModelChatRequest,
  ): AsyncIterable<ModelStreamEvent>;
}
