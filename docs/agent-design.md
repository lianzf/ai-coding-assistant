# Agent 与工具系统设计

> 文档状态：阶段 1 基线  
> 相关文档：[总体架构](architecture.md) · [安全设计](security.md) · [Provider 设计](provider-design.md) · [数据模型](data-model.md)

## 1. 设计目标

Agent 将用户目标转换为一组可见、可暂停、可审批、可恢复的步骤。它不是一个拥有隐式权限的“自治进程”，而是受以下约束的应用层编排器：

- 模型只提出计划和工具调用，不能自行授权。
- 所有输入、工具参数、模型结构化输出和恢复数据都要校验。
- 读取、网络、写入、命令、删除分别执行策略。
- 文件写入必须经过 ChangeSet 和 Diff 审核。
- 长任务事件化并建立检查点，Webview 不是任务事实来源。
- 每次副作用都与 task、step、tool call、审批和审计事件关联。

## 2. 核心组件

| 组件 | 职责 |
| --- | --- |
| `AgentController` | 接收 start/pause/resume/stop/cancel/retry，校验命令上下文。 |
| `AgentPlanner` | 根据目标与初始上下文生成有完成条件的计划。 |
| `AgentRunner` | 驱动状态机、模型回合、工具执行、变更与测试阶段。 |
| `AgentStateMachine` | 校验主状态迁移、终态和 suspension 规则。 |
| `AgentCheckpointService` | 在安全点保存可恢复快照和非幂等调用状态。 |
| `ToolRegistry` | 注册和查询工具定义，拒绝重复名称。 |
| `ToolExecutor` | 输入校验、权限决策、审批、执行、脱敏和输出限长。 |
| `PermissionService` | 根据 Trust、路径、命令、网络和用户策略做决定。 |
| `ApprovalService` | 创建、展示、绑定 hash、过期和解析审批。 |
| `ContextBuilder` | 构建每个模型回合的有限上下文和 manifest。 |
| `ChangeService` | 从模型建议创建 ChangeSet，负责审核、应用和回滚编排。 |
| `TaskService` | 事件、快照、查询、恢复、队列和历史。 |

## 3. Agent 接口

```ts
export interface AgentController {
  start(
    request: StartAgentRequest,
    signal?: AbortSignal,
  ): Promise<AgentTaskSnapshot>;

  pause(taskId: TaskId): Promise<void>;
  resume(taskId: TaskId): Promise<void>;
  stop(taskId: TaskId): Promise<void>;
  cancel(taskId: TaskId): Promise<void>;

  retry(
    taskId: TaskId,
    options: RetryOptions,
  ): Promise<AgentTaskSnapshot>;

  get(taskId: TaskId): Promise<AgentTaskSnapshot | undefined>;
  events(taskId: TaskId): AsyncIterable<AgentEvent>;
}
```

```ts
export interface AgentPlanner {
  createPlan(
    goal: AgentGoal,
    context: PlanningContext,
    signal: AbortSignal,
  ): Promise<AgentPlan>;

  revisePlan(
    plan: AgentPlan,
    reason: PlanRevisionReason,
    context: PlanningContext,
    signal: AbortSignal,
  ): Promise<AgentPlan>;
}
```

```ts
export interface AgentRunner {
  run(taskId: TaskId, signal: AbortSignal): Promise<AgentRunResult>;
  recover(
    checkpoint: AgentCheckpoint,
    signal: AbortSignal,
  ): Promise<AgentRunResult>;
}
```

`start` 只接受目标、模式、显式上下文引用、模型选择和任务策略，不接受调用方声明的“已批准”字段。

## 4. 计划模型

```ts
export interface AgentPlan {
  readonly id: PlanId;
  readonly version: number;
  readonly goal: string;
  readonly steps: readonly AgentStep[];
  readonly assumptions: readonly string[];
  readonly risks: readonly string[];
  readonly createdAt: string;
}

export interface AgentStep {
  readonly id: StepId;
  readonly title: string;
  readonly description: string;
  readonly kind:
    | "inspect"
    | "analyze"
    | "model"
    | "tool"
    | "change"
    | "verify"
    | "summarize";
  readonly completionCriteria: readonly string[];
  readonly dependencies: readonly StepId[];
  readonly status:
    | "pending"
    | "running"
    | "blocked"
    | "completed"
    | "failed"
    | "skipped"
    | "cancelled";
  readonly attempt: number;
}
```

规则：

