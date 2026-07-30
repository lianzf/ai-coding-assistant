# 领域数据模型与 Webview 协议

> 文档状态：阶段 1 基线  
> 本文定义跨模块共享的实体、不变量、存储映射与协议 DTO。示例接口用于约束设计，阶段 2 之后按模块拆分实现。  
> 相关文档：[总体架构](architecture.md) · [Provider 设计](provider-design.md) · [Agent 设计](agent-design.md) · [安全设计](security.md)

## 1. 建模约定

### 1.1 ID 与时间

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ConversationId = Brand<string, "ConversationId">;
export type MessageId = Brand<string, "MessageId">;
export type TaskId = Brand<string, "TaskId">;
export type StepId = Brand<string, "StepId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type ChangeSetId = Brand<string, "ChangeSetId">;
export type FileChangeId = Brand<string, "FileChangeId">;
export type PermissionRequestId = Brand<string, "PermissionRequestId">;
```

- ID 在 Extension Host 生成，使用随机 UUID/ULID；Webview 提供的任意 ID 都要验证所有权。
- 持久化时间使用 ISO 8601 UTC 字符串。
- UI 本地化显示，不把本地时区字符串写入领域实体。

### 1.2 URI

- 跨边界使用序列化的 `UriDto`，不持久化 `vscode.Uri`。
- 路径只用于显示，权限判断必须重新 revive URI 并经 WorkspaceBoundary。

```ts
export interface UriDto {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query?: string;
  readonly fragment?: string;
}
```

### 1.3 版本

- 每个持久化文档有 `schemaVersion`。
- 每个聚合有递增 `version`，Store 使用乐观并发。
- 迁移为单向、纯函数，并保留损坏数据隔离机制。

## 2. Conversation 与 ChatMessage

```ts
export interface Conversation {
  readonly id: ConversationId;
  readonly title: string;
  readonly mode: ChatMode;
  readonly messageIds: readonly MessageId[];
  readonly activeModel?: ModelSelection;
  readonly summary?: ConversationSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly version: number;
  readonly schemaVersion: number;
}

export type ChatMode =
  | "ask"
  | "explain"
  | "edit"
  | "agent"
  | "review"
  | "test"
  | "document";

export interface ChatMessage {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly parts: readonly MessagePart[];
  readonly status: "streaming" | "complete" | "partial" | "failed";
  readonly model?: ModelSelection;
  readonly usage?: TokenUsage;
  readonly contextManifestId?: string;
  readonly createdAt: string;
}
```

```ts
export type MessagePart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "code"; readonly language?: string; readonly text: string }
  | { readonly type: "file-ref"; readonly uri: UriDto; readonly range?: TextRange }
  | { readonly type: "tool-call-ref"; readonly callId: ToolCallId }
  | { readonly type: "change-set-ref"; readonly changeSetId: ChangeSetId }
  | { readonly type: "error"; readonly error: SafeError };
```

不变量：

- `tool` 消息必须引用已存在 ToolCall。
- `streaming` 消息不作为完整历史上下文使用。
- ConversationStore 不长期保存 file/selection 的完整正文，只保存引用、hash、范围和摘要。
- system 消息由应用层生成，Webview 不能创建。

## 3. Provider 与模型

```ts
export interface ProviderDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly configSchemaVersion: number;
}

export interface ProviderConfig {
  readonly id: string;
  readonly providerType: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly timeoutMs: number;
  readonly proxy?: ProxyConfig;
  readonly headers: readonly HeaderReference[];
  readonly hasSecret: boolean;
  readonly secretRef?: string; // Extension Host only; never in Webview DTO
  readonly capabilityOverrides?: Partial<ModelCapabilities>;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly schemaVersion: number;
}

export interface HeaderReference {
  readonly id: string;
  readonly name: string;
  readonly sensitive: boolean;
  readonly value?: string;
  readonly secretRef?: string;
}

export interface ModelInfo {
  readonly id: string;
  readonly displayName?: string;
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly ownedBy?: string;
}

