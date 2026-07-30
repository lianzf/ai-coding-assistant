# Model Provider 设计

> 文档状态：阶段 1 基线  
> 目标：新增模型服务只需实现 Adapter、注册 Provider、提供配置 Schema/表单，不改应用业务分支  
> 相关文档：[总体架构](architecture.md) · [安全设计](security.md) · [数据模型](data-model.md)

## 1. 设计原则

- Provider 是应用层端口，不泄漏具体 SDK 类型。
- Provider 配置与秘密分离；领域对象和 Webview DTO 不携带 API Key。
- 流式文本、推理、工具调用、用量和错误使用统一事件模型。
- 能力由 Provider 探测结果、模型声明和用户覆盖合并，不靠 Provider ID 条件分支。
- HTTP、代理、超时、重试、TLS、重定向和日志由共享基础设施实现。
- 所有 Provider 调用可取消，且对响应大小、工具参数和流事件做边界校验。

## 2. 核心接口

```ts
export interface ModelProvider {
  readonly id: string;
  readonly displayName: string;
  readonly configSchemaVersion: number;

  validateConfig(
    config: ResolvedProviderConfig,
    signal?: AbortSignal,
  ): Promise<ValidationResult>;

  testConnection(
    config: ResolvedProviderConfig,
    signal?: AbortSignal,
  ): Promise<ConnectionTestResult>;

  listModels(
    config: ResolvedProviderConfig,
    signal?: AbortSignal,
  ): Promise<readonly ModelInfo[]>;

  streamChat(
    request: ChatRequest,
    context: ProviderContext,
  ): AsyncIterable<ChatStreamEvent>;

  getCapabilities(
    modelId: string,
    config: ResolvedProviderConfig,
    signal?: AbortSignal,
  ): Promise<ModelCapabilities>;
}
```

`ResolvedProviderConfig` 只在 Extension Host 的 Provider 调用栈内存在：

```ts
export interface ProviderConfig {
  readonly id: string;
  readonly providerType: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly timeoutMs: number;
  readonly proxy?: ProxyConfig;
  readonly headers: readonly HeaderReference[];
  readonly capabilityOverrides?: Partial<ModelCapabilities>;
  readonly secretRef?: string;
  readonly hasSecret: boolean;
  readonly enabled: boolean;
  readonly schemaVersion: number;
}

export interface ResolvedProviderConfig
  extends Omit<ProviderConfig, "secretRef" | "hasSecret"> {
  readonly apiKey?: SecretValue;
  readonly resolvedHeaders: Readonly<Record<string, SecretValue | string>>;
}
```

`SecretValue` 是基础设施层的不透明包装，禁止序列化并提供显式 `revealForRequest()`；不得跨消息协议。

## 3. 模型能力

```ts
export interface ModelCapabilities {
  readonly streaming: boolean;
  readonly toolCalling: boolean;
  readonly vision: boolean;
  readonly reasoning: boolean;
  readonly structuredOutput: boolean;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly parallelToolCalls?: boolean;
}
```

能力解析优先级：

1. 用户对当前配置的显式覆盖。
2. `listModels` 或模型元数据返回的能力。
3. Adapter 的已知模型模式。
4. Provider 保守默认值。

未知能力按 `false/undefined` 处理。应用层通过能力门控功能：

- `toolCalling=false`：Agent 只能执行“建议计划”，不能进入模型工具回路。
- `structuredOutput=false`：使用文本解析的功能必须要求人工复核，不直接产生可执行结构。
- `vision=false`：不接收图片 ContextItem。
- 上下文窗口未知：使用安全的默认预算并允许用户配置。

## 4. 请求模型

```ts
export interface ChatRequest {
  readonly requestId: string;
  readonly modelId: string;
  readonly messages: readonly ProviderMessage[];
  readonly tools?: readonly ProviderToolDefinition[];
  readonly toolChoice?: "auto" | "none" | { readonly name: string };
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly responseFormat?: StructuredOutputSpec;
  readonly metadata: {
    readonly mode:
      | "ask"
      | "explain"
      | "edit"
      | "agent"
      | "review"
      | "test"
      | "document";
    readonly conversationId?: string;
    readonly taskId?: string;
  };
}

export interface ProviderContext {
  readonly signal: AbortSignal;
  readonly traceId: string;
  readonly capabilities: ModelCapabilities;
  readonly networkPolicy: NetworkDecision;
  readonly onRetry?: (event: ProviderRetryEvent) => void;
}
```

要求：

- `messages` 在 ContextBuilder 完成过滤和预算后生成。
- Adapter 只做协议映射，不重新读取工作区。
- 工具 Schema 必须是 JSON Schema 可表达的有限子集。
- metadata 不能发送到远端，除非请求映射显式允许；默认只用于本地关联。

## 5. 流式事件

