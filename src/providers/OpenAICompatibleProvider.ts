import { z } from "zod";
import type {
  ConnectionResult,
  ModelChatRequest,
  ModelProvider,
  ModelStreamEvent,
  ProviderConfig,
} from "../domain/model.js";
import type { PermissionGate } from "../domain/permission.js";

type FetchPort = typeof fetch;

const toolCallSchema = z
  .object({
    id: z.string(),
    type: z.literal("function").optional(),
    function: z
      .object({
        name: z.string(),
        arguments: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const chunkSchema = z
  .object({
    id: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            delta: z
              .object({
                content: z.string().nullable().optional(),
                tool_calls: z
                  .array(
                    z
                      .object({
                        index: z.number().int().nonnegative(),
                        id: z.string().optional(),
                        type: z.literal("function").optional(),
                        function: z
                          .object({
                            name: z.string().optional(),
                            arguments: z.string().optional(),
                          })
                          .optional(),
                      })
                      .passthrough(),
                  )
                  .optional(),
              })
              .passthrough(),
            finish_reason: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .default([]),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const completionSchema = z
  .object({
    id: z.string().optional(),
    choices: z.array(
      z
        .object({
          message: z
            .object({
              content: z.string().nullable(),
              tool_calls: z.array(toolCallSchema).optional(),
            })
            .passthrough(),
          finish_reason: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly id = "openai-compatible";
  public readonly displayName = "OpenAI Compatible";

  public constructor(
    private readonly permissions: PermissionGate,
    private readonly fetchImpl: FetchPort = fetch,
  ) {}

  public async testConnection(
    config: ProviderConfig,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ConnectionResult> {
    this.permissions.assertAvailable("network");
    const started = Date.now();
    const request = this.createAbort(config.timeoutMs, signal);
    try {
      const response = await this.fetchImpl(this.modelsUrl(config.baseUrl), {
        method: "GET",
        headers: this.headers(apiKey),
        signal: request.signal,
      });
      if (!response.ok) {
        return {
          ok: false,
          message: await this.httpError(response),
          latencyMs: Date.now() - started,
        };
      }
      return {
        ok: true,
        message: "连接成功。",
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      if (request.signal.aborted) {
        return { ok: false, message: "连接测试已取消或超时。" };
      }
      return {
        ok: false,
        message: `连接失败：${this.errorMessage(error)}`,
        latencyMs: Date.now() - started,
      };
    } finally {
      request.dispose();
    }
  }

  public async *streamChat(
    config: ProviderConfig,
    apiKey: string,
    request: ModelChatRequest,
  ): AsyncIterable<ModelStreamEvent> {
    this.permissions.assertAvailable("network");
    const abort = this.createAbort(config.timeoutMs, request.signal);
    try {
      const response = await this.fetchImpl(this.chatUrl(config.baseUrl), {
        method: "POST",
        headers: {
          ...this.headers(apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          messages: this.apiMessages(request),
          stream: true,
          stream_options: { include_usage: true },
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                })),
                tool_choice: "auto",
              }
            : {}),
        }),
        signal: abort.signal,
      });
      if (!response.ok) {
        throw new Error(await this.httpError(response));
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        yield* this.readJsonCompletion(response);
        return;
      }
      if (response.body === null) {
        throw new Error("模型响应不包含可读流。");
      }
      yield* this.readEventStream(response.body);
    } finally {
      abort.dispose();
    }
  }

  private async *readJsonCompletion(response: Response): AsyncIterable<ModelStreamEvent> {
    const completion = completionSchema.parse(await response.json());
    yield { type: "start", ...(completion.id ? { requestId: completion.id } : {}) };
    const choice = completion.choices[0];
    if (choice?.message.content) {
      yield { type: "text", text: choice.message.content };
    }
    for (const toolCall of choice?.message.tool_calls ?? []) {
      yield {
        type: "tool-call",
        call: {
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      };
    }
    yield {
      type: "finish",
      reason: choice?.finish_reason ?? "stop",
      ...(completion.usage?.prompt_tokens !== undefined
        ? { inputTokens: completion.usage.prompt_tokens }
        : {}),
      ...(completion.usage?.completion_tokens !== undefined
        ? { outputTokens: completion.usage.completion_tokens }
        : {}),
    };
  }

  private async *readEventStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<ModelStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let started = false;
    let finishReason = "stop";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    const toolCalls = new Map<
      number,
      { id: string | undefined; name: string; arguments: string }
    >();

    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });
      const frames = this.takeFrames(buffer);
      buffer = frames.remainder;
      for (const frame of frames.frames) {
        const event = this.parseFrame(frame);
        if (event === "done") {
          continue;
        }
        if (!started) {
          started = true;
          yield { type: "start", ...(event.id ? { requestId: event.id } : {}) };
        }
        const choice = event.choices[0];
        if (choice?.delta.content) {
          yield { type: "text", text: choice.delta.content };
        }
        this.collectToolCalls(choice?.delta.tool_calls, toolCalls);
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        inputTokens = event.usage?.prompt_tokens ?? inputTokens;
        outputTokens = event.usage?.completion_tokens ?? outputTokens;
      }
    }

    buffer += decoder.decode();
    const trailingFrame = buffer.trim();
    if (trailingFrame.length > 0) {
      const event = this.parseFrame(trailingFrame);
      if (event !== "done") {
        if (!started) {
          started = true;
          yield { type: "start", ...(event.id ? { requestId: event.id } : {}) };
        }
        const choice = event.choices[0];
        if (choice?.delta.content) {
          yield { type: "text", text: choice.delta.content };
        }
        this.collectToolCalls(choice?.delta.tool_calls, toolCalls);
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        inputTokens = event.usage?.prompt_tokens ?? inputTokens;
        outputTokens = event.usage?.completion_tokens ?? outputTokens;
      }
    }

    if (!started) {
      yield { type: "start" };
    }
    for (const [index, toolCall] of [...toolCalls.entries()].sort(
      ([left], [right]) => left - right,
    )) {
      if (!toolCall.name) {
        throw new Error("模型返回了缺少工具名称的工具调用。");
      }
      yield {
        type: "tool-call",
        call: {
          id: toolCall.id ?? `tool-call-${index}`,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      };
    }
    yield {
      type: "finish",
      reason: finishReason,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
    };
  }

  private takeFrames(buffer: string): { frames: string[]; remainder: string } {
    const frames: string[] = [];
    let remainder = buffer;
    while (true) {
      const match = /\r?\n\r?\n/.exec(remainder);
      if (match?.index === undefined) {
        break;
      }
      frames.push(remainder.slice(0, match.index));
      remainder = remainder.slice(match.index + match[0].length);
    }
    return { frames, remainder };
  }

  private parseFrame(frame: string): z.infer<typeof chunkSchema> | "done" {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "[DONE]" || data.length === 0) {
      return "done";
    }
    return chunkSchema.parse(JSON.parse(data) as unknown);
  }

  private chatUrl(baseUrl: string): string {
    return baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  private modelsUrl(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/+$/, "");
    return normalized.endsWith("/chat/completions")
      ? `${normalized.slice(0, -"/chat/completions".length)}/models`
      : `${normalized}/models`;
  }

  private headers(apiKey: string): Record<string, string> {
    return apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  private apiMessages(request: ModelChatRequest): readonly object[] {
    return request.messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          content: message.content,
          tool_call_id: message.toolCallId,
        };
      }
      if (message.role === "assistant" && message.toolCalls) {
        return {
          role: "assistant",
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: call.arguments,
            },
          })),
        };
      }
      return {
        role: message.role,
        content: message.content,
      };
    });
  }

  private collectToolCalls(
    values:
      | readonly {
          readonly index: number;
          readonly id?: string | undefined;
          readonly function?:
            | {
                readonly name?: string | undefined;
                readonly arguments?: string | undefined;
              }
            | undefined;
        }[]
      | undefined,
    target: Map<number, { id: string | undefined; name: string; arguments: string }>,
  ): void {
    for (const value of values ?? []) {
      const current = target.get(value.index) ?? {
        id: undefined,
        name: "",
        arguments: "",
      };
      target.set(value.index, {
        id: value.id ?? current.id,
        name: current.name + (value.function?.name ?? ""),
        arguments: current.arguments + (value.function?.arguments ?? ""),
      });
    }
  }

  private async httpError(response: Response): Promise<string> {
    const body = (await response.text()).slice(0, 4_000);
    const detail = this.errorDetail(body);
    const guidance = this.statusGuidance(response.status);
    return [
      `模型服务请求失败（HTTP ${response.status}）。`,
      guidance,
      detail ? `服务信息：${detail}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private errorDetail(body: string): string {
    if (!body.trim()) {
      return "";
    }
    try {
      const parsed = JSON.parse(body) as unknown;
      if (this.isRecord(parsed)) {
        const error = parsed.error;
        if (typeof error === "string") {
          return error.slice(0, 500);
        }
        if (this.isRecord(error) && typeof error.message === "string") {
          return error.message.slice(0, 500);
        }
        if (typeof parsed.message === "string") {
          return parsed.message.slice(0, 500);
        }
      }
      if (Array.isArray(parsed)) {
        const values = parsed as unknown[];
        const first: unknown = values[0];
        if (this.isRecord(first) && typeof first.message === "string") {
          return first.message.slice(0, 500);
        }
      }
    } catch {
      // Fall back to a short plain-text detail below.
    }
    return body.replace(/\s+/g, " ").trim().slice(0, 500);
  }

  private statusGuidance(status: number): string {
    switch (status) {
      case 400:
      case 422:
        return "请求参数与当前模型接口不兼容，请检查 Model ID、Base URL 和模型能力。";
      case 401:
        return "API Key 无效或已过期，请在“设置”中重新配置密钥。";
      case 402:
        return "模型账户余额或额度不足，请充值、增加额度或切换其他模型。";
      case 403:
        return "当前 API Key 没有访问该模型的权限。";
      case 404:
        return "未找到接口或模型，请确认 Base URL 通常以 /v1 结尾，并检查 Model ID。";
      case 408:
        return "模型服务处理超时，请稍后重试或提高请求超时时间。";
      case 429:
        return "请求频率或额度达到限制，请稍后重试。";
      default:
        return status >= 500
          ? "模型服务暂时不可用，请稍后重试或联系服务提供方。"
          : "请检查模型配置和服务端日志。";
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private createAbort(
    timeoutMs: number,
    parent: AbortSignal,
  ): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(parent.reason);
    if (parent.aborted) {
      onAbort();
    } else {
      parent.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    return {
      signal: controller.signal,
      dispose: () => {
        clearTimeout(timer);
        parent.removeEventListener("abort", onAbort);
      },
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
