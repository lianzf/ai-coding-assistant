# AI Coding Assistant 开发路线图

> 文档状态：阶段 1 基线  
> 执行规则：严格逐阶段交付；每阶段完成后停止，汇报并等待用户确认  
> 相关文档：[需求规格](requirements.md) · [总体架构](architecture.md) · [MVP 范围](mvp-scope.md) · [安全设计](security.md)

## 1. 路线图原则

- 新工程固定为与既有 `vscode-gpt-codex` 同级的 `ai-coding-assistant/`。
- 不修改相邻工程；任何复用必须通过后续明确决策，不直接移动既有代码。
- 每阶段形成可验证的纵向增量，不提前宣称后续能力。
- 安全、URI/远程、银河麒麟和离线安装是横切要求，不推迟到最后补救。
- Mock/Fake 只用于隔离边界；发布能力以真实 Adapter 和实际运行结果为准。
- 每阶段均执行适用的类型、lint、单元/集成测试；失败如实记录。

## 2. 阶段总览

| 阶段 | 名称 | 核心产出 | 依赖 |
| --- | --- | --- | --- |
| 1 | 需求分析与架构设计 | 8 份设计文档 | 无 |
| 2 | VS Code 工程初始化 | 可激活的分层骨架、构建/测试/打包 | 1 确认 |
| 3 | Provider 与模型配置 | Secret、Registry、OpenAI Compatible | 2 |
| 4 | AI 对话与上下文 | React Chat、流式协议、ContextBuilder | 3 |
| 5 | Agent 与工具 | 计划、状态机、只读工具、审批骨架 | 4 |
| 6 | 文件修改与 Diff | ChangeSet、审核、应用、回滚 | 5 |
| 7 | 代码分析 | Diagnostics、Analyzer、Finding | 5 |
| 8 | 测试生成 | 框架探测、生成、审核、运行结果 | 6、7 |
| 9 | 文档生成 | 模板、草稿、审核、保存 | 4、6 |
| 10 | 任务与历史 | 时间线、快照、恢复、清理 | 5 至 9 |
| 11 | 安全、集成、兼容与打包 | 安全验证、银河麒麟、离线 VSIX、发布门禁 | 2 至 10 |

虽然第 11 阶段集中做系统验收，各阶段必须同步实现自身安全和测试，不允许积累“最后再加安全”的技术债。

## 3. 阶段 1：需求分析与架构设计

### 目标

- 确认产品边界、四层架构、关键端口、数据流和安全模型。
- 定义 Provider、Agent、Tool、Context、Change、Analysis、Test、Document、Task 和协议。
- 确定 MVP、平台/离线要求、路线与验收。

### 交付物

- `docs/requirements.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/mvp-scope.md`
- `docs/roadmap.md`
- `docs/provider-design.md`
- `docs/agent-design.md`
- `docs/data-model.md`

### 退出条件

- 8 份文档齐全且相互链接。
- 当前任务 20 项均有明确设计。
- 新工程之外无文件变更。
- 用户确认后才进入阶段 2。

### 当前状态

进行中；文档完成和一致性校验后停止。

## 4. 阶段 2：VS Code 插件工程初始化

### 目标

建立最小、可运行、可测试、可打包的独立工程，不实现大规模业务。

### 工作项

- pnpm workspace、package manifest、lockfile。
- TypeScript strict、ESLint、Prettier。
- esbuild Extension Host、Vite React Webview 双构建。
- `src/extension.ts` 薄入口和 Composition Root 骨架。
- domain/application/infrastructure/presentation/protocol 目录及依赖守卫。
- Activity Bar 和最小 WebviewView/TreeDataProvider。
- CSP/nonce 和 `state/initialize` 协议握手。
- Vitest、`@vscode/test-electron` 基础设施。
- VSIX 打包和包内容检查脚本。
- 离线资源约束：不使用 CDN，不在启动时下载依赖。

### 银河麒麟前置验证