```ts
export type ChatStreamEvent =
  | { readonly type: "start"; readonly providerRequestId?: string }
  | { readonly type: "text-delta"; readonly text: string }
  | { readonly type: "reasoning-delta"; readonly text: string }
  | {
      readonly type: "tool-call-start";
      readonly callId: string;
      readonly name: string;
    }
  | {
      readonly type: "tool-call-delta";
      readonly callId: string;
      readonly argumentsDelta: string;
    }
  | {
      readonly type: "tool-call-end";
      readonly callId: string;
      readonly name: string;
      readonly arguments: unknown;
    }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | {
      readonly type: "finish";
      readonly reason:
        | "stop"
        | "length"
        | "tool_calls"
        | "content_filter"
        | "cancelled"
        | "unknown";
    };
```

Provider 异常通过抛出 `ProviderError` 表达，不伪装为 finish。流处理约束：

- UTF-8 增量解码，容忍 chunk 边界切断。
- SSE/NDJSON 单事件和总响应大小受限。
- 工具参数增量先限长，结束后再 JSON/Zod 校验。
- 重复 finish、未知事件、无 callId 工具事件视为协议错误。
- reasoning 内容默认不持久化，UI 是否展示由 Provider 条款和产品策略决定。

## 6. 错误模型

```ts
export type ProviderErrorCode =
  | "invalid_config"
  | "authentication_failed"
  | "permission_denied"
  | "model_not_found"
  | "rate_limited"
  | "context_length_exceeded"
  | "content_filtered"
  | "timeout"
  | "network_unavailable"
  | "invalid_response"
  | "cancelled"
  | "provider_unavailable"
  | "unknown";

export interface ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly safeDetails?: Readonly<Record<string, unknown>>;
}
```

禁止在错误中保留：

- 请求 Header、API Key、代理凭据。
- 未脱敏的请求体和响应体。
- Provider 返回的完整 HTML 错误页。

自动重试：

- 只针对连接重置、部分 429/5xx 等明确瞬时错误。
- 最多有限次数，尊重 `Retry-After`，采用指数退避和抖动。
- 一旦收到有意义的文本或工具调用增量，默认不自动重放，避免重复副作用。
- 认证、配置、内容过滤、上下文超限和取消不自动重试。

## 7. Provider Registry

```ts
export interface ProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly configSchema: z.ZodType<ProviderConfigInput>;
  readonly create: (deps: ProviderDependencies) => ModelProvider;
  readonly defaults: ProviderDefaults;
  readonly uiSchema: ProviderFormSchema;
}

export interface ProviderRegistry {
  register(descriptor: ProviderDescriptor): DisposableLike;
  get(id: string): ProviderDescriptor | undefined;
  list(): readonly ProviderDescriptor[];
}
```

约束：

- Composition Root 启动时注册。
- 重复 ID 直接失败，不采用后注册覆盖。
- 应用层只面向 `ModelProvider`/Descriptor 能力。
- 表单由 `uiSchema` 描述，但 Secret 字段只产生专用 `model/set-secret` 消息。
- 配置 Schema 与迁移函数一起版本化。

## 8. Adapter 分层

```text
Shared HTTP Transport
└─ OpenAICompatibleProvider
   ├─ OpenAICompatible descriptor
   ├─ DeepSeek profile
   ├─ Qwen profile
   ├─ GLM profile
   ├─ Moonshot/Kimi profile
   └─ Custom profile

OllamaProvider
└─ 可复用 OpenAI Compatible 映射，但有本地发现/无密钥默认策略
```

DeepSeek/Qwen/GLM/Moonshot 若使用 OpenAI 兼容协议，优先作为薄 Profile：

- 默认 Base URL。
- 默认 Header/鉴权规则。
- 模型能力映射。
- 模型列表路径或差异。
- 错误码归一化。

只有协议确实不同才创建独立传输实现。不得在 `ChatController`、`AgentRunner`、`ContextBuilder` 中判断 Provider ID。

## 9. 首版 Provider 设计

| Provider | Adapter 策略 | 默认密钥 | 备注 |
| --- | --- | --- | --- |
| OpenAI Compatible | 通用 `/chat/completions`、`/models` | 可选/按配置 | MVP 首个正式实现。 |
| DeepSeek | OpenAI Compatible Profile | 是 | 能力按模型 ID 与探测合并。 |
| Qwen | OpenAI Compatible Profile | 是 | 默认阿里云兼容端点，可编辑。 |
| GLM | Profile 或独立映射 | 是 | 以实际兼容协议验证结果决定。 |
| Moonshot/Kimi | OpenAI Compatible Profile | 是 | 处理上下文/模型列表差异。 |
| Ollama | 本地 Adapter | 否 | 默认 loopback，支持模型发现。 |
| Custom | 通用 Adapter + 用户能力声明 | 可选 | 无 Provider 特例和隐式信任。 |

具体 URL、模型列表和协议细节可能随服务变化，阶段 3 实现时必须以各服务官方文档和真实连接测试验证，本设计不把暂定默认值当作永久事实。

