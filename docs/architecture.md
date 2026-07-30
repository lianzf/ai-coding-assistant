# AI Coding Assistant 总体架构

> 文档状态：阶段 1 基线  
> 相关文档：[需求规格](requirements.md) · [数据模型](data-model.md) · [Provider 设计](provider-design.md) · [Agent 设计](agent-design.md) · [安全设计](security.md)

## 1. 架构目标

架构需要同时满足以下目标：

- 领域模型和业务流程可在无 VS Code、无 React 环境下单元测试。
- 所有文件、命令、网络和密钥操作集中在受控基础设施边界。
- Provider、Analyzer、Tool、Template 可以注册扩展，不污染应用层分支。
- Webview 崩溃或重载不影响任务状态，Extension Host 是事实来源。
- 支持 URI、多根工作区和 Remote Extension Host。
- 流式模型、工具、任务和 UI 消息统一支持取消、背压和关联 ID。
- 文件修改始终经过候选变更、Diff、审批、冲突检测和事务应用。

## 2. 架构风格

采用“分层架构 + Ports and Adapters + 事件驱动任务”的组合：

```text
┌──────────────────────────────────────────────────────────────┐
│ 表现层                                                       │
│ React Webviews · Tree Views · Diff · Problems · Test Explorer│
└──────────────────────────────┬───────────────────────────────┘
                               │ versioned protocol / commands
┌──────────────────────────────▼───────────────────────────────┐
│ 应用层                                                       │
│ Use Cases · Controllers · Agent · Context · Changes · Tasks  │
└──────────────────────────────┬───────────────────────────────┘
                               │ domain models + ports
┌──────────────────────────────▼───────────────────────────────┐
│ 领域层                                                       │
│ Entities · Value Objects · State Rules · Port Interfaces     │
└──────────────────────────────▲───────────────────────────────┘
                               │ adapters implement ports
┌──────────────────────────────┴───────────────────────────────┐
│ 基础设施层                                                   │
│ VS Code · HTTP · Providers · FS · Git · Terminal · Storage   │
└──────────────────────────────────────────────────────────────┘
```

依赖规则：

1. 领域层只依赖 TypeScript 标准类型和必要的纯类型库；不依赖 VS Code、React、Node 文件系统或模型 SDK。
2. 应用层依赖领域模型和端口，不直接调用 `vscode.*`、`fetch`、`child_process`。
3. 基础设施层实现领域/应用端口，由 Composition Root 注入。
4. 表现层只调用应用层 Facade 或版本化消息协议。
5. `protocol/` 是共享边界包，只包含 JSON 可序列化类型、Zod Schema、错误码和协议版本。

## 3. 运行时拓扑

```text
VS Code Workbench
├─ React Webview(s) ── postMessage ─┐
├─ Tree Views ─────── commands ─────┤
├─ Diff / Problems / Test Explorer ─┤
└───────────────────────────────────▼──────────────
                        Extension Host
                        ├─ Protocol Router
                        ├─ Application Services
                        ├─ Agent / Task Runtime
                        ├─ Policy & Approval
                        ├─ Provider Adapters ── HTTPS / local HTTP
                        ├─ workspace.fs / WorkspaceEdit
                        ├─ Git / Terminal / Analyzers
                        └─ SecretStorage / local storage
```

- Webview 是非可信、可随时重建的 UI 客户端。
- Extension Host 持有所有任务、Provider 和权限状态。
- 远程开发时 Extension Host 通常运行在远程端，文件和命令自然作用于远程工作区；UI 仍运行在本地 Workbench。
- 模型网络请求由 Extension Host 发起，以便统一应用代理、证书、脱敏、审计和取消策略。
- 银河麒麟采用与 Linux 相同的纯 JavaScript Extension Host 主路径；默认避免原生 Addon，并在目标版本/架构上以真实 VSIX 验证。
- Webview 的脚本、样式、图标和字体全部打入 VSIX，不依赖 CDN，保证隔离网络中可加载。

## 4. 四层模块职责

### 4.1 表现层

| 模块 | 职责 | 明确不做 |
| --- | --- | --- |
| Chat Webview | 模式选择、消息流、Markdown、上下文 chips、停止/重试 | 不直接调用模型或读取文件 |
| Model Webview | Provider 表单、能力显示、连接测试触发 | 不持有 API Key 回显 |
| Testing Webview | 范围/计划/草稿/结果展示 | 不写测试文件、不执行测试 |
| Documents Webview | 类型、来源、模板、草稿编辑 | 不覆盖文档 |
| Task Tree | 当前任务、步骤、工具、失败和时间线摘要 | 不编排任务 |
| Analysis Tree | Finding 分组、来源和定位 | 不运行分析器 |
| Diff Editor | VS Code 原生 before/after 审核 | 不代表自动批准 |
| Approval Dialog | 命令、网络、删除、工作区外访问审批 | 不自行推断权限 |
| Status Bar | 当前模型、任务状态、离线状态 | 不存储领域状态 |

