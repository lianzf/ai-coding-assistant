# AI Coding Assistant 需求规格

> 文档状态：阶段 1 基线  
> 适用范围：独立新工程 `ai-coding-assistant/`  
> 相关文档：[总体架构](architecture.md) · [安全设计](security.md) · [MVP 范围](mvp-scope.md) · [路线图](roadmap.md)

## 1. 文档目的

本文定义 AI Coding Assistant 的产品边界、功能需求、质量属性、约束与验收口径。后续设计、实现和测试必须能追溯到本文件中的需求编号。

## 2. 仓库现状与工程隔离

当前工作区已有一个可运行的 VS Code 插件原型，包含单文件 Webview、Codex CLI/OpenAI 兼容调用、会话、简单 Diff、SARIF 和 JUnit 导入能力。现状存在以下特点：

- `src/extension.ts` 超过 1,200 行，表现、应用和基础设施职责混合。
- Webview 使用 Extension Host 内嵌 HTML，而非 React/Vite 独立构建。
- Provider、Agent、工具、审批、上下文和变更事务尚未形成稳定抽象。
- 当前使用 npm、Node 内置测试和 `tsc`，与目标技术栈存在差异。
- 已有代码和产物属于另一个工程，不作为新工程的可修改范围。

本项目采用物理目录隔离：

- 新工程根目录固定为 `ai-coding-assistant/`。
- 阶段 1 只创建 `ai-coding-assistant/docs/` 下的架构文档。
- 不修改当前工作区根目录的 `src/`、`docs/`、`package.json`、脚本、资源或 VSIX。
- 阶段 2 才在新工程目录内初始化源码、依赖和构建配置。

## 3. 产品定位

AI Coding Assistant 是一个本地优先、用户可控、面向单工作区开发流程的 VS Code AI 编程插件。它在不依赖自建后台的情况下，提供：

- 代码问答、解释、审查与修改建议。
- 工作区文件读取、搜索、诊断汇总和上下文组织。
- Agent 计划、受控工具调用、任务状态和历史恢复。
- 代码变更的 Diff 审核、冲突检查、应用与回滚。
- 测试和软件文档生成。
- 用户自定义模型服务、模型能力和网络策略。

插件不是模型托管、训练、集群调度或团队协作平台。

## 4. 用户与关键场景

### 4.1 目标用户

- 在 VS Code 中开发 TypeScript、JavaScript、C/C++ 或其他项目的工程师。
- 使用公有模型、自建 OpenAI 兼容服务或本地 Ollama 的团队。
- 对代码外发、命令执行和变更落盘有审批要求的企业用户。

### 4.2 关键场景

1. 用户引用当前选区，让 AI 解释或审查代码。
2. 用户提出跨文件修改任务，Agent 先计划、搜索，再提出 ChangeSet。
3. 用户逐文件审核 Diff，通过后应用；若源文件已变化则阻止覆盖。
4. 用户要求生成单元测试，插件识别已有测试框架并提供 Diff。
5. 用户要求生成 README 或模块说明，预览和编辑后再保存。
6. 用户配置 OpenAI Compatible、DeepSeek、Qwen、GLM、Moonshot/Kimi、Ollama 或自定义服务。
7. 用户批准一条明确展示风险的构建或测试命令，并查看结果。
8. 用户恢复历史会话或任务，但插件不长期保存完整源码副本。

## 5. 功能边界

### 5.1 范围内

- VS Code Desktop Extension Host。
- Activity Bar、WebviewView、Tree View、原生 Diff、Problems、Test Explorer、命令面板和状态栏。
- 用户直接配置的模型 HTTP 接口或本机 Ollama。
- 本地/远程工作区文件、Git、诊断、终端和测试结果。
- Windows、Linux、银河麒麟、macOS、Remote SSH、WSL、Dev Containers 和多根工作区。
- 离线模式、无遥测模式和企业内网分发。

### 5.2 范围外

- Kubernetes、CPU/GPU/NPU 调度。
- 模型训练、微调、评测或推理集群部署。
- DeepSpeed、ColossalAI、LlamaFactory、OpenCompass、vLLM 管理。
- 独立知识库、代码索引后台、用户系统、Web 管理平台。
- 云端团队协作、插件市场、自动 Git 提交和自动 Pull Request。
- 多 Agent 协作、向量数据库和完整语言服务器。

