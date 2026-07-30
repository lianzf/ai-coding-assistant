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
      providerId: "provider-a",
      includeActiveEditor: true,
      includeWorkspace: false,
      contextIds: ["5c69fda2-a042-4b42-9e52-c6a49faf1ea8"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts only a verified plan confirmation shape", () => {
    const valid = {
      type: "chat/confirm-plan",
      requestId: "4f9ee5da-1f69-4ed3-bf00-59c2c22094df",
      sessionId: "fa6c3c8f-a76f-4b1a-9d97-2c85266f0b9c",
      planMessageId: "5c69fda2-a042-4b42-9e52-c6a49faf1ea8",
      providerId: "provider-a",
    };
    expect(inboundMessageSchema.safeParse(valid).success).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        ...valid,
        planText: "伪造的客户端计划内容",
      }).success,
    ).toBe(false);
    expect(
      inboundMessageSchema.safeParse({
        ...valid,
        planMessageId: "not-a-message-id",
      }).success,
    ).toBe(false);
  });

  it("accepts bounded regeneration and code proposal actions", () => {
    expect(
      inboundMessageSchema.safeParse({
        type: "chat/regenerate",
        requestId: "4f9ee5da-1f69-4ed3-bf00-59c2c22094df",
        sessionId: "fa6c3c8f-a76f-4b1a-9d97-2c85266f0b9c",
        assistantMessageId: "5c69fda2-a042-4b42-9e52-c6a49faf1ea8",
        providerId: "provider-a",
        includeActiveEditor: true,
        includeWorkspace: false,
      }).success,
    ).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        type: "code/propose-insert",
        code: "const value = 1;",
        language: "typescript",
      }).success,
    ).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        type: "code/propose-insert",
        code: "x".repeat(200_001),
      }).success,
    ).toBe(false);
  });

  it("accepts provider configuration and an optional key in one message", () => {
    const result = inboundMessageSchema.safeParse({
      type: "provider/save",
      providerId: "provider-a",
      displayName: "Internal gateway",
      baseUrl: "https://model.example.test/v1",
      modelId: "model-a",
      timeoutMs: 30_000,
      apiKey: "secret",
    });

    expect(result.success).toBe(true);
  });

  it("accepts session and project workbench actions", () => {
    expect(inboundMessageSchema.safeParse({ type: "session/new" }).success).toBe(true);
    expect(inboundMessageSchema.safeParse({ type: "project/analyze" }).success).toBe(true);
    expect(inboundMessageSchema.safeParse({ type: "project/analyze", force: true }).success).toBe(
      true,
    );
    expect(
      inboundMessageSchema.safeParse({
        type: "session/rename",
        sessionId: "fa6c3c8f-a76f-4b1a-9d97-2c85266f0b9c",
        title: "项目升级",
      }).success,
    ).toBe(true);
  });

  it("accepts independent provider actions and mode assignments", () => {
    expect(
      inboundMessageSchema.safeParse({
        type: "provider/test",
        providerId: "provider-a",
      }).success,
    ).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        type: "provider/assign",
        mode: "agent",
        providerId: "provider-a",
      }).success,
    ).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        type: "provider/delete",
        providerId: "provider-a",
      }).success,
    ).toBe(true);
  });

  it("accepts explicit checkpoint and batch review actions", () => {
    expect(inboundMessageSchema.safeParse({ type: "change/apply-all" }).success).toBe(true);
    expect(inboundMessageSchema.safeParse({ type: "change/reject-all" }).success).toBe(true);
    expect(inboundMessageSchema.safeParse({ type: "change/rollback-latest" }).success).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        type: "change/rollback",
        changeId: "fa6c3c8f-a76f-4b1a-9d97-2c85266f0b9c",
      }).success,
    ).toBe(true);
  });

  it("accepts only the four declared permission updates", () => {
    expect(
      inboundMessageSchema.safeParse({
        type: "permission/update",
        kind: "network",
        mode: "deny",
      }).success,
    ).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        type: "permission/update",
        kind: "terminal-root",
        mode: "allow",
      }).success,
    ).toBe(false);
  });

  it("accepts bounded visual context actions", () => {
    expect(
      inboundMessageSchema.safeParse({
        type: "context/add",
        kind: "git-diff",
      }).success,
    ).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        type: "context/remove",
        contextId: "5c69fda2-a042-4b42-9e52-c6a49faf1ea8",
      }).success,
    ).toBe(true);
    expect(
      inboundMessageSchema.safeParse({
        type: "context/add",
        kind: "clipboard-anything",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields on security-sensitive messages", () => {
    const result = inboundMessageSchema.safeParse({
      type: "provider/set-key",
      providerId: "provider-a",
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