Zustand 只保存临时 UI 状态和 Extension Host 投影；Webview 重载后通过 `state/snapshot` 重新同步。

### 4.2 应用层

| 模块 | 职责 |
| --- | --- |
| `ChatController` | 接收聊天用例、建立请求、路由流事件和更新会话。 |
| `ConversationService` | 会话生命周期、消息追加、摘要和恢复。 |
| `AgentController` | start/pause/resume/stop/cancel/retry 命令入口。 |
| `AgentRunner` | 按状态机执行计划、模型回合、工具回合和检查点。 |
| `AgentPlanner` | 将目标转换为用户可见、可验证的步骤。 |
| `ContextBuilder` | 收集候选项、过滤、去重、预算、生成 ContextManifest。 |
| `ToolExecutor` | Schema 校验、策略决策、审批、执行、结果净化和审计。 |
| `ChangeService` | 创建 ChangeSet、审核决策、应用和回滚编排。 |
| `CodeAnalysisService` | Analyzer 探测、运行、归一化和诊断映射。 |
| `TestGenerationService` | 框架探测、测试计划、生成、ChangeSet 和结果关联。 |
| `DocumentGenerationService` | 模板选择、来源构建、草稿、审核和保存建议。 |
| `TaskService` | 任务队列、事件、快照、恢复、重试和历史查询。 |
| `ModelSelectionService` | 根据默认/快速/高能力角色和能力选择模型。 |
| `StreamResponseHandler` | 合并流事件、限频发布 UI、用量和结束原因。 |

### 4.3 领域层

领域层定义：

- Conversation、ChatMessage、ContentPart。
- ProviderDefinition、ProviderConfig、ModelInfo、ModelCapabilities。
- AgentTask、AgentStep、AgentStatus、ToolCall、PermissionRequest。
- ContextItem、ContextManifest、ContextBudget。
- ChangeSet、FileChange、FileRevision、ApprovalDecision。
- CodeFinding、FindingProvenance。
- TestCase、TestPlan、TestRunSummary。
- GeneratedDocument、DocumentTemplate。
- TaskEvent、DomainError 和各 Store/Port 接口。

领域规则示例：

- 未批准的 FileChange 不能进入 `applied`。
- `delete` 必须有独立审批证据。
- AI 推测 Finding 不得转换成工具来源。
- Provider 配置实体只能持有 secret 引用和 `hasSecret`，不能持有 Webview 可见的明文密钥。
- 终态任务不能再次执行，除非创建新的 retry attempt。

### 4.4 基础设施层

| 模块 | 实现 |
| --- | --- |
| VS Code FS | `workspace.fs`、URI 解析、WorkspaceEdit、文档版本和 FileSystemWatcher。 |
| Workspace Policy | 多根工作区归属、符号链接/真实路径验证、ignore 和敏感路径阻断。 |
| HTTP | `fetch`/Node HTTP、代理、TLS、超时、AbortSignal、SSE/NDJSON。 |
| Provider | OpenAI Compatible 及各 Provider Adapter。 |
| Secret | `ExtensionContext.secrets` 封装与 secret 引用解析。 |
| Storage | memento、JSONL 事件、版本化快照、原子写入和迁移。 |
| Terminal | 受控子进程或 VS Code Task/Terminal 执行、输出捕获。 |
| Git | 只读状态/Diff，后续可通过 VS Code Git API 或受控命令实现。 |
| Analyzer | VS Code Diagnostics、ESLint、TypeScript、clang、Cppcheck、自定义命令。 |
| Logging | OutputChannel、结构化审计、脱敏和轮转。 |

## 5. Composition Root 与生命周期

`src/extension.ts` 目标形态：

```ts
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateExtension(context);
}

export async function deactivate(): Promise<void> {
  await deactivateExtension();
}
```

`extension/activation.ts` 按以下顺序组装：

1. 创建 Logger、AuditLogger、SecretManager、Stores。
2. 创建 WorkspaceBoundary、Policies、HTTP Client。
3. 注册 Provider、Tool、Analyzer、Template Adapter。
4. 创建 Context、Changes、Chat、Agent、Task 等应用服务。
5. 注册命令、Webview/Tree Provider、DiagnosticCollection、Test Controller。
6. 恢复安全任务快照并发布 UI 初始投影。