外部系统只能以可选端口形式扩展，不得成为本地核心流程的运行前提。

## 6. 功能需求

下列优先级使用 `P0`（MVP 必需）、`P1`（首版增强）、`P2`（后续）表示。

### 6.1 插件外壳与导航

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-SHELL-001 | P0 | 插件必须可安装、激活、停用并释放所有 Disposable、流和临时资源。 |
| FR-SHELL-002 | P0 | Activity Bar 必须提供独立 AI Assistant 入口。 |
| FR-SHELL-003 | P0 | 至少提供 AI 编程、任务、代码分析、模型、测试、文档六个逻辑视图；高频内容可用 Webview，状态列表优先使用 TreeDataProvider。 |
| FR-SHELL-004 | P0 | `extension.ts` 只调用激活/停用生命周期，不承载业务逻辑。 |
| FR-SHELL-005 | P0 | Webview `App.tsx` 只负责入口、布局和路由，不直接访问 Node.js、VS Code API、文件、模型或终端。 |
| FR-SHELL-006 | P0 | 所有 Webview 副作用必须通过版本化消息协议发送到 Extension Host。 |

### 6.2 AI 对话

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-CHAT-001 | P0 | 支持 Ask、Explain、Edit、Agent、Review、Test、Document 七种交互模式。 |
| FR-CHAT-002 | P0 | 支持 Markdown、代码块、文件/行号引用和流式输出。 |
| FR-CHAT-003 | P0 | 支持取消当前生成；取消必须传播到 Provider、工具和 UI。 |
| FR-CHAT-004 | P0 | 支持重新生成、复制回答、插入当前编辑器和从回答创建变更建议。 |
| FR-CHAT-005 | P0 | 支持创建、保存、列出、恢复和归档会话。 |
| FR-CHAT-006 | P0 | 会话历史保存消息和引用，不长期复制整个源文件正文。 |
| FR-CHAT-007 | P1 | 支持对即将发送的上下文进行预览、移除和优先级调整。 |

### 6.3 模型 Provider

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-MODEL-001 | P0 | 通过统一 `ModelProvider` 接口完成配置校验、连接测试、模型列表、能力查询和流式对话。 |
| FR-MODEL-002 | P0 | MVP 实现 OpenAI Compatible；首版增加 DeepSeek、Qwen、GLM、Moonshot/Kimi、Ollama 和 Custom Adapter。 |
| FR-MODEL-003 | P0 | 用户可新增、编辑、删除 Provider，并设置默认、快速和高能力模型。 |
| FR-MODEL-004 | P0 | 配置支持显示名、Base URL、模型 ID、自定义请求头、超时、代理、上下文长度和能力覆盖。 |
| FR-MODEL-005 | P0 | API Key 只能写入 SecretStorage；Webview 只能获知 `hasSecret`，不能收到密钥值。 |
| FR-MODEL-006 | P0 | Provider 差异必须封装在 Adapter/注册表中，应用层不得出现成片的 Provider ID 条件分支。 |
| FR-MODEL-007 | P0 | 流式事件必须表达文本增量、推理增量、工具调用、用量、完成和结构化错误。 |
| FR-MODEL-008 | P1 | Provider 能力必须参与模型选择和功能降级，例如无工具调用时禁用自主 Agent。 |

### 6.4 上下文

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-CTX-001 | P0 | 支持 `@file`、`@folder`、`@selection`、`@workspace`、`@git`、`@diagnostics`、`@terminal` 引用。 |
| FR-CTX-002 | P0 | 支持当前文件、选区、指定文件/目录、目录结构、Git Diff、Diagnostics、终端、编译错误、测试失败和用户需求。 |
| FR-CTX-003 | P0 | 按模型上下文窗口和保留输出预算进行 Token 粗估、排序、去重、截断和分块。 |
| FR-CTX-004 | P0 | 禁止默认发送整个工作区；每次请求必须生成可审计的 ContextManifest。 |
| FR-CTX-005 | P0 | 敏感路径在收集前阻断，敏感内容在外发前脱敏。 |
| FR-CTX-006 | P1 | 支持代码符号提取、会话摘要和大文件按相关片段选择。 |

