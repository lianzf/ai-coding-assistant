import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../src/domain/model.js";
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
    const provider = new OpenAICompatibleProvider(fetchImpl);
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
    const provider = new OpenAICompatibleProvider(fetchImpl);
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
});
