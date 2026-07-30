import type { ProviderConfigInput } from "../domain/model.js";
import type { InboundMessage } from "../protocol/messages.js";

export type ProviderSaveMessage = Extract<InboundMessage, { type: "provider/save" }>;

export interface ProviderSavePayload {
  readonly providerId: string;
  readonly config: ProviderConfigInput;
  readonly apiKey?: string;
}

export function toProviderSavePayload(input: ProviderSaveMessage): ProviderSavePayload {
  return {
    providerId: input.providerId,
    config: {
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      modelId: input.modelId,
      timeoutMs: input.timeoutMs,
    },
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
  };
}