- 与用户确认目标银河麒麟版本、CPU 架构、VS Code 发行版和安装方式。
- 选择无原生依赖或明确跨架构产物的依赖方案。
- 建立银河麒麟测试机/虚拟机/CI runner 的可复现说明。
- 在最小骨架阶段就完成 VSIX 安装与激活烟测，尽早暴露 ABI/运行时问题。

### 测试

- 类型检查、lint、格式检查。
- 激活/停用、命令注册、Activity Bar、Webview 握手。
- Windows、Linux、银河麒麟最小 VSIX 安装烟测；若环境尚未提供，状态标为未验证并阻止“正式支持”声明。

### 退出条件

- 干净环境可构建、测试、打包和安装。
- `extension.ts`/`App.tsx` 保持薄入口。
- Webview 无 Node API，CSP 生效。
- 相邻工程无改动。

## 5. 阶段 3：模型配置与 Provider 系统

### 目标

完成可扩展 Provider 核心和 OpenAI Compatible 正式实现。

### 工作项

- ProviderConfig、Capabilities、Registry、Adapter 契约。
- SecretManager 与敏感 Header。
- Model 配置 Webview 与 Zod 协议。
- 保存/编辑/删除、默认/快速/高能力角色。
- 连接测试、模型列表、流式事件、取消、超时和错误映射。
- 网络策略、Origin/重定向和代理基础。
- DeepSeek/Qwen/GLM/Moonshot/Ollama/Custom 先注册设计状态；只有实现并验证后才能启用。

### 测试

- 用户要求的 ProviderRegistry、配置校验、SecretManager 单元测试。
- 本地 HTTP Server 集成流、取消、429/5xx、重定向和 secret 脱敏。
- 可选真实 Provider 测试与默认 CI 分离。

### 退出条件

- OpenAI Compatible 真实服务或兼容测试服务完成端到端流式验证。
- API Key 不出 SecretStorage/Extension Host 安全调用栈。
- 新增测试 Profile 不修改 Chat/Agent 业务层。

## 6. 阶段 4：AI 对话与上下文系统

### 目标

交付可用 Chat Webview、会话和安全的有限上下文。

### 工作项

- Conversation/Message Store。
- ChatController、StreamResponseHandler。
- Ask/Explain/Edit/Review/Test/Document 模式请求模板。
- Markdown/代码/引用、取消、重新生成、复制、插入。
- `@file/@folder/@selection/@workspace/@git/@diagnostics/@terminal` 解析。
- ContextSourceRegistry、Budget、Deduplicator、chunk、summary。
- WorkspaceBoundary、FileIgnore、SensitiveContentFilter。
- ContextManifest 和外发提示。

### 测试

- ContextBuilder/Budget/Filter 单元测试。
- 中文、空格、非 `file` URI、多根工作区。
- Webview 流式协议、重载重同步、取消。
- 不发送敏感文件/整个工作区。

### 退出条件

- 对话与会话恢复可用。
- 实际请求不超过预算且与 manifest 一致。
- 银河麒麟目标环境中文路径读/引用烟测。

## 7. 阶段 5：Agent 与工具系统

### 目标

交付计划、状态机、受控只读工具和命令审批主链路。

### 工作项

- AgentController/Planner/Runner/StateMachine/Checkpoint。
- pause/resume/stop/cancel/retry。
- ToolRegistry、ToolExecutor、PermissionService、ApprovalService。
- 文件读取/列表/搜索、选区、诊断、Git 状态/Diff。
- 受审批 CommandSpec、build/test 命令基础。
- 循环/回合/输出预算与恢复幂等保护。

### 测试

- AgentStateMachine、Tool Schema、ToolPermission。
- 审批 hash、过期、重放、Webview 越权。
- 命令取消、超时、输出限长和危险命令拒绝。
- 不同 Shell/平台的参数执行，不用字符串拼接模拟安全。

### 退出条件

- Agent 在未审批情况下不能执行命令/网络/写入。
- UI 可完整查看计划、当前步骤、工具和错误。
- 恢复不重复非幂等副作用。