## 10. 配置与 Webview DTO

Webview 可见：

```ts
export interface ProviderConfigView {
  readonly id: string;
  readonly providerType: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly timeoutMs: number;
  readonly headerNames: readonly string[];
  readonly hasSecret: boolean;
  readonly capabilities: Partial<ModelCapabilities>;
  readonly enabled: boolean;
}
```

Webview 不可见：

- `secretRef`。
- API Key、敏感 Header、代理密码。
- 底层请求/响应 Header。

保存流程：

1. Webview 发送非敏感配置，Zod 校验。
2. Extension Host 校验 URL、超时、Header 名称和网络策略。
3. 若包含新 secret，使用独立消息写入 SecretStorage。
4. Adapter `validateConfig` 做本地语义校验。
5. 连接测试是显式动作，不能把“保存成功”当作“服务可用”。
6. 保存配置不自动设置为默认模型。

## 11. 模型角色选择

```ts
export type ModelRole = "default" | "fast" | "capable";

export interface ModelSelection {
  readonly providerConfigId: string;
  readonly modelId: string;
}
```

`ModelSelectionService`：

- Ask/Explain 可优先 `fast`。
- Agent/Edit/Review/Test/Document 默认 `capable`，但必须满足所需能力。
- 用户在单次任务上显式选择时优先。
- 角色配置不可用时回退到 default，并向 UI 说明。
- 不根据成本或质量进行未公开的自动切换。

## 12. 代理、自定义 Header 与 TLS

- 代理地址为非敏感配置；代理认证信息进 SecretStorage。
- 使用共享 HttpTransport，避免每个 Adapter 自行处理代理。
- TLS 证书校验默认开启。
- 自定义 CA 属于 P1 企业能力；不得提供通用“忽略证书错误”开关。
- 重定向到不同 Origin 时不转发认证 Header，并重新执行网络审批。
- Base URL 规范化后保存，禁止嵌入 `user:password@host` 凭据。

## 13. 连接测试与模型列表

连接测试返回：

```ts
export interface ConnectionTestResult {
  readonly ok: boolean;
  readonly latencyMs?: number;
  readonly authenticated?: boolean;
  readonly modelReachable?: boolean;
  readonly capabilities?: ModelCapabilities;
  readonly error?: ProviderErrorSummary;
}
```

- 优先使用低成本 models/metadata 请求；若服务不支持，再执行最小非流式/短流请求。
- 连接测试不得把用户工作区内容发出。
- 模型列表结果有短时缓存，配置或 secret 变化时失效。
- 列表失败不妨碍用户手工输入模型 ID。

## 14. 结构化输出与工具调用

- ProviderToolDefinition 来自 ToolRegistry 的只读快照。
- 模型返回的工具名必须与当前请求暴露的工具一致。
- 工具参数先完成 JSON 解析，再用工具 Zod Schema 验证。
- 结构化输出 Schema 必须设置大小和深度限制。
- Adapter 不执行工具，只产出 `tool-call-*` 事件。
- Provider 支持并行工具调用时，AgentRunner 仍根据冲突和权限决定是否串行。

## 15. 测试策略

### 15.1 单元测试

- Registry 注册、重复 ID、注销。
- 配置 Schema、URL、Header、超时和能力覆盖。
- Secret 与 View DTO 隔离。
- Chat request/response 映射。
- SSE/NDJSON 分块、Unicode、工具增量、usage 和 finish。
- 错误归一化与 retryable 判定。
- 不同 Provider Profile 不泄漏到应用层。

### 15.2 集成测试

- 使用本地 HTTP 测试服务器验证流、取消、超时、429、5xx 和重定向。
- 验证 Authorization 不跨 Origin。
- 验证响应/工具参数大小限制。
- 对真实第三方 Provider 的测试只在用户提供凭据的可选环境运行，并明确标记，不进入默认 CI。

### 15.3 契约测试

每个 Adapter 复用同一套契约：

1. 无效配置返回 `invalid_config`。
2. AbortSignal 能终止列表、测试和流。
3. 事件顺序合法且最多一个 finish。
4. 错误不包含 secret。
5. 能力未知时采用保守值。
6. Webview DTO 不含 secretRef/value。

## 16. 阶段 3 完成标准

虽然当前只做阶段 1，Provider 实现阶段的退出标准预先定义为：

- OpenAI Compatible Adapter 完成并通过契约测试。
- SecretStorage 与 ProviderConfig 完全分离。
- 新增一个测试 Profile 不需要修改聊天/Agent 业务代码。
- 连接测试、模型列表、流式聊天、取消和错误映射可用。
- Provider 配置 Webview 不回显或记录秘密。
- DeepSeek、Qwen、GLM、Moonshot、Ollama 和 Custom 的实现状态必须如实标注；未真实验证不得声称支持。