export interface ModelSelection {
  readonly providerConfigId: string;
  readonly modelId: string;
}
```

不变量：

- `sensitive=true` 时不得有 `value`，必须使用 secretRef。
- Webview DTO 移除所有 secretRef。
- Base URL 不能包含用户名/密码。
- Provider Config 删除前处理关联的模型角色和 SecretStorage。

## 4. ContextItem 与 ContextManifest

```ts
export type ContextItemType =
  | "file"
  | "selection"
  | "symbol"
  | "directory"
  | "git_diff"
  | "diagnostic"
  | "terminal"
  | "test_result"
  | "document"
  | "summary";

export interface ContextItem {
  readonly id: string;
  readonly type: ContextItemType;
  readonly title: string;
  readonly content: string;
  readonly source?: UriDto | string;
  readonly range?: TextRange;
  readonly contentHash: string;
  readonly tokenEstimate: number;
  readonly priority: number;
  readonly selected: boolean;
  readonly truncated: boolean;
  readonly provenance: ContextProvenance;
  readonly sensitivity: "public" | "internal" | "confidential";
}

export interface ContextManifest {
  readonly id: string;
  readonly requestId: string;
  readonly providerConfigId: string;
  readonly modelId: string;
  readonly destinationOrigin: string;
  readonly items: readonly ContextManifestItem[];
  readonly totalTokenEstimate: number;
  readonly filteredCount: number;
  readonly truncatedCount: number;
  readonly redactionCount: number;
  readonly createdAt: string;
}
```

ManifestItem 保存：

- ContextItem ID、类型、显示来源、范围。
- hash、token 估算、是否截断/脱敏。
- 不保存完整 content。

不变量：

- 实际发送项必须是 Manifest items 的子集且 hash 一致。
- 在发送前若文件变更，ContextBuilder 重新构建 manifest。
- 被敏感策略 block 的项目不进入 BuiltContext。

## 5. AgentTask、Step 与事件

```ts
export interface AgentTask {
  readonly id: TaskId;
  readonly conversationId?: ConversationId;
  readonly goal: string;
  readonly status: AgentStatus;
  readonly suspension: AgentSuspension;
  readonly plan: AgentPlan;
  readonly currentStepId?: StepId;
  readonly attempt: number;
  readonly model: ModelSelection;
  readonly policy: AgentPolicy;
  readonly lastSequence: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly failure?: SafeError;
  readonly version: number;
  readonly schemaVersion: number;
}
```

```ts
export type TaskEvent =
  | BaseTaskEvent<"task.created", { readonly goal: string }>
  | BaseTaskEvent<"plan.created", { readonly plan: AgentPlan }>
  | BaseTaskEvent<"plan.revised", { readonly plan: AgentPlan; readonly reason: string }>
  | BaseTaskEvent<"status.changed", AgentStatusChanged>
  | BaseTaskEvent<"suspension.changed", AgentSuspensionChanged>
  | BaseTaskEvent<"step.started", { readonly stepId: StepId; readonly attempt: number }>
  | BaseTaskEvent<"step.completed", { readonly stepId: StepId }>
  | BaseTaskEvent<"step.failed", { readonly stepId: StepId; readonly error: SafeError }>
  | BaseTaskEvent<"tool.requested", { readonly callId: ToolCallId }>
  | BaseTaskEvent<"tool.completed", { readonly callId: ToolCallId; readonly summary: string }>
  | BaseTaskEvent<"approval.requested", { readonly requestId: PermissionRequestId }>
  | BaseTaskEvent<"approval.resolved", ApprovalResolved>
  | BaseTaskEvent<"changes.created", { readonly changeSetId: ChangeSetId }>
  | BaseTaskEvent<"changes.applied", { readonly changeSetId: ChangeSetId }>
  | BaseTaskEvent<"test.completed", { readonly runId: string; readonly summary: TestRunSummary }>
  | BaseTaskEvent<"task.completed", { readonly summary: string }>
  | BaseTaskEvent<"task.failed", { readonly error: SafeError }>
  | BaseTaskEvent<"task.cancelled", { readonly reason?: string }>;