## 8. 阶段 6：文件修改与 Diff 审核

### 目标

建立唯一写入通道和可恢复变更事务。

### 工作项

- FileRevision、FileChange、ChangeSet 状态。
- create/update/delete/rename 候选生成。
- 原生 Diff 虚拟文档。
- 单项/批量审核，删除单独确认。
- 用户编辑提议。
- WorkspaceEdit 应用、版本冲突、逐项结果。
- 逆向 ChangeSet 回滚和存储清理。

### 测试

- FileChange 状态流转、Diff、应用、冲突、部分失败和 ChangeRollback。
- 脏文档、中文/空格 URI、多根、非 `file` Provider。
- 审批后篡改、符号链接逃逸。

### 退出条件

- AI/Tool 没有其他文件写入路径。
- 未批准、过期、冲突变更均无法应用。
- 回滚不会覆盖用户后续编辑。

## 9. 阶段 7：代码分析

### 目标

统一诊断和 Finding 模型，清楚区分事实来源与 AI 推测。

### 工作项

- AnalyzerRegistry、环境探测、CodeAnalysisService。
- VS Code Diagnostics Adapter 和 DiagnosticMapper。
- 基础 AI Review。
- ESLint/TypeScript Analyzer。
- C/C++ compiler、clang-tidy、Cppcheck 和 Custom Command 接口。
- Analysis Tree、定位、解释、建议。

### 测试

- 来源映射、severity/range、重复项、专属 DiagnosticCollection。
- 分析命令审批和解析失败。
- AI explanation 不改原始 evidence/provenance。

### 退出条件

- 至少 VS Code Diagnostics 与基础 AI Review 真实可用。
- 其他 Analyzer 按真实验证状态启用，不以占位接口声称支持。

## 10. 阶段 8：测试生成

### 目标

完成“探测 → 计划 → 生成 → Diff → 应用 → 审批运行 → 结果”闭环。

### 工作项

- TestFrameworkRegistry/Detector、TestContextBuilder。
- 当前函数/文件/选区/接口/需求/缺陷/边界目标。
- 优先支持当前仓库已存在的 Vitest/Jest/Mocha 风格。
- Pytest/JUnit/GoogleTest 探测和模板扩展。
- Test Explorer 结果映射。

### 测试

- 不引入新框架。
- 生成内容路径、命名和导入风格。
- 写入仍走 ChangeSet。
- 命令拒绝时不运行；真实退出码/失败证据展示。

### 退出条件

- 至少一种现有框架完成真实端到端。
- 测试失败不被报告为通过。

## 11. 阶段 9：文档生成

### 目标

完成 README 和模块说明的草稿、审核和保存闭环。

### 工作项

- DocumentTemplate/Registry/Reviewer。
- 来源选择、ContextManifest、模板变量校验。
- Draft 编辑和预览。
- 已有/新目标统一转 ChangeSet。
- 扩展 API、设计、审查、测试、变更和发布说明模板。

### 测试

- 用户导入模板不提升为系统指令。
- 已有文档未经确认不覆盖。
- 草稿编辑后旧审批失效。

### 退出条件

- README 和模块说明正式可用。
- 来源和目标变更可追踪。

## 12. 阶段 10：任务管理与历史

### 目标

将已有能力整合为稳定任务时间线、快照、恢复和清理体验。

### 工作项

- TaskStore JSONL + snapshot、乐观并发、Schema 迁移。
- Task Tree 和详情。
- 会话/任务/工具/审批/变更/测试关联。
- 重启恢复、失败 retry 和清理策略。
- 审计查看和历史删除。

### 测试

- TaskStore 原子性、损坏隔离、sequence、迁移。
- 各业务状态投影。
- 恢复时权限、文件版本和非幂等调用复查。

### 退出条件

- 重启后不会丢失已提交事件。
- Webview 重载不改变事实状态。
- 存储受保留和空间限制。

## 13. 阶段 11：安全测试、集成测试、兼容与打包

### 目标