- 计划必须包含完成条件，不能只有笼统描述。
- 工具名和命令不必在初始计划中完全固定，但涉及写入/命令/网络的预期必须披露。
- 计划修改生成新 version 和事件，保留旧版本。
- 新增高风险步骤时 UI 明确提示；旧审批不随计划继承。
- 依赖未完成的步骤不能运行。

## 5. 主状态与暂停状态

### 5.1 主状态

保留需求给定状态：

```ts
export type AgentStatus =
  | "idle"
  | "planning"
  | "searching"
  | "waiting_for_approval"
  | "executing_tool"
  | "generating_changes"
  | "waiting_for_change_review"
  | "applying_changes"
  | "running_tests"
  | "completed"
  | "failed"
  | "cancelled";
```

### 5.2 正交暂停状态

```ts
export type AgentSuspension =
  | "running"
  | "pause_requested"
  | "paused";
```

这样可以表达“暂停时仍处于 waiting_for_change_review”，恢复后不会丢失业务阶段。

### 5.3 控制命令语义

| 命令 | 语义 |
| --- | --- |
| pause | 请求在下一个安全点停止推进；不强杀正在提交的原子写入。 |
| resume | 从保存的同一业务状态继续，重新检查信任、配置、权限和版本。 |
| stop | 软停止：不发起新模型/工具回合，保留已完成结果，最终可正常总结。 |
| cancel | 立即传播 AbortSignal，尽力终止当前操作，任务进入 `cancelled`。 |
| retry | 创建新 attempt，从指定失败步骤或安全检查点继续；不覆写原历史。 |

`stop` 与 `cancel` 的区别必须在 UI 中明确。

## 6. 状态机

### 6.1 主要迁移

| 当前状态 | 事件 | 下一个状态 | 条件 |
| --- | --- | --- | --- |
| idle | START | planning | 请求有效、工作区策略允许。 |
| planning | PLAN_READY | searching | 计划合法且至少有一个步骤。 |
| planning | FAIL | failed | Provider/校验错误。 |
| searching | CONTEXT_READY | executing_tool 或 generating_changes | 由下一动作决定。 |
| searching | APPROVAL_REQUIRED | waiting_for_approval | 读取边界或网络需审批。 |
| waiting_for_approval | APPROVED | 请求来源状态 | 审批未过期且 spec hash 相同。 |
| waiting_for_approval | DENIED | failed 或 searching | 根据步骤是否可降级。 |
| executing_tool | TOOL_COMPLETED | searching / generating_changes / running_tests | 工具结果合法。 |
| executing_tool | TOOL_FAILED | searching 或 failed | 可重试且未超限时修订。 |
| generating_changes | CHANGESET_READY | waiting_for_change_review | 至少一个合法 FileChange。 |
| waiting_for_change_review | CHANGES_APPROVED | applying_changes | 有获批项；删除另验。 |
| waiting_for_change_review | CHANGES_REJECTED | searching / completed | 可重新规划或无变更总结。 |
| applying_changes | APPLIED | running_tests / completed | 根据计划进入验证。 |
| applying_changes | CONFLICT | waiting_for_change_review | 重新生成/人工处理。 |
| running_tests | TESTS_COMPLETED | completed | 记录真实结果。 |
| running_tests | TESTS_FAILED | failed 或 searching | 是否允许修复取决于策略。 |
| 任意非终态 | CANCEL | cancelled | 取消信号传播。 |
| 任意非终态 | UNRECOVERABLE_ERROR | failed | 保存安全错误摘要。 |

### 6.2 终态

`completed`、`failed`、`cancelled` 为终态。重试不把旧任务倒退，而是增加 attempt，任务聚合保留原事件并创建新的执行分支。

### 6.3 安全点

允许从 `pause_requested` 转为 `paused` 的安全点：

- 模型流结束或已安全取消。
- 只读工具完成。
- 审批等待期间。
- ChangeSet 已生成但尚未应用。
- 单个 WorkspaceEdit 提交完成后。
- 命令已确认终止并取得退出状态后。

不在以下瞬间暂停：

- WorkspaceEdit 正在提交中。
- 原子持久化替换中。
- 子进程终止状态未知时。

## 7. 单次 Agent 回路

