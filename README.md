# AI Coding Assistant

AI Coding Assistant 是一款本地优先、面向真实软件工程项目的 VS Code AI 编程助手。0.11 版本在规划、Agent 验证和安全变更闭环基础上，新增本地模块依赖关系分析、可点击文件证据，以及可跨重载恢复的任务执行时间线。

## 主要能力

- **问答、规划、执行三模式**：只读咨询、只读方案和可审核修改边界明确。
- **多模型路由**：保存多个兼容模型，为问答、规划、执行分别分配默认模型，也可在输入区即时切换。
- **统一权限**：独立控制工作区读取、模型网络、文件修改和命令执行，网络关闭时进入离线模式。
- **可视化上下文**：显式添加目录结构、Git Diff 和终端输出，无需记忆特殊语法。
- **多轮会话**：按工作区保存历史对话，支持新建、切换、重命名、归档、恢复和删除。
- **项目概览**：本地识别语言、技术栈、依赖、模块、入口、Git 状态、风险和阅读顺序。
- **模块依赖关系**：在受限本地预算内分析跨模块引用和工作区包依赖，显示引用证据并可直接打开文件。
- **画像缓存**：按工作区持久化 15 分钟索引快照，文件变化自动失效，手动重新分析可强制刷新。
- **项目工具调用**：规划/执行模式可安全列出、搜索和读取工作区内容，最多执行六轮。
- **规划确认闭环**：规划回复可由用户一键确认并交给执行模式，服务端只接受当前会话中真实、完整的规划消息。
- **回复操作**：最近一条 AI 回复支持安全重新生成，代码块支持本地高亮、独立复制和送入变更中心。
- **可恢复执行时间线**：按会话保存工具名称、输入、执行状态、测试结果、摘要和耗时，可切换查看最近任务。
- **Agent 验证闭环**：审核应用修改后可让 Agent 继续验证；测试命令仍需用户逐次模态审批，结果会回传模型。
- **可视化上下文**：一键附加当前文件/选区或项目结构，也可搜索并引用具体文件。
- **安全变更**：AI 修改先进入变更中心，再查看 VS Code 原生 Diff 并明确批准。
- **可恢复任务检查点**：待审核、已应用和可回滚状态按工作区恢复；支持批量接受、拒绝和回滚，文件有后续编辑时自动阻止覆盖。
- **首次使用向导**：引导完成工作区信任、模型密钥配置和真实连接测试，配置变化后自动要求重新测试。
- **脱敏诊断**：一键复制版本、平台、权限、索引和本地状态摘要，不包含密钥、模型地址、工作区路径或代码。
- **模型自备**：连接 OpenAI Compatible、本地或企业内网模型服务。
- **国产化与离线交付**：提供通用 VSIX，不依赖 CDN 或插件原生 Node Addon。

## 安全边界

- API Key 只保存到 VS Code SecretStorage，不返回 Webview。
- `.env`、私钥、证书和凭据路径默认禁止读取。
- 工作区未受信任时禁止读取代码、分析项目、应用修改和运行测试。
- 模型只能提出 `create`/`update` 候选修改，不能删除用户文件。
- 修改必须先打开 Diff，并在 Extension Host 模态确认框中批准后才可应用。
- 应用前重新校验原始内容 SHA-256，文件变化时拒绝覆盖。
- 测试命令显示完整命令、工作目录和执行方式并要求确认。

## 安装

要求 VS Code 1.96 或更高版本。

```powershell
code --install-extension .\artifacts\ai-coding-assistant-0.11.0.vsix --force
```

离线和银河麒麟说明见 [OFFLINE-INSTALL.zh-CN.md](OFFLINE-INSTALL.zh-CN.md)，完整操作说明见 [USER-GUIDE.zh-CN.md](USER-GUIDE.zh-CN.md)。

## 配置模型

1. 打开 Activity Bar 中的 **AI Coding Assistant**。
2. 展开默认折叠的 **设置**，或点击对话页右上角模型/齿轮按钮。
3. 点击“新增”，输入 OpenAI Compatible Base URL、Model ID 和该模型独立的 API Key。
4. 点击“保存配置”，再点击“测试连接”；可重复添加其他模型。
5. 在“默认模型分配”中分别选择问答、规划、执行使用的模型。

插件调用：

```text
GET  <baseUrl>/models
POST <baseUrl>/chat/completions
```

服务返回非 SSE JSON 时也支持普通 Chat Completions 响应。

## 使用工作台

主视图包含三个入口：

- **对话**：管理历史会话，在问答、规划、执行之间切换。
- **项目**：本地生成项目画像，不自动把扫描结果发送到模型。
- **变更**：查看行数统计、打开 Diff、批量批准/拒绝、运行测试和安全回滚。

在“规划”模式生成方案后，可以直接点击回复底部的“确认并执行计划”。插件会切换到为执行模式配置的模型，并把服务端验证过的完整计划交给 Agent；生成的文件修改仍只进入变更中心，不会绕过 Diff 审核。

AI 回复中的代码块带有独立复制按钮。点击“送入变更中心”时，插件会替换当前编辑器选区或在光标位置插入代码片段，但只生成完整文件候选变更并跳转到“变更”入口，不会直接写入文件。

审核并应用一组修改后，可以在“变更”入口点击“Agent 验证变更”。插件会从最近已应用检查点生成新的执行回合，Agent 请求运行项目测试时仍会显示固定命令审批；测试成功或失败结果随后回传模型并显示在时间线中。

输入区可选择：

- **当前文件/选区**：附加活动编辑器内容。
- **项目结构**：附加经过敏感路径过滤的文件结构。
- **添加上下文**：搜索具体文件，或添加目录结构、当前 Git Diff 和从剪贴板导入的终端输出。

仍兼容以下高级上下文语法：

```text
@workspace
@file(src/example.ts)
@search(keyword)
```

默认排除 `node_modules`、`.git`、`dist`、`build`、`out` 和 `coverage`。

## 代码修改与 Diff

只有“执行”模式允许模型返回受约束的 `ai-change-set`。插件将其保存为待审核建议：

1. 打开“变更”。
2. 点击“查看 Diff”。
3. 检查 VS Code 原生 Diff。
4. 点击“审核并应用”。
5. 在模态确认框中再次批准。

没有批准、路径不在工作区或原文件已变化时均禁止写入。

## 开发验证

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:extension
pnpm package
```

构建不会从 CDN 加载 Webview 资源。VSIX 包含 Extension Host、React Webview、Markdown 渲染、样式和图标所需的全部资源。

## 项目结构

```text
src/
  chat/          对话用例与会话持久化
  changes/       ChangeSet 解析、审批状态和 VS Code Diff
  domain/        纯领域类型
  extension/     Composition Root
  presentation/  WebviewViewProvider 与命令
  protocol/      Zod 消息协议
  providers/     OpenAI Compatible Provider
  security/      SecretStorage 和路径策略
  testing/       测试探测和受控执行
  workspace/     项目概览、URI-first 读取、上下文和搜索
webview/src/     React + Zustand 工作台
tests/           单元、集成和 Extension Host 测试
```

更完整的架构、安全和路线设计位于 `docs/`。
