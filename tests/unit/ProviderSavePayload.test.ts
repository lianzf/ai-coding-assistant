import { describe, expect, it } from "vitest";
import { inboundMessageSchema } from "../../src/protocol/messages.js";
import { toProviderSavePayload } from "../../src/presentation/providerSavePayload.js";

describe("toProviderSavePayload", () => {
  it("strips the protocol discriminator before strict config validation", () => {
    const message = inboundMessageSchema.parse({
      type: "provider/save",
      providerId: "deepseek",
      displayName: "DeepSeek",
      baseUrl: "https://model.example.test/v1",
      modelId: "model-a",
      timeoutMs: 120_000,
      apiKey: "secret",
    });
    if (message.type !== "provider/save") {
      throw new Error("unexpected protocol variant");
    }

    expect(toProviderSavePayload(message)).toEqual({
      providerId: "deepseek",
      config: {
        displayName: "DeepSeek",
        baseUrl: "https://model.example.test/v1",
        modelId: "model-a",
        timeoutMs: 120_000,
      },
      apiKey: "secret",
    });
    expect(toProviderSavePayload(message).config).not.toHaveProperty("type");
    expect(toProviderSavePayload(message).config).not.toHaveProperty("apiKey");
  });
});