### 6.5 Agent 与工具

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-AGENT-001 | P0 | Agent 必须先形成可见计划，再进入搜索、工具和变更流程。 |
| FR-AGENT-002 | P0 | 支持暂停、继续、软停止、取消和失败步骤重试。 |
| FR-AGENT-003 | P0 | Agent 状态、步骤、工具调用、审批、变更和错误必须作为事件持久化。 |
| FR-AGENT-004 | P0 | 恢复任务必须从安全检查点继续，不能盲目重复有副作用的工具。 |
| FR-TOOL-001 | P0 | 所有工具经 `ToolRegistry` 注册，输入使用 Zod 校验，输出使用统一结果封装。 |
| FR-TOOL-002 | P0 | 首版提供附件要求中的文件、搜索、诊断、Git、变更、命令、分析、测试和文档工具。 |
| FR-TOOL-003 | P0 | 工具必须声明 `read/write/execute/network/dangerous` 权限等级和副作用元数据。 |
| FR-TOOL-004 | P0 | 权限策略必须在执行器侧强制，不得信任模型或 Webview 声明。 |
| FR-TOOL-005 | P0 | 工具结果必须限长、可取消、可审计，并将不可信工作区内容标记为数据。 |

### 6.6 文件变更与 Diff

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-CHANGE-001 | P0 | 模型不能直接覆盖文件；所有写入必须先形成 ChangeSet 和 FileChange。 |
| FR-CHANGE-002 | P0 | 支持 create、update、delete、rename，并为每个变更保存基线版本标识。 |
| FR-CHANGE-003 | P0 | 使用 VS Code 原生 Diff 展示建议，支持单项/全部批准和拒绝。 |
| FR-CHANGE-004 | P0 | 删除和重命名必须单独确认，不能被“全部批准”隐式放行。 |
| FR-CHANGE-005 | P0 | 应用前重新计算当前版本；基线不一致时标记冲突，禁止静默覆盖。 |
| FR-CHANGE-006 | P0 | 使用 `WorkspaceEdit` 或 `workspace.fs` 按 URI 应用，并记录事务结果。 |
| FR-CHANGE-007 | P0 | 支持任务级回滚；回滚也要检查当前版本，避免覆盖用户后续修改。 |
| FR-CHANGE-008 | P1 | 用户可以在应用前编辑提议内容并重新生成 Diff。 |

### 6.7 命令执行

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-CMD-001 | P0 | 每次命令执行前展示完整参数、工作目录、Shell、风险、文件副作用和网络访问。 |
| FR-CMD-002 | P0 | 命令必须逐次或按严格策略审批，不接受模型自我授权。 |
| FR-CMD-003 | P0 | 默认拒绝 `sudo`、提权、凭据读取、破坏性磁盘/仓库操作和策略未知的危险命令。 |
| FR-CMD-004 | P0 | 支持取消、超时、输出限长、退出码和 stdout/stderr 分离。 |
| FR-CMD-005 | P0 | Remote/WSL/Container 中应在对应 Extension Host 环境执行，不拼接本地文件系统假设。 |

### 6.8 代码分析

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-ANALYSIS-001 | P0 | 汇总 VS Code Diagnostics、编译器、静态分析器和 AI 辅助分析。 |
| FR-ANALYSIS-002 | P0 | `CodeFinding` 必须携带来源类别，UI 明确区分工具事实、编译器结果和 AI 推测。 |
| FR-ANALYSIS-003 | P0 | 结果映射到专属 `DiagnosticCollection`，不覆盖其他扩展的诊断。 |
| FR-ANALYSIS-004 | P0 | MVP 支持现有 VS Code Diagnostics 和基础 AI Review。 |
| FR-ANALYSIS-005 | P1 | 首版支持 ESLint、TypeScript、C/C++ 编译诊断、clang-tidy、Cppcheck 和自定义命令分析器。 |
| FR-ANALYSIS-006 | P0 | 外部分析命令遵循命令审批策略。 |

### 6.9 测试生成

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-TEST-001 | P0 | 可按函数、文件、选区、接口、需求、缺陷和边界条件生成测试计划及测试代码。 |
| FR-TEST-002 | P0 | 先检测已有框架、目录、配置和风格；不得默认引入新测试框架。 |
| FR-TEST-003 | P0 | 生成代码只能作为 ChangeSet，经 Diff 审核后写入。 |
| FR-TEST-004 | P0 | 运行测试必须另行获得命令审批，结果与任务和生成批次关联。 |
| FR-TEST-005 | P0 | MVP 至少覆盖当前文件/选区和已有 Vitest/Jest/Mocha 风格；其他框架通过探测器扩展。 |
| FR-TEST-006 | P1 | 结果可映射到 Test Explorer，并展示通过、失败、跳过、耗时和失败证据。 |