```text
1. 读取任务快照和当前步骤
2. 检查 pause/stop/cancel
3. 构建最小上下文 + ContextManifest
4. 选择满足能力的模型
5. 调用模型并消费流
6. 若完成回答：验证完成条件
7. 若工具调用：解析 → Zod → 策略 → 审批 → 执行
8. 将限长、脱敏的 ToolResult 加入下一回合
9. 若产生变更：创建 ChangeSet，退出模型工具回路等待审核
10. 保存事件与检查点
11. 推进步骤或修订计划
```

防止无限循环：

- 每任务最大模型回合数。
- 每步骤最大工具调用数和 retry 次数。
- 重复相同工具名 + 规范化参数 + 相同结果时触发循环检测。
- 上下文、工具输出、模型输出和总耗时均有预算。
- 超预算进入可解释失败，不自动扩大限制。

## 8. AgentTool 接口

```ts
export type PermissionLevel =
  | "read"
  | "write"
  | "execute"
  | "network"
  | "dangerous";

export interface AgentTool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly permissionLevel: PermissionLevel;
  readonly sideEffects: ToolSideEffects;
  readonly idempotency: "idempotent" | "conditional" | "non_idempotent";

  execute(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult<TOutput>>;
}
```

```ts
export interface ToolSideEffects {
  readonly readsWorkspace: boolean;
  readonly writesWorkspace: boolean;
  readonly executesProcess: boolean;
  readonly accessesNetwork: boolean;
  readonly mayDelete: boolean;
}

export interface ToolExecutionContext {
  readonly taskId: TaskId;
  readonly stepId: StepId;
  readonly callId: ToolCallId;
  readonly workspace: WorkspaceScope;
  readonly signal: AbortSignal;
  readonly approvedGrant?: PermissionGrant;
  readonly traceId: string;
}

export type ToolExecutionResult<T> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly summary: string;
      readonly artifacts?: readonly ToolArtifact[];
      readonly truncated: boolean;
    }
  | {
      readonly ok: false;
      readonly error: ToolError;
      readonly retryable: boolean;
      readonly partialArtifacts?: readonly ToolArtifact[];
    };
```

工具不能：

- 自行弹审批对话或修改 PermissionStore。
- 读取 SecretStorage，除非它是专门的基础设施 Adapter 且接口不向模型暴露。
- 直接把工作区数据发送网络；需要网络的工具必须显式声明。
- 将模型文本当 shell 命令直接执行。
- 绕过 ChangeSet 直接写入。

## 9. Tool Registry 与 Executor

### 9.1 Registry

```ts
export interface ToolRegistry {
  register<TInput, TOutput>(
    tool: AgentTool<TInput, TOutput>,
  ): DisposableLike;

  get(name: string): AgentTool<unknown, unknown> | undefined;
  definitions(scope: ToolExposureScope): readonly ProviderToolDefinition[];
}
```

- 工具名使用稳定 `snake_case`。
- 重复名称启动失败。
- 暴露给模型的定义按当前模式、Trust、能力和策略过滤。
- dangerous 工具默认不暴露；若未来实现，仍需硬审批。

### 9.2 Executor 流程

```text
查找工具
→ 校验工具是否在本回合暴露
→ Zod safeParse(input)
→ 规范化 URI/命令/网络目标
→ 根据真实参数重新计算 side effects
→ PermissionService.evaluate
→ 若 prompt：创建 ApprovalRequest 并暂停
→ 校验 approval hash/expiry/scope
→ 执行工具
→ 限制输出、脱敏、保存 artifact 引用
→ 记录 ToolCall 与审计
→ 返回模型安全摘要
```

工具声明的权限是最低等级；真实参数可能升级风险。例如 `search_text` 指向工作区外 URI 时从 read 升级为需审批，命令包含网络参数时增加 network。

## 10. 首版工具目录