export interface BaseTaskEvent<TType extends string, TPayload> {
  readonly eventId: string;
  readonly taskId: TaskId;
  readonly sequence: number;
  readonly type: TType;
  readonly payload: TPayload;
  readonly occurredAt: string;
  readonly schemaVersion: number;
}
```

不变量：

- sequence 从 1 单调递增，不重复。
- 聚合 status 只能通过合法事件迁移。
- terminal event 后不得追加执行事件，只可追加归档/清理元数据。
- 重试增加 attempt，不删除旧事件。

## 6. ToolCall 与 PermissionRequest

```ts
export interface ToolCall {
  readonly id: ToolCallId;
  readonly taskId: TaskId;
  readonly stepId: StepId;
  readonly toolName: string;
  readonly input: unknown;
  readonly normalizedInputHash?: string;
  readonly permissionLevel: PermissionLevel;
  readonly status:
    | "requested"
    | "validating"
    | "waiting_for_approval"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled";
  readonly attempt: number;
  readonly resultSummary?: string;
  readonly error?: SafeError;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface PermissionRequest {
  readonly id: PermissionRequestId;
  readonly taskId: TaskId;
  readonly stepId: StepId;
  readonly callId: ToolCallId;
  readonly level: PermissionLevel;
  readonly operation: PermissionOperation;
  readonly summary: string;
  readonly normalizedSpec: unknown;
  readonly specHash: string;
  readonly risks: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: "pending" | "approved" | "denied" | "expired" | "invalidated";
}

export interface PermissionGrant {
  readonly requestId: PermissionRequestId;
  readonly specHash: string;
  readonly scope: "once" | "task" | "workspace_rule";
  readonly issuedAt: string;
  readonly expiresAt: string;
}
```

不变量：

- grant 的 specHash 必须与执行时重新计算值相同。
- Webview 不能提交 grant，只能提交 decision；grant 由 Extension Host 创建。
- 恢复任务时 pending/grant 失效。
- ToolCall 完整 input 只在必要范围保存；命令/路径仍需脱敏和限长。

## 7. FileChange 与 ChangeSet

```ts
export type FileChangeStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applying"
  | "applied"
  | "conflicted"
  | "failed"
  | "rolled_back";

export interface FileRevision {
  readonly contentHash: string;
  readonly documentVersion?: number;
  readonly size: number;
  readonly modifiedAt?: number;
}

export interface FileChange {
  readonly id: FileChangeId;
  readonly uri: UriDto;
  readonly targetUri?: UriDto;
  readonly operation: "create" | "update" | "delete" | "rename";
  readonly originalContent?: string;
  readonly proposedContent?: string;
  readonly unifiedDiff?: string;
  readonly reason?: string;
  readonly taskId: TaskId;
  readonly baseline?: FileRevision;
  readonly appliedRevision?: FileRevision;
  readonly proposalVersion: number;
  readonly status: FileChangeStatus;
  readonly approvalId?: string;
  readonly error?: SafeError;
}

export interface ChangeSet {
  readonly id: ChangeSetId;
  readonly taskId: TaskId;
  readonly title: string;
  readonly changeIds: readonly FileChangeId[];
  readonly status:
    | "draft"
    | "waiting_for_review"
    | "partially_approved"
    | "approved"
    | "applying"
    | "applied"
    | "partially_applied"
    | "rejected"
    | "conflicted"
    | "rolled_back";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly schemaVersion: number;
}
```

状态规则：

| 当前状态 | 允许动作 | 下一个状态 |
| --- | --- | --- |
| pending | approve | approved |
| pending | reject | rejected |
| approved | apply（预检成功） | applying |
| applying | 写入成功 | applied |
| applying | 基线不匹配 | conflicted |
| applying | 其他错误 | failed |
| applied | rollback（当前 revision 匹配） | rolled_back |
| applied | rollback（不匹配） | conflicted |

终态 `rejected` 不可重新批准；用户编辑/重新生成会创建 `proposalVersion + 1` 的新 FileChange。

内容保存策略：

- `originalContent/proposedContent` 仅在未完成 ChangeSet 和有限回滚窗口保存。
- 超大文件使用受控快照 artifact 或禁止自动变更。
- 历史长期只保存 URI、hash、diff 摘要、理由、状态和审批证据。

## 8. CodeFinding

```ts
export type FindingProvenance =
  | "vscode_diagnostic"
  | "compiler"
  | "static_analyzer"
  | "ai_inference";

export interface CodeFinding {
  readonly id: string;
  readonly analyzerId: string;
  readonly provenance: FindingProvenance;
  readonly ruleId?: string;
  readonly uri: UriDto;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly severity: "info" | "warning" | "error" | "critical";
  readonly title: string;
  readonly message: string;
  readonly evidence?: string;
  readonly aiExplanation?: string;
  readonly suggestion?: string;
  readonly fixable: boolean;
  readonly createdAt: string;
}
```

不变量：

- `ai_inference` 的 analyzerId 使用明确 AI 标识。
- 为工具 Finding 添加 AI 解释时，provenance、原 message/evidence 不变。
- `fixable=true` 仅表示可以提出 ChangeSet，不表示允许自动写入。
- 行列在领域层使用 0-based，UI 显示时转换为 1-based；协议中明确约定，避免偏移错误。

## 9. 测试生成模型

```ts
export interface TestCase {
  readonly id: string;
  readonly title: string;
  readonly kind:
    | "unit"
    | "integration"
    | "regression"
    | "boundary"
    | "negative";
  readonly target: CodeReference;
  readonly preconditions: readonly string[];
  readonly steps: readonly string[];
  readonly expected: readonly string[];
  readonly source: "user" | "analysis" | "ai";
}

export interface TestPlan {
  readonly id: string;
  readonly taskId: TaskId;
  readonly framework: TestFramework;
  readonly frameworkConfidence: "confirmed" | "inferred" | "unknown";
  readonly target: TestGenerationTarget;
  readonly cases: readonly TestCase[];
  readonly proposedFiles: readonly UriDto[];
  readonly risks: readonly string[];
  readonly createdAt: string;
}

export interface TestRunSummary {
  readonly runId: string;
  readonly commandSummary: string;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly artifactRefs: readonly string[];
}
```

`frameworkConfidence=unknown` 时只能生成测试用例/建议，不能默认添加依赖或配置。

## 10. 文档生成模型

```ts
export type DocumentType =
  | "readme"
  | "module"
  | "symbol"
  | "api"
  | "design"
  | "review"
  | "test_guide"
  | "test_report"
  | "change_log"
  | "release_notes";

export interface GeneratedDocument {
  readonly id: string;
  readonly taskId: TaskId;
  readonly type: DocumentType;
  readonly title: string;
  readonly targetUri?: UriDto;
  readonly templateId?: string;
  readonly content: string;
  readonly sourceManifestId: string;
  readonly status:
    | "draft"
    | "edited"
    | "waiting_for_review"
    | "approved"
    | "saved"
    | "rejected"
    | "failed";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DocumentTemplate {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
  readonly documentTypes: readonly DocumentType[];
  readonly variableSchema: unknown;
  readonly content: string;
  readonly origin: "built_in" | "workspace" | "user_import";
}
```

不变量：

- 用户导入模板按不可信文本处理，不能注入系统/工具策略。
- 目标存在时保存必须转为 update FileChange 并走 Diff。
- sourceManifest 记录来源摘要，内容变化后失效并需重新确认。

## 11. 分析、测试和文档模块接口

### 11.1 CodeAnalyzer

```ts
export interface CodeAnalyzer {
  readonly id: string;
  readonly displayName: string;
  readonly supportedLanguages: readonly string[];