停用顺序反向执行：

1. 拒绝新请求。
2. 取消流和运行中工具。
3. 记录可恢复检查点。
4. 刷新事件/审计缓冲区。
5. 释放视图、诊断、控制器和其他 Disposable。

## 6. 主要数据流

### 6.1 普通聊天

```text
Webview chat/send
→ Zod 校验 + requestId 去重
→ ChatController
→ ContextBuilder 收集/过滤/预算
→ 生成 ContextManifest 并按策略提示代码外发
→ ModelSelectionService
→ ModelProvider.streamChat
→ StreamResponseHandler
→ chat/stream.* 事件
→ ConversationStore 保存最终消息与引用摘要
```

任何一步取消均沿 `AbortSignal` 向下传播。流增量只存 UI 缓冲，完成后才写入最终 AssistantMessage；异常中断可保存 `partial` 标志。

### 6.2 Agent 工具回路

```text
agent/start
→ AgentPlanner 创建计划
→ 用户查看计划
→ ContextBuilder
→ Provider 工具调用事件
→ ToolRegistry 查找工具
→ inputSchema.safeParse
→ PermissionService.evaluate
→ 必要时等待用户审批
→ ToolExecutor.execute
→ 输出限长 + 脱敏
→ ToolResult 返回模型
→ 下一模型回合 / 生成 ChangeSet / 完成
```

工作区文件和工具输出均作为“不可信数据”包裹，不能改变系统策略。

### 6.3 文件变更

```text
模型结构化建议
→ ChangeSetFactory 校验 URI/操作
→ 读取基线内容 + revision/hash
→ 生成 proposedContent/unifiedDiff
→ 打开原生 Diff
→ 用户逐项决策
→ ChangeApplier 再验路径、权限、当前 revision
→ WorkspaceEdit / workspace.fs
→ 写入 applied revision 和历史
→ 可选审批后运行 format/build/test
```

若 revision 不匹配，状态进入 `conflicted`，需要重新生成或人工合并。

### 6.4 测试生成

```text
选择范围
→ TestFrameworkDetector
→ TestContextBuilder
→ 生成 TestPlan
→ 模型生成候选测试
→ ChangeSet
→ Diff 审核
→ 应用
→ 独立命令审批
→ TestRunner
→ Test Explorer + TaskEvent + Chat 摘要
```

### 6.5 文档生成

```text
文档类型/范围/模板
→ ContextBuilder
→ DocumentGenerationService
→ Draft
→ Webview 预览编辑
→ 若目标不存在：创建 ChangeSet
→ 若目标存在：显式覆盖审批 + Diff
→ 保存并记录来源 manifest
```

### 6.6 代码分析

```text
分析请求
→ AnalyzerRegistry 选择/探测
→ 受控执行
→ 原始结果归一化为 CodeFinding
→ 按 provenance 标记
→ DiagnosticMapper
→ Analysis Tree / Problems
→ 可选 AI 解释作为附加字段
```

AI 解释不得修改原始 analyzerId、ruleId、evidence 或 provenance。

## 7. 推荐目录结构