### 6.10 文档生成

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-DOC-001 | P0 | 支持 README、模块说明；首版扩展 API、设计、审查、测试、变更和发布说明。 |
| FR-DOC-002 | P0 | 支持当前文件、目录结构、Git Diff、测试结果、用户需求和导入模板作为来源。 |
| FR-DOC-003 | P0 | 文档先生成草稿，允许预览和编辑，确认后才保存。 |
| FR-DOC-004 | P0 | 已有文档不得未经明确确认被覆盖。 |
| FR-DOC-005 | P1 | 模板具有 ID、版本、适用类型、变量 Schema 和来源信息。 |

### 6.11 任务与历史

| 编号 | 优先级 | 需求 |
| --- | --- | --- |
| FR-TASK-001 | P0 | 任务视图展示计划、当前/已完成步骤、工具、变更、命令、失败、重试和时间。 |
| FR-TASK-002 | P0 | TaskStore 采用事件加快照方式持久化，写入必须原子化并具备 Schema 版本。 |
| FR-TASK-003 | P0 | 启动时可恢复未完成任务，但恢复前必须重新检查工作区、配置、权限和文件版本。 |
| FR-TASK-004 | P0 | 历史记录支持保留期限、删除和敏感数据最小化。 |

## 7. 非功能需求

| 编号 | 类别 | 要求 |
| --- | --- | --- |
| NFR-ARCH-001 | 架构 | 四层依赖只能由表现层/应用层指向领域端口，再由基础设施实现端口；领域层不得依赖 React、VS Code、Webview 或具体模型 SDK。 |
| NFR-ARCH-002 | 模块化 | 单个业务文件原则上不超过 400 行；超限必须在评审中说明。 |
| NFR-TYPE-001 | 类型 | TypeScript `strict` 开启，跨边界数据均校验，禁止以大量 `any` 逃避建模。 |
| NFR-PERF-001 | 响应 | 本地 UI 操作目标 100 ms 内反馈；长任务立即返回 task/request ID 并异步更新。 |
| NFR-PERF-002 | 流式 | 正常网络下首个流式事件目标 3 秒内出现；插件本地处理不得无界缓冲。 |
| NFR-REL-001 | 可靠性 | 所有长任务支持 AbortSignal；扩展停用时终止或安全检查点化。 |
| NFR-REL-002 | 一致性 | 文件应用和回滚使用版本前置条件；持久化写入使用临时文件替换或等效原子机制。 |
| NFR-COMPAT-001 | 兼容 | 文件操作优先 `vscode.workspace.fs` 和 URI，不假定 `file://`、路径分隔符或单根工作区。 |
| NFR-COMPAT-002 | 兼容 | MVP 必须在指定银河麒麟版本、CPU 架构和 VS Code 发行版上完成真实安装与核心流程烟测；未验证组合不得声称支持。 |
| NFR-DIST-001 | 分发 | 离线 VSIX 必须自包含全部运行资源，不依赖 CDN、市场或首次启动下载，并提供 SHA-256、版本元数据、安装/升级/回退说明。 |
| NFR-SEC-001 | 安全 | Workspace Trust、SecretStorage、CSP/nonce、消息 Schema、路径边界、命令和网络策略必须默认拒绝。 |
| NFR-PRIV-001 | 隐私 | 默认无遥测；日志、存储和消息中不得出现 API Key、授权头或完整敏感文件。 |
| NFR-UX-001 | 可解释 | 用户能看到发送给模型的上下文类别、工具理由、审批内容、Diff 原因和 Finding 来源。 |
| NFR-TEST-001 | 测试 | 单元、集成、Extension Host 测试采用真实被测逻辑；Mock 只隔离外部边界，不得冒充已实现能力。 |
| NFR-I18N-001 | 国际化 | UI 文案与协议错误码分离，首版至少支持简体中文，结构允许增加英文。 |
| NFR-A11Y-001 | 可访问性 | Webview 支持键盘导航、可见焦点、语义标签、主题变量和 reduced-motion。 |