  detectEnvironment(
    workspace: WorkspaceContext,
    signal: AbortSignal,
  ): Promise<AnalyzerEnvironment>;

  analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
  ): Promise<readonly CodeFinding[]>;
}
```

### 11.2 TestGenerationService

```ts
export interface TestGenerationService {
  detectFramework(
    scope: WorkspaceScope,
    signal: AbortSignal,
  ): Promise<TestFrameworkDetection>;

  plan(
    request: TestGenerationRequest,
    signal: AbortSignal,
  ): Promise<TestPlan>;

  generate(
    planId: string,
    signal: AbortSignal,
  ): Promise<ChangeSet>;
}
```

### 11.3 DocumentGenerationService

```ts
export interface DocumentGenerationService {
  generateDraft(
    request: DocumentGenerationRequest,
    signal: AbortSignal,
  ): Promise<GeneratedDocument>;

  updateDraft(
    documentId: string,
    content: string,
  ): Promise<GeneratedDocument>;

  proposeSave(documentId: string): Promise<ChangeSet>;
}
```

## 12. Store 接口与存储映射

```ts
export interface VersionedStore<TEntity, TId> {
  get(id: TId): Promise<TEntity | undefined>;
  save(entity: TEntity, expectedVersion?: number): Promise<void>;
  delete(id: TId): Promise<void>;
}

export interface TaskStore {
  append(event: TaskEvent, expectedSequence: number): Promise<void>;
  events(taskId: TaskId, afterSequence?: number): AsyncIterable<TaskEvent>;
  saveSnapshot(snapshot: AgentTaskSnapshot): Promise<void>;
  loadSnapshot(taskId: TaskId): Promise<AgentTaskSnapshot | undefined>;
}
```

| 数据 | 位置 | 形式 |
| --- | --- | --- |
| Provider 非敏感配置/模型角色 | globalState | 版本化小对象 |
| API Key/敏感 Header | SecretStorage | 每项独立 secret |
| 视图/筛选/当前会话 ID | workspaceState | 小型 UI 状态 |
| 会话索引与消息 | globalStorageUri | 版本化 JSON/JSONL |
| 当前工作区任务事件 | storageUri | append-only JSONL + snapshot |
| ChangeSet 临时快照 | storageUri | 限额 artifact + metadata |
| 审计日志 | storageUri/globalStorageUri | 脱敏滚动 JSONL |

Store 不向领域层暴露文件路径或 VS Code Memento。

## 13. Webview 协议

### 13.1 信封

```ts
export const ProtocolEnvelopeSchema = z.object({
  protocolVersion: z.literal(1),
  type: z.string().min(1).max(100),
  messageId: z.string().uuid(),
  correlationId: z.string().uuid().optional(),
  sentAt: z.string().datetime(),
  payload: z.unknown(),
}).strict();
```

随后按 `type` 使用 discriminated union 解析具体 payload。

### 13.2 请求/响应语义

- command：一次性请求，Extension Host 立即回 `*/accepted` 或 `protocol/error`。
- stream：通过 correlationId 发布 0..N delta 和恰好一个 end/error。
- snapshot：完整可见投影，含 `revision`。
- patch：基于前一 revision 的增量；revision 不匹配时 Webview 请求 resync。
- approval：Extension Host 发请求，Webview 仅返回决定。

### 13.3 关键入站 Payload

```ts
type ChatSendPayload = {
  conversationId?: string;
  mode: ChatMode;
  text: string;
  referenceIds: string[];
  modelOverride?: ModelSelection;
};

type ApprovalDecidePayload = {
  requestId: string;
  decision: "approve" | "deny";
  requestedScope?: "once" | "task" | "workspace_rule";
};

type ChangeDecisionPayload = {
  changeSetId: string;
  changeId: string;
  decision: "approve" | "reject";
  proposalVersion: number;
};
```

Extension Host 不信任：

- conversation/task/change 是否属于当前视图。
- proposalVersion 是否最新。
- scope 是否允许。
- Webview 提供的文件内容 hash、权限等级、Provider hasSecret。

### 13.4 消息目录

| 方向 | 类型 | Payload 摘要 |
| --- | --- | --- |
| W→E | `state/initialize` | webviewKind、lastRevision |
| E→W | `state/snapshot` | 可见会话/任务/配置/策略投影 |
| W→E | `chat/send` | mode、text、引用 ID、模型覆盖 |
| W→E | `chat/cancel` | requestId |
| E→W | `chat/stream-delta` | requestId、messageId、text |
| E→W | `chat/stream-end` | finish reason、usage |
| W→E | `model/save` | 非敏感配置 |
| W→E | `model/set-secret` | configId、secretKind、value（单次） |
| E→W | `model/configs` | ProviderConfigView[] |
| W→E | `agent/start` | goal、引用、模型、策略 |
| W→E | `agent/pause|resume|stop|cancel` | taskId |
| E→W | `task/event` | 安全 TaskEventView |
| E→W | `approval/requested` | 审批卡片 DTO |
| W→E | `approval/decide` | requestId、decision、scope |
| W→E | `change/approve|reject` | changeSet/change/version |
| W→E | `change/apply|rollback` | changeSetId |
| W→E | `analysis/run` | scope、analyzer IDs |
| E→W | `analysis/findings` | FindingView[] |
| W→E | `test/plan|generate|run` | 目标或 plan/change ID |
| W→E | `document/generate|save` | 类型、范围、模板/文档 ID |
| E→W | `protocol/error` | correlationId、SafeError |

### 13.5 协议错误

```ts
export type ProtocolErrorCode =
  | "unsupported_version"
  | "unknown_message_type"
  | "invalid_payload"
  | "message_too_large"
  | "duplicate_message"
  | "not_found"
  | "stale_version"
  | "forbidden"
  | "internal";
```

`internal` 只返回 traceId 和安全文案，不返回堆栈。

## 14. 数据保留与删除

默认建议值（阶段 2 可配置）：

- 会话：最多 100 个或 90 天。
- 任务：最多 200 个或 90 天。
- 未完成 ChangeSet：直到完成/取消后 7 天。
- 回滚内容：完成后 7 天且总量受限。
- 审计：30 天滚动。
- Provider 模型列表缓存：分钟级。

用户删除会话/任务时：

- 删除索引和相关内容 artifact。
- 不删除仍被另一个任务引用的数据，改为引用计数/延迟清理。
- Provider 删除同时清理对应 secrets。
- 无法删除时返回明确的部分失败，不伪装成功。

## 15. Schema 验证边界

必须使用 Zod 或等效严格 Schema 的入口：

- Webview 入站消息。
- Provider 配置导入和本地存储读取。
- 模型工具参数和结构化变更/测试/文档输出。
- SARIF/JUnit/外部分析器输出。
- Task 事件和快照恢复。
- 用户导入模板元数据。

领域内部已构造对象通过 TypeScript 类型和工厂不变量保证，不在每个方法重复解析。

## 16. 测试矩阵

| 模型 | 关键测试 |
| --- | --- |
| Conversation | partial 消息、恢复、摘要、源码不持久化 |
| ProviderConfig | secret 隔离、Header 分类、Schema 迁移 |
| Context | manifest/hash/实际发送一致、截断、脱敏 |
| AgentTask | 状态/暂停、sequence、retry、终态 |
| ToolCall/Approval | spec hash、过期、重放、越权 ID |
| FileChange | 全状态迁移、proposalVersion、冲突、回滚 |
| CodeFinding | provenance 不可伪造、行列转换 |
| TestPlan | framework unknown 不引依赖 |
| GeneratedDocument | 草稿、编辑、已有目标走 ChangeSet |
| Protocol | 版本、未知类型、大小、revision、错误脱敏 |
| Store | 乐观并发、原子写入、损坏/旧 Schema |