验证完整产品故事，完成可审计的跨平台和离线交付。

### 工作项

- 完整安全测试：Trust、Secret、CSP、路径、符号链接、命令、网络、脱敏、prompt injection、审批重放。
- 完整集成/Extension Host 测试。
- 性能、取消、长流、大工作区、存储损坏和恢复。
- Windows、Linux、银河麒麟目标矩阵。
- Remote SSH/WSL/Dev Containers 选定矩阵。
- 自包含 VSIX、包内容 allowlist、SBOM/第三方声明。
- SHA-256、metadata、离线安装/升级/回退文档。
- 可选企业签名与验证。
- 在断网干净机完成安装和运行烟测。

### 银河麒麟验收记录

每个组合记录：

- OS 完整版本与补丁级别。
- CPU 架构。
- VS Code/兼容发行版版本。
- Node Extension Host 版本。
- Shell、locale、文件系统。
- 安装、激活、Webview、SecretStorage、中文路径、Diff、命令、测试、卸载结果。
- 已知限制和日志链接。

### 退出条件

- [MVP Definition of Done](mvp-scope.md#10-mvp-definition-of-done) 全部满足。
- 无 critical/high 未处置安全缺陷。
- VSIX 在目标离线环境通过真实安装。
- 发布说明只声明实际验证的 Provider、系统和功能。

## 14. 阶段依赖与可并行项

在“每阶段确认后继续”的前提下，阶段内可并行：

- UI 组件与纯领域模型。
- Adapter 实现与契约测试。
- Windows/Linux/银河麒麟环境准备。
- 文档、测试 fixture 和安全用例。

不可倒置：

- 未有协议/Secret 边界前不做 Provider 表单。
- 未有 ToolPermission 前不做命令执行。
- 未有 ChangeSet 前不做生成内容落盘。
- 未有冲突检测前不做回滚承诺。
- 未有真实平台/离线测试前不宣称兼容。

## 15. 风险登记

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 范围过大 | MVP 延期、测试稀释 | 按 P0 闭环优先，Provider/Analyzer 广度在真实验证后启用。 |
| Provider 协议漂移 | 流/工具调用失败 | Adapter 契约、错误归一化、官方协议验证、能力保守默认。 |
| 模型 prompt injection | 越权工具/外发 | 内容视为数据、策略在 Host 强制、参数重验、审批。 |
| 多文件非原子 | 部分应用 | 全量预检、单 WorkspaceEdit、逐项记录、补偿回滚。 |
| Remote URI 差异 | 路径逃逸/功能异常 | URI-first、FileSystemProvider、保守边界和真实远程测试。 |
| 银河麒麟 ABI/架构差异 | 无法激活/安装 | 避免原生依赖、阶段 2 早期烟测、明确版本/架构矩阵。 |
| 离线缺依赖/资源 | Webview 或运行时失败 | bundle 所有资源、断网干净机验证、VSIX 内容门禁。 |
| Secret 泄漏日志 | 凭据暴露 | 不透明 SecretValue、统一脱敏、错误安全摘要、测试。 |
| 存储增长 | 磁盘占用/隐私 | 保留期限、空间上限、artifact 清理、不长期保存源码。 |
| 命令平台差异 | 参数/编码/终止失败 | argv 优先、Shell 探测、进程树控制、平台矩阵。 |

## 16. 每阶段固定汇报模板

每阶段结束必须包含：

1. 本阶段目标。
2. 已完成内容。
3. 新增文件。
4. 修改文件。
5. 核心架构决策。
6. 执行的命令。
7. 测试结果。
8. 类型检查结果。
9. 当前问题。
10. 安全风险。
11. 尚未完成内容。
12. 下一阶段计划。

若未执行测试或类型检查，必须明确写“未执行”及原因，不得写“通过”。

## 17. 进入下一阶段的控制

当前只允许完成阶段 1。文档校验和汇报后必须停止。只有用户明确确认进入阶段 2，才能在新工程中创建 package、源码、测试和构建配置。

