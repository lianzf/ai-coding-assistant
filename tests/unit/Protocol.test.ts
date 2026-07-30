import { describe, expect, it } from "vitest";
import { inboundMessageSchema } from "../../src/protocol/messages.js";

describe("Webview protocol", () => {
  it("accepts a valid streaming chat request", () => {
    const result = inboundMessageSchema.safeParse({
      type: "chat/send",
      requestId: "4f9ee5da-1f69-4ed3-bf00-59c2c22094df",
      sessionId: "fa6c3c8f-a76f-4b1a-9d97-2c85266f0b9c",
      text: "explain this",
      mode: "plan",
      includeActiveEditor: true,
      includeWorkspace: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts provider configuration and an optional key in one message", () => {
    const result = inboundMessageSchema.safeParse({
      type: "provider/save",
      displayName: "Internal gateway",
      baseUrl: "https://model.example.test/v1",
      modelId: "model-a",
      timeoutMs: 30_000,
      apiKey: "secret",
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown fields on security-sensitive messages", () => {
    const result = inboundMessageSchema.safeParse({
      type: "provider/set-key",
      apiKey: "secret",
      persistInSettings: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported message types", () => {
    expect(
      inboundMessageSchema.safeParse({
        type: "terminal/run-arbitrary",
        command: "rm -rf /",
      }).success,
    ).toBe(false);
  });
});