| 工具 | 权限 | 输出/约束 |
| --- | --- | --- |
| `list_directory` | read | URI 条目、类型、限深/限数。 |
| `read_file` | read | 文本片段、revision、截断信息。 |
| `read_files` | read | 批量数量和总字节限制。 |
| `search_files` | read | URI 结果，遵循 ignore/sensitive policy。 |
| `search_text` | read | 匹配、行号、上下文限长。 |
| `read_selection` | read | 当前编辑器 URI、范围、文本。 |
| `read_diagnostics` | read | 来源明确的诊断 DTO。 |
| `get_git_status` | read | 工作区级摘要。 |
| `get_git_diff` | read | 范围受限、外发前提示。 |
| `create_file` | write | 只创建 FileChange，不落盘。 |
| `update_file` | write | 只创建 FileChange，不落盘。 |
| `delete_file` | dangerous | 只创建删除提议，单独审批。 |
| `move_file` | write/dangerous | rename 提议，源/目标均校验。 |
| `apply_patch` | write | 将补丁解析为候选内容/ChangeSet，不直接应用。 |
| `format_file` | execute/write | 需命令/任务审批，结果仍需检测文件变化。 |
| `run_command` | execute | 完整 CommandSpec 审批。 |
| `run_build` | execute/write | 预设探测 + 审批。 |
| `run_tests` | execute/write | 预设探测 + 审批，输出归一化。 |
| `analyze_code` | execute/read | 外部分析器执行审批。 |
| `generate_tests` | network/write | 委托 TestGenerationService，生成 ChangeSet。 |
| `generate_document` | network/write | 委托 DocumentGenerationService，生成草稿/ChangeSet。 |

设计上可将“生成测试/文档”作为应用用例而非底层工具；向 Agent 暴露的同名工具只是安全适配器，不重复实现业务逻辑。

## 11. 权限决策

```ts
export type PermissionDecision =
  | { readonly kind: "allow"; readonly grant: PermissionGrant }
  | { readonly kind: "prompt"; readonly request: PermissionRequest }
  | { readonly kind: "deny"; readonly reasonCode: string };
```

决策输入：

- Workspace Trust。
- 工具定义和规范化后的真实参数。
- URI 是否在工作区、是否敏感、是否符号链接逃逸。
- 命令、cwd、shell、网络和文件副作用。
- 网络模式、Origin 和代码外发类别。
- 用户/企业策略。
- 之前的 grant 是否仍在范围和有效期内。

优先级：硬拒绝 > 企业策略 > Workspace Trust > 显式单次 grant > 用户 allowlist > 默认策略。

## 12. 审批模型

```ts
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
}
```

规则：

- 审批由 Extension Host 构造，Webview 只能返回 decision 和有限 scope。
- 实际执行前重新计算 specHash。
- 任务、步骤、调用、Webview session 任一不匹配则拒绝。
- 任务恢复后旧审批失效。
- 删除、危险命令、工作区外路径不提供宽泛“永久允许”。
- 用户拒绝不是 Agent 错误；Planner 可以在不重复骚扰的前提下降级方案。

## 13. ContextBuilder

### 13.1 接口

```ts
export interface ContextBuilder {
  build(
    request: BuildContextRequest,
    signal: AbortSignal,
  ): Promise<BuiltContext>;
}

export interface BuildContextRequest {
  readonly purpose: ContextPurpose;
  readonly references: readonly ContextReference[];
  readonly workspaceScope: WorkspaceScope;
  readonly model: ModelSelection;
  readonly budget: ContextBudget;
  readonly includeConversationSummary: boolean;
}

export interface BuiltContext {
  readonly items: readonly ContextItem[];
  readonly manifest: ContextManifest;
  readonly estimatedInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly warnings: readonly ContextWarning[];
}
```

### 13.2 流水线

```text
解析 @ 引用
→ ContextSourceRegistry 收集候选
→ WorkspaceBoundary + sensitive path
→ 文本/二进制/大小检测
→ SensitiveContentFilter
→ 内容规范化和 hash 去重
→ 相关性/用户选择/新鲜度/类型优先级打分
→ 大文件按符号或片段分块
→ 预算分配和截断
→ 生成稳定顺序
→ ContextManifest
→ 必要时代码外发审批
```

### 13.3 预算

```ts
export interface ContextBudget {
  readonly contextWindow: number;
  readonly reservedSystemTokens: number;
  readonly reservedToolTokens: number;
  readonly reservedOutputTokens: number;
  readonly maxItemTokens: number;
  readonly maxItems: number;
}
```

粗估器必须可替换。未知 tokenizer 时使用保守字符/词估算并预留误差。任何情况下：

```text
system + history + tools + selected context + reserved output
<= effective context window
```

优先保留：

1. 用户直接选区和明确 `@file`。
2. 当前任务直接诊断/失败证据。
3. 相关符号和少量相邻上下文。
4. Git Diff。
5. 目录摘要和会话摘要。
6. 低相关历史。

不以“截断后可能漏信息”为理由自动发送整个文件或工作区。

## 14. 文件变更与审核

### 14.1 ChangeSet 创建