## 8. 技术与工程约束

- TypeScript、VS Code Extension API、Node.js Extension Host。
- React、Vite、Zustand、Zod。
- Vitest、`@vscode/test-electron`、esbuild。
- pnpm workspace、ESLint、Prettier。
- Extension Host 与 Webview 分开构建，协议包只含纯类型和 Zod Schema。
- 运行时不得要求外部自建后台。
- 不内置 API Key，不自动上传整个工作区，不自动读取敏感文件。
- 优先使用纯 TypeScript/JavaScript 依赖；引入原生 Node Addon 前必须验证银河麒麟目标 glibc 与 x86_64/arm64 架构产物。
- 离线状态下不得自动联网获取 Webview 静态资源、字体、依赖或更新。

## 9. 数据与隐私约束

| 数据 | 存储位置 | 禁止事项 |
| --- | --- | --- |
| API Key/Token | `ExtensionContext.secrets` | 不得进入 Webview、settings、state、JSON、日志或 Git。 |
| Provider 非敏感配置 | `globalState` | 自定义 Header 的敏感值不得明文保存。 |
| 工作区 UI 状态 | `workspaceState` | 不保存源码正文。 |
| 会话/全局任务 | `globalStorageUri` | 不长期复制完整源代码。 |
| 工作区任务/ChangeSet | `storageUri` | 快照限于未完成变更和有限回滚窗口，需加保留策略。 |
| 审计日志 | storage URI 下滚动文件 | 不记录秘密、完整提示词、完整源码或未经脱敏的终端输出。 |

## 10. 需求冲突的设计裁决

### 10.1 Agent 暂停状态

给定 `AgentStatus` 未包含 `paused`，但功能要求支持暂停/继续。设计保留给定主状态集合，并增加正交字段：

```ts
type AgentSuspension = "running" | "pause_requested" | "paused";
```

暂停只发生在安全点，不把 `waiting_for_approval` 等业务阶段丢失。详见 [Agent 设计](agent-design.md)。

### 10.2 多视图与“不集中在一个 Webview”

“不集中在一个 Webview”解释为职责和生命周期隔离，而非强制每个页面一个扩展实例：

- Chat、Models、Testing、Documents 使用独立 WebviewViewProvider 或独立路由入口。
- Tasks、Analysis 优先使用 TreeDataProvider，并以详情面板补充。
- Diff 使用 VS Code 原生 Diff Editor。
- 所有视图共享协议和应用服务，但不共享巨型组件状态。

### 10.3 修改必须审批与工具 `apply_patch`

工具名 `apply_patch` 表示“生成或验证候选补丁”，不表示绕过审核直接写盘。真正落盘只能由 ChangeApplier 在获批 ChangeSet 上执行。

## 11. 阶段 1 验收

阶段 1 只交付以下文档，不创建业务代码或工程依赖：

- `requirements.md`
- `architecture.md`
- `security.md`
- `mvp-scope.md`
- `roadmap.md`
- `provider-design.md`
- `agent-design.md`
- `data-model.md`

验收条件：

1. 20 项当前任务均能定位到至少一份设计文档。
2. 四层架构、模块职责、数据流、目录结构和依赖规则明确。
3. Provider、Agent、AgentTool、ContextBuilder、FileChange、分析、测试、文档、任务和协议均有接口或状态设计。
4. 安全控制覆盖密钥、Webview、工作区、命令、网络、外发、日志、离线和无遥测。
5. MVP、路线图、测试层级和阶段退出标准相互一致。
6. 新工程之外没有文件变更。
7. 银河麒麟和离线安装已进入 MVP 支持矩阵、路线图与发布验收，且没有把设计目标表述为已测试结果。

## 12. 待阶段 2 确认的产品决策

以下事项不阻塞架构，但应在阶段 2 开始前确认：

- 扩展正式 ID、Publisher、中文/英文显示名。
- VS Code 最低版本；建议以支持目标 Webview/Testing API 的稳定版本为准。
- MVP 是否保留 Codex CLI 作为额外 Provider；当前需求并未将它列为首版必选。
- 默认允许的网络域策略和企业代理认证方式。
- 回滚快照默认保留时长与空间上限。
- 首发是否同时支持简体中文和英文 UI。
- 银河麒麟目标版本、CPU 架构、VS Code/兼容发行版和可用测试环境。
