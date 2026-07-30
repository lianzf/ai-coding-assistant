import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../src/domain/model.js";
import type { PermissionGate } from "../../src/domain/permission.js";
import { OpenAICompatibleProvider } from "../../src/providers/OpenAICompatibleProvider.js";

const servers: ReturnType<typeof createServer>[] = [];
const permissions: PermissionGate = {
  get: () => ({ read: "allow", network: "allow", modify: "ask", command: "ask" }),
  assertAvailable: () => undefined,
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("OpenAICompatibleProvider HTTP integration", () => {
  it("streams an OpenAI-compatible SSE response over real local HTTP", async () => {
    let authorization = "";
    let requestBody = "";
    const server = createServer(async (request, response) => {
      authorization = request.headers.authorization ?? "";
      for await (const chunk of request as AsyncIterable<Buffer>) {
        requestBody += chunk.toString("utf8");
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      response.write('data: {"id":"local-1","choices":[{"delta":{"content":"stream "}}]}\n\n');
      response.write(
        'data: {"choices":[{"delta":{"content":"works"},"finish_reason":"stop"}]}\n\n',
      );
      response.end("data: [DONE]\n\n");
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("local HTTP server did not expose a TCP port");
    }

    const config: ProviderConfig = {
      id: "default",
      displayName: "Local integration",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: "local-model",
      timeoutMs: 10_000,
      hasApiKey: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const provider = new OpenAICompatibleProvider(permissions);
    const events = [];
    for await (const event of provider.streamChat(config, "local-secret", {
      model: config.modelId,
      messages: [{ role: "user", content: "hello" }],
      signal: new AbortController().signal,
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "start", requestId: "local-1" },
      { type: "text", text: "stream " },
      { type: "text", text: "works" },
      { type: "finish", reason: "stop" },
    ]);
    expect(authorization).toBe("Bearer local-secret");
    expect(JSON.parse(requestBody)).toMatchObject({
      model: "local-model",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    });
  });
});