1. 解析模型结构化变更建议。
2. 验证每个 URI 和 operation。
3. 读取当前基线，记录 revision/hash；create 要验证目标不存在。
4. 计算 proposedContent 和 unifiedDiff。
5. 保存最小必要快照，设置过期与空间限制。
6. 发布 `waiting_for_change_review`。

### 14.2 审核

- 用户可以逐项批准/拒绝。
- “全部批准”不包含 delete 和需要单独确认的 rename。
- 用户编辑提议后创建新的 FileChange revision，旧批准失效。
- Diff 使用只读虚拟文档 + 原文件，URI query 中只放不敏感 ID。

### 14.3 应用

```text
检查 Trust
→ 重新校验 WorkspaceBoundary
→ 读取当前 revision
→ 与基线比对
→ 构建 WorkspaceEdit
→ 尽可能一次提交 create/update/rename
→ delete 单独按批准执行
→ 读取应用后 revision
→ 记录每项状态和事务事件
```

多文件应用无法在所有 FileSystemProvider 上保证真正原子，因此采用“预检全部 + 尽可能单 WorkspaceEdit + 逐项结果 + 补偿回滚”。不能把部分成功报告为全部成功。

### 14.4 回滚

- 只对 `applied` 且存在应用后 revision 的变更开放。
- 当前内容必须仍与应用后 revision 匹配。
- 回滚创建新的逆向 ChangeSet，并要求用户确认。
- 回滚失败/冲突不覆盖当前文件，提供人工恢复内容。

## 15. 检查点与恢复

```ts
export interface AgentCheckpoint {
  readonly taskId: TaskId;
  readonly sequence: number;
  readonly status: AgentStatus;
  readonly suspension: AgentSuspension;
  readonly planVersion: number;
  readonly currentStepId?: StepId;
  readonly completedToolCalls: readonly ToolCallCheckpoint[];
  readonly pendingChangeSetId?: ChangeSetId;
  readonly workspaceFingerprint: string;
  readonly createdAt: string;
  readonly schemaVersion: number;
}
```

不保存：

- AbortController、函数、VS Code 对象。
- API Key 或完整敏感输出。
- 未限长的模型内部推理。

恢复前：

1. 校验 Schema 和事件 sequence。
2. 确认工作区标识和 Trust。
3. 确认 Provider 配置仍存在，但不自动测试网络。
4. 使待审批 grant 失效。
5. 检查 FileChange 基线和命令/工具调用状态。
6. 对状态未知的非幂等操作请求用户决定，不自动重放。

## 16. 失败与重试

错误分类：

- validation：修正计划/参数，不重试同一输入。
- permission：等待/拒绝/降级。
- conflict：重新读取并生成新 ChangeSet。
- provider/network：有上限退避，收到输出后不盲目重放。
- tool：根据幂等性和 partial artifacts 决定。
- storage/internal：保存故障摘要并停止副作用。
- cancelled：终止，不计失败。

每次 retry：

- 增加 attempt。
- 记录触发者、原因、起始检查点。
- 不复用过期审批。
- 不隐藏旧失败。

## 17. 测试策略

### 17.1 状态机

- 所有合法迁移。
- 非法倒退、终态再执行。
- pause 请求与安全点。
- stop/cancel 区分。
- retry attempt 和恢复。

### 17.2 工具

- Registry 重复和暴露过滤。
- Zod 校验、未知字段、超大输入。
- 权限升级、审批 hash、过期/重放。
- AbortSignal、超时、输出截断和脱敏。
- 幂等/非幂等恢复。

### 17.3 Context

- 引用解析、URI、多根工作区。
- 敏感路径、去重、排序、预算、截断、分块。
- Manifest 与实际发送项一致。
- 超预算和 tokenizer 误差。

### 17.4 Changes

- 每种 operation 的状态迁移。
- 未批准不能应用。
- 应用前冲突。
- 部分失败和补偿。
- 回滚冲突不覆盖用户修改。

## 18. 阶段 5/6 完成标准

- Agent 计划和主状态/暂停状态可观察。
- start/pause/resume/stop/cancel/retry 语义由测试证明。
- ToolRegistry、Zod、策略、审批和审计形成完整链路。
- 至少只读文件/搜索/诊断/Git 工具可用。
- 命令必须在真实审批后执行，危险命令默认拒绝。
- 所有写工具只生成 ChangeSet。
- Diff、逐项审批、冲突检测、应用和回滚经过集成测试。
- Webview 无法伪造审批、基线或工具执行结果。