```text
ai-coding-assistant/
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ eslint.config.mjs
├─ .prettierrc.json
├─ esbuild.extension.mjs
├─ vitest.config.ts
├─ src/
│  ├─ extension.ts
│  ├─ extension/
│  │  ├─ activation.ts
│  │  ├─ registrations.ts
│  │  └─ lifecycle.ts
│  ├─ domain/
│  │  ├─ chat/
│  │  ├─ models/
│  │  ├─ agent/
│  │  ├─ context/
│  │  ├─ changes/
│  │  ├─ analysis/
│  │  ├─ testing/
│  │  ├─ documents/
│  │  ├─ tasks/
│  │  └─ ports/
│  ├─ application/
│  │  ├─ chat/
│  │  ├─ agent/
│  │  ├─ context/
│  │  ├─ tools/
│  │  ├─ changes/
│  │  ├─ analysis/
│  │  ├─ testing/
│  │  ├─ documents/
│  │  └─ tasks/
│  ├─ infrastructure/
│  │  ├─ providers/
│  │  │  ├─ core/
│  │  │  ├─ openai-compatible/
│  │  │  ├─ deepseek/
│  │  │  ├─ qwen/
│  │  │  ├─ glm/
│  │  │  ├─ moonshot/
│  │  │  ├─ ollama/
│  │  │  └─ custom/
│  │  ├─ vscode/
│  │  ├─ filesystem/
│  │  ├─ workspace/
│  │  ├─ terminal/
│  │  ├─ git/
│  │  ├─ analyzers/
│  │  ├─ storage/
│  │  ├─ network/
│  │  ├─ security/
│  │  └─ logging/
│  ├─ presentation/
│  │  ├─ commands/
│  │  ├─ webviews/
│  │  ├─ trees/
│  │  ├─ code-actions/
│  │  ├─ codelens/
│  │  ├─ diagnostics/
│  │  ├─ testing/
│  │  └─ statusbar/
│  └─ protocol/
│     ├─ envelope.ts
│     ├─ webview-messages.ts
│     ├─ extension-messages.ts
│     ├─ schemas.ts
│     └─ errors.ts
├─ webview/
│  ├─ index.html
│  ├─ vite.config.ts
│  └─ src/
│     ├─ App.tsx
│     ├─ routes.tsx
│     ├─ components/
│     ├─ features/
│     │  ├─ chat/
│     │  ├─ agent/
│     │  ├─ models/
│     │  ├─ context/
│     │  ├─ analysis/
│     │  ├─ testing/
│     │  ├─ documents/
│     │  ├─ tasks/
│     │  └─ settings/
│     ├─ stores/
│     ├─ hooks/
│     ├─ services/
│     └─ types/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ extension-host/
│  ├─ fixtures/
│  └─ fakes/
├─ resources/
├─ scripts/
└─ docs/
```

说明：

- 目录按层优先、按业务域次级组织，避免同名 `TaskStore` 分散且难以区分。
- `domain/ports` 存储接口；`infrastructure/*` 存储实现。
- 测试镜像源码模块，Extension Host 测试独立入口。
- Stage 2 只初始化最小骨架，后续阶段按路线图逐域增加。

## 8. 注册表与扩展点

统一使用显式注册表：

```ts
interface Registry<T extends { readonly id: string }> {
  register(item: T): DisposableLike;
  get(id: string): T | undefined;
  list(): readonly T[];
}
```

扩展点：

- `ProviderRegistry`
- `ToolRegistry`
- `AnalyzerRegistry`
- `TestFrameworkRegistry`
- `DocumentTemplateRegistry`
- `ContextSourceRegistry`

注册发生在 Composition Root。运行时重复 ID 视为启动错误；注册表输出只读快照。

## 9. Webview 消息协议

### 9.1 信封

```ts
type ProtocolEnvelope<TType extends string, TPayload> = {
  protocolVersion: 1;
  type: TType;
  messageId: string;
  correlationId?: string;
  sentAt: string;
  payload: TPayload;
};
```

规则：

- 入站消息使用 discriminated union 的 Zod Schema 校验。
- `messageId` 用于去重；`correlationId` 关联请求、流和审批。
- Webview 不传入可信的 task owner、权限结论、文件基线或 secret。
- 未知版本/类型返回结构化 `protocol/error`，不执行默认分支。
- Extension Host 对 Webview 流事件限频批量发送，避免 UI 消息洪泛。

### 9.2 Webview → Extension Host

| 类型前缀 | 代表消息 |
| --- | --- |
| `state/*` | `state/initialize`、`state/resync` |
| `chat/*` | `chat/send`、`chat/cancel`、`chat/regenerate` |
| `context/*` | `context/add`、`context/remove`、`context/preview` |
| `model/*` | `model/list`、`model/save`、`model/set-secret`、`model/test`、`model/select` |
| `agent/*` | `agent/start`、`pause`、`resume`、`stop`、`cancel`、`retry` |
| `approval/*` | `approval/decide` |
| `change/*` | `change/open-diff`、`approve`、`reject`、`apply`、`rollback` |
| `analysis/*` | `analysis/run`、`analysis/open-location`、`analysis/explain` |
| `test/*` | `test/plan`、`test/generate`、`test/run` |
| `document/*` | `document/generate`、`document/update-draft`、`document/save` |
| `history/*` | `history/list`、`history/open`、`history/delete` |

### 9.3 Extension Host → Webview

| 类型前缀 | 代表消息 |
| --- | --- |
| `state/*` | `state/snapshot`、`state/patch` |
| `chat/*` | `chat/accepted`、`stream-start`、`stream-delta`、`stream-end`、`error` |
| `task/*` | `task/created`、`task/event`、`task/snapshot` |
| `approval/*` | `approval/requested`、`approval/resolved` |
| `change/*` | `change/created`、`change/status`、`change/conflict` |
| `model/*` | `model/configs`、`model/test-result`、`model/models` |
| `analysis/*` | `analysis/findings`、`analysis/progress` |
| `test/*` | `test/plan-ready`、`test/result` |
| `document/*` | `document/draft`、`document/status` |
| `protocol/*` | `protocol/error`、`protocol/upgrade-required` |

