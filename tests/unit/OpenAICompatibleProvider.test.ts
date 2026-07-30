import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../src/domain/model.js";
import type { PermissionGate } from "../../src/domain/permission.js";
import { OpenAICompatibleProvider } from "../../src/providers/OpenAICompatibleProvider.js";

const config: ProviderConfig = {
  id: "default",
  displayName: "Test",
  baseUrl: "https://example.test/v1",
  modelId: "test-model",
  timeoutMs: 10_000,
  hasApiKey: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const permissions: PermissionGate = {
  get: () => ({ read: "allow", network: "allow", modify: "ask", command: "ask" }),
  assertAvailable: () => undefined,
};

describe("OpenAICompatibleProvider", () => {
  it("parses split SSE frames and produces streaming text", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"req-1","choices":[{"delta":{"content":"你"}}],"usage":null}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}]}\n'),
        );
        controller.enqueue(
          encoder.encode(
            '\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    const provider = new OpenAICompatibleProvider(permissions, fetchImpl);
    const events = [];

    for await (const event of provider.streamChat(config, "secret", {
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "start", requestId: "req-1" },
      { type: "text", text: "你" },
      { type: "text", text: "好" },
      {
        type: "finish",
        reason: "stop",
        inputTokens: 5,
        outputTokens: 2,
      },
    ]);
  });

  it("parses streamed tool calls and sends OpenAI-compatible tool definitions", async () => {
    const encoder = new TextEncoder();
    let requestBody: unknown;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"req-tool","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"search_workspace","arguments":"{\\"query\\":\\"create"}}]}}]}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Order\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchImpl: typeof fetch = (_input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("expected a JSON string request body");
      }
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    };
    const provider = new OpenAICompatibleProvider(permissions, fetchImpl);
    const events = [];

    for await (const event of provider.streamChat(config, "secret", {
      model: "test-model",
      messages: [{ role: "user", content: "find it" }],
      tools: [
        {
          name: "search_workspace",
          description: "search",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "start", requestId: "req-tool" },
      {
        type: "tool-call",
        call: {
          id: "call-1",
          name: "search_workspace",
          arguments: '{"query":"createOrder"}',
        },
      },
      { type: "finish", reason: "tool_calls" },
    ]);
    expect(requestBody).toMatchObject({
      tool_choice: "auto",
      tools: [
        {
          type: "function",
          function: {
            name: "search_workspace",
          },
        },
      ],
    });
  });

  it("uses the models endpoint for a connection test", async () => {
    let requestedUrl = "";
    let authorization = "";
    const fetchImpl: typeof fetch = (input, init) => {
      requestedUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const headers = new Headers(init?.headers);
      authorization = headers.get("Authorization") ?? "";
      return Promise.resolve(
        new Response('{"data":[]}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    const provider = new OpenAICompatibleProvider(permissions, fetchImpl);
    const result = await provider.testConnection(
      config,
      "top-secret",
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(requestedUrl).toBe("https://example.test/v1/models");
    expect(authorization).toBe("Bearer top-secret");
    expect(JSON.stringify(result)).not.toContain("top-secret");
  });

  it("turns provider HTTP failures into actionable Chinese messages", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: "Insufficient Balance",
              code: "invalid_request_error",
            },
          }),
          { status: 402 },
        ),
      );
    const provider = new OpenAICompatibleProvider(permissions, fetchImpl);

    const consume = async (): Promise<void> => {
      for await (const event of provider.streamChat(config, "secret", {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
        signal: new AbortController().signal,
      })) {
        expect.fail(`failed HTTP response yielded an event: ${JSON.stringify(event)}`);
      }
    };

    await expect(consume()).rejects.toThrow("模型账户余额或额度不足");
    await expect(consume()).rejects.toThrow("Insufficient Balance");
  });

  it("blocks network access at the provider boundary before fetch", async () => {
    let called = false;
    const provider = new OpenAICompatibleProvider(
      {
        get: () => ({ read: "allow", network: "deny", modify: "ask", command: "ask" }),
        assertAvailable: (kind) => {
          if (kind === "network") {
            throw new Error("网络权限已关闭");
          }
        },
      },
      () => {
        called = true;
        return Promise.resolve(new Response(null, { status: 200 }));
      },
    );

    await expect(
      provider.testConnection(config, "secret", new AbortController().signal),
    ).rejects.toThrow("网络权限已关闭");
    expect(called).toBe(false);
  });
});
