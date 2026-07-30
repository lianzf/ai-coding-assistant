import { z } from "zod";
import type {
  ConnectionResult,
  ModelChatRequest,
  ModelProvider,
  ModelStreamEvent,
  ProviderConfig,
} from "../domain/model.js";

type FetchPort = typeof fetch;

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
          message: z.object({ content: z.string().nullable() }).passthrough(),
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

  public constructor(private readonly fetchImpl: FetchPort = fetch) {}

  public async testConnection(
    config: ProviderConfig,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ConnectionResult> {
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
          message: `连接失败：HTTP ${response.status}`,
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
          messages: request.messages,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 1000);
        throw new Error(`HTTP ${response.status}: ${body}`);
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