详细实体见 [数据模型](data-model.md)。

## 10. 状态、并发与一致性

- 每个会话最多一个前台模型流；新请求可选择排队或明确取消前一请求。
- 每个 AgentTask 单线程推进状态机，但不同只读任务可并发。
- 每个工作区的 ChangeApplier 使用互斥锁；应用多个文件时记录逐项结果。
- TaskStore 采用递增 sequence，UI 丢事件时请求 snapshot 重同步。
- Provider 流、工具和命令均接收 `AbortSignal`。
- 非幂等工具在 checkpoint 中保存 invocation ID；恢复时先查询结果或请求人工决定。
- 文件 Revision 使用 `document.version`（已打开文档）和内容 hash/metadata（未打开 URI）组合。

## 11. 错误模型

跨层错误统一为可序列化 DomainError：

```ts
interface DomainError {
  code: string;
  message: string;
  category:
    | "validation"
    | "permission"
    | "conflict"
    | "provider"
    | "network"
    | "tool"
    | "storage"
    | "cancelled"
    | "internal";
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

- UI 展示本地化消息，日志使用稳定 `code`。
- Provider 原始响应正文、Authorization Header 和工具敏感输出不得进入 `details`。
- `cancelled` 不是失败，不触发自动重试。
- 自动重试只适用于明确的瞬时错误，且采用有上限的指数退避和抖动。

## 12. 可测试性

### 12.1 单元测试

纯领域与应用测试覆盖状态机、不变量、预算、策略、配置、变更和 Store。使用内存端口 Fake，不启动 VS Code。

### 12.2 集成测试

对 Provider 流协议、文件系统 Adapter、Diff/应用/回滚、命令审批、测试和文档流水线进行边界集成。HTTP 使用本地测试服务器，不把 Mock 结果描述为真实云服务能力。

### 12.3 Extension Host 测试

使用 `@vscode/test-electron` 验证激活、命令、视图、消息、SecretStorage、Workspace Trust、Code Action、DiagnosticCollection 和 Test Controller。

### 12.4 架构守卫

ESLint/依赖规则阻止：

- `domain/**` 导入 `vscode`、React、Node FS 或 Provider SDK。
- `application/**` 导入 `vscode`。
- `webview/**` 导入 Node 内置模块。
- 业务代码直接读取 SecretStorage。
- 单文件无说明地超过 400 行。

## 13. 架构决策记录

| ADR | 决策 | 理由 |
| --- | --- | --- |
| ADR-001 | 新工程物理隔离在 `ai-coding-assistant/` | 不影响现有插件和其他目录。 |
| ADR-002 | 四层 + Ports and Adapters | 隔离 VS Code、HTTP 和领域逻辑，便于测试与替换。 |
| ADR-003 | Extension Host 为单一事实来源 | Webview 可重载且不能持有安全状态。 |
| ADR-004 | URI-first 文件模型 | 支持 Remote、多根、非 `file` scheme 和跨平台路径。 |
| ADR-005 | ChangeSet 是唯一写入入口 | 强制 Diff、审批、冲突检测和回滚。 |
| ADR-006 | Zod 校验所有外部边界 | Webview、模型结构化输出、持久化和工具参数均不可信。 |
| ADR-007 | 事件 + 快照持久化任务 | 支持时间线、恢复、审计和 UI 重同步。 |
| ADR-008 | Provider/Tool/Analyzer 注册表 | 新增适配器无需修改业务分支。 |
| ADR-009 | 默认无遥测、本地优先 | 降低企业代码与行为数据外泄风险。 |
| ADR-010 | 暂停作为正交 suspension | 保留业务主状态并支持安全点暂停。 |
| ADR-011 | 自包含 VSIX 与无 CDN Webview | 满足银河麒麟内网和完全离线安装。 |
| ADR-012 | 原生依赖例外制 | 降低银河麒麟 glibc/CPU 架构不兼容风险。 |

## 14. 阶段 2 前置条件

进入工程初始化前必须：

1. 用户确认阶段 1 文档。
2. 确认扩展 ID、最低 VS Code 版本和是否纳入 Codex CLI。
3. 确认新工程目录仍为唯一写入范围。
4. 将架构守卫、pnpm、TypeScript strict、Vitest 和 Extension Host 测试骨架列为阶段 2 的完成条件。
