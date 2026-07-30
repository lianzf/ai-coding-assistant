import { describe, expect, it } from "vitest";
import { ChatService, type ChatExecutionEvent } from "../../src/chat/ChatService.js";
import type { ChangeManager } from "../../src/changes/ChangeManager.js";
import type { ModelChatRequest, ProviderConfig } from "../../src/domain/model.js";
import type { OpenAICompatibleProvider } from "../../src/providers/OpenAICompatibleProvider.js";
import type { ProviderConfigStore } from "../../src/providers/ProviderConfigStore.js";
import type { SecretManager } from "../../src/security/SecretManager.js";
import type { WorkspaceService } from "../../src/workspace/WorkspaceService.js";

const config: ProviderConfig = {
  id: "default",
  displayName: "Test",
  baseUrl: "https://example.test/v1",
  modelId: "tool-model",
  timeoutMs: 10_000,
  hasApiKey: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("ChatService", () => {
  it("executes an approved read-only project tool loop before returning the final answer", async () => {
    const requests: ModelChatRequest[] = [];
    const provider = {
      async *streamChat(_config: ProviderConfig, _apiKey: string, request: ModelChatRequest) {
        await Promise.resolve();
        requests.push(request);
        if (requests.length === 1) {
          yield { type: "start" as const };
          yield {
            type: "tool-call" as const,
            call: {
              id: "call-search",
              name: "search_workspace",
              arguments: '{"query":"createOrder"}',
            },
          };
          yield { type: "finish" as const, reason: "tool_calls" };
          return;
        }
        yield { type: "start" as const };
        yield { type: "text" as const, text: "已找到订单创建入口。" };
        yield { type: "finish" as const, reason: "stop" };
      },
    } as unknown as OpenAICompatibleProvider;
    const workspace = {
      buildContext: () =>
        Promise.resolve({
          attachments: [],
          text: "",
          characterCount: 0,
        }),
      searchText: () =>
        Promise.resolve([
          {
            uri: "file:///workspace/src/order.ts",
            relativePath: "src/order.ts",
            line: 10,
            preview: "export function createOrder() {}",
          },
        ]),
    } as unknown as WorkspaceService;
    const service = new ChatService(
      { get: () => Promise.resolve(config) } as unknown as ProviderConfigStore,
      { getApiKey: () => Promise.resolve("secret") } as unknown as SecretManager,
      provider,
      workspace,
      { propose: () => Promise.resolve([]) } as unknown as ChangeManager,
    );
    const events: ChatExecutionEvent[] = [];

    const result = await service.send(
      {
        text: "查找订单创建入口",
        mode: "plan",
        providerId: "default",
        includeActiveEditor: false,
        includeWorkspace: false,
        history: [],
        signal: new AbortController().signal,
      },
      (event) => events.push(event),
    );

    expect(result.answer).toBe("已找到订单创建入口。");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.tools?.map((tool) => tool.name)).toContain("search_workspace");
    expect(requests[0]?.tools?.map((tool) => tool.name)).not.toContain("run_project_tests");
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-search",
          content: expect.stringContaining("src/order.ts") as unknown,
        }),
      ]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool-start", callId: "call-search" }),
        expect.objectContaining({ type: "tool-result", callId: "call-search", ok: true }),
        expect.objectContaining({ type: "text", text: "已找到订单创建入口。" }),
      ]),
    );
  });

  it.each([
    { exitCode: 0, expectedOk: true },
    { exitCode: 1, expectedOk: false },
  ])(
    "runs project tests through the user-approved Agent callback",
    async ({ exitCode, expectedOk }) => {
      const requests: ModelChatRequest[] = [];
      const provider = {
        async *streamChat(_config: ProviderConfig, _apiKey: string, request: ModelChatRequest) {
          await Promise.resolve();
          requests.push(request);
          if (requests.length === 1) {
            yield {
              type: "tool-call" as const,
              call: {
                id: "call-tests",
                name: "run_project_tests",
                arguments: "{}",
              },
            };
            yield { type: "finish" as const, reason: "tool_calls" };
            return;
          }
          yield { type: "text" as const, text: "验证完成。" };
          yield { type: "finish" as const, reason: "stop" };
        },
      } as unknown as OpenAICompatibleProvider;
      const workspace = {
        buildContext: () =>
          Promise.resolve({
            attachments: [],
            text: "",
            characterCount: 0,
          }),
      } as unknown as WorkspaceService;
      const service = new ChatService(
        { get: () => Promise.resolve(config) } as unknown as ProviderConfigStore,
        { getApiKey: () => Promise.resolve("secret") } as unknown as SecretManager,
        provider,
        workspace,
        { propose: () => Promise.resolve([]) } as unknown as ChangeManager,
      );
      const events: ChatExecutionEvent[] = [];
      let approvals = 0;

      await service.send(
        {
          text: "修改后运行测试",
          mode: "agent",
          providerId: "default",
          includeActiveEditor: false,
          includeWorkspace: false,
          history: [],
          runProjectTests: () => {
            approvals += 1;
            return Promise.resolve({
              command: "pnpm test",
              exitCode,
              output: exitCode === 0 ? "all passed" : "one failed",
              durationMs: 42,
              cancelled: false,
            });
          },
          signal: new AbortController().signal,
        },
        (event) => events.push(event),
      );

      expect(approvals).toBe(1);
      expect(requests[0]?.tools?.map((tool) => tool.name)).toContain("run_project_tests");
      expect(requests[1]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            toolCallId: "call-tests",
            content: expect.stringContaining('"command":"pnpm test"') as unknown,
          }),
        ]),
      );
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool-result",
            callId: "call-tests",
            ok: expectedOk,
          }),
        ]),
      );
    },
  );
});
