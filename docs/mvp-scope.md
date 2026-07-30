# AI Coding Assistant MVP 范围与验收

> 文档状态：阶段 1 基线  
> MVP 目标：在没有自建后台的前提下，交付一条安全、可审核、可恢复的 VS Code AI 编程主路径  
> 相关文档：[需求规格](requirements.md) · [总体架构](architecture.md) · [安全设计](security.md) · [路线图](roadmap.md)

## 1. MVP 成功定义

用户能够在 Windows、主流 Linux 和指定银河麒麟目标环境中，通过在线或离线安装 VSIX，完成以下闭环：

```text
配置用户自己的模型
→ 发起带当前文件/选区的对话
→ 创建可见 Agent 计划
→ 受控读取/搜索工作区
→ 生成代码、测试或文档候选变更
→ 审核 Diff
→ 应用或拒绝变更
→ 经独立审批运行构建/测试
→ 查看结果、任务和会话历史
→ 必要时安全回滚
```

MVP 不是功能演示。每项“已支持”必须由真实实现和对应测试/手工验收证据支撑。

## 2. 支持矩阵

### 2.1 运行环境

| 环境 | MVP 目标 | 验收要求 |
| --- | --- | --- |
| Windows x64 | 支持 | VSIX 安装、激活、文件/Diff、SecretStorage、命令、测试烟测。 |
| Linux x64 | 支持 | 同上，覆盖 POSIX 路径与默认 Shell。 |
| 银河麒麟 | 支持 | 在项目指定版本、架构和 VS Code 兼容发行版上完成同等烟测；版本/架构须在阶段 2 锁定。 |
| macOS | 架构兼容，首发尽力支持 | 无平台专用阻断；是否列为正式支持取决于发布前测试资源。 |
| Remote SSH/WSL/Dev Containers | 设计支持 | MVP 至少完成一种远程场景烟测，其余按测试结果如实标注。 |
| 多根工作区 | 支持 | URI 归属、上下文选择和写入边界测试通过。 |

银河麒麟兼容策略：

- Extension Host 核心使用 TypeScript/JavaScript，MVP 避免不必要的原生 Node Addon。
- 若必须引入原生依赖，必须同时验证目标 glibc/架构并打包对应产物；否则不得列为支持。
- 文件操作使用 `vscode.workspace.fs` 和 URI，不依赖 Windows 路径或 GNU 特有命令。
- 命令探测不能假定 `bash`、`powershell`、包管理器或工具路径固定存在。
- 覆盖中文路径、带空格路径、大小写敏感文件系统和非 UTF-8 终端输出的降级处理。
- 目标银河麒麟版本、CPU 架构（至少明确 x86_64/arm64 是否都要求）和使用的 VS Code 发行版必须形成测试矩阵，未测试组合不得泛化声明。

### 2.2 安装模式

| 模式 | MVP 目标 |
| --- | --- |
| 在线安装 | 可从 VSIX 安装；是否发布公共市场不在 MVP 范围。 |
| 离线安装 | 提供自包含 VSIX、SHA-256、版本元数据和安装/升级/回退说明。 |
| 隔离网络运行 | 插件 UI、文件、任务、Diff 和本地历史可用；远程模型不可用时给出明确状态。 |
| 本地模型 | 可通过 Ollama/Custom loopback 配置实现不外网推理；Ollama 完整 Adapter 属于首版增强，若未完成需如实标注。 |

离线包不得在运行时从 CDN 加载 Webview 脚本、字体或样式，也不得在首次启动时下载必需依赖。

## 3. MVP 范围内

### 3.1 插件基础

- 独立 `ai-coding-assistant` 工程。
- pnpm、TypeScript strict、esbuild、React、Vite、Zustand、Zod、Vitest、`@vscode/test-electron`、ESLint、Prettier。
- 安装、激活、停用和资源释放。
- Activity Bar 独立入口。
- Chat/Models/Testing/Documents Webview 与 Tasks/Analysis Tree View 的基础外壳。
- Webview CSP、nonce 和版本化 Zod 消息协议。

### 3.2 模型配置与对话

- OpenAI Compatible Provider 的正式实现。
- Provider 新增、编辑、删除、连接测试、模型列表。
- 默认/快速/高能力模型角色；若只配置一个模型则可全部指向同一选择。
- API Key 和敏感 Header 使用 SecretStorage。
- 流式聊天、取消、重新生成、复制、插入编辑器。
- Ask、Explain、Edit、Agent、Review、Test、Document 模式入口；模式的深度按后续条目限定。
- Markdown、代码块、文件/行号引用。
- 会话保存、恢复和删除。

### 3.3 上下文

- 当前文件和当前选区。
- 显式 `@file`、`@folder`、`@workspace`。
- 工作区文件列表和文本搜索。
- Git Diff、VS Code Diagnostics。
- 终端/测试失败由用户显式选择或任务结果加入。
- Token 粗估、预算、去重、截断、敏感路径阻断和内容脱敏。
- 发送前 ContextManifest 和代码外发提示。

### 3.4 Agent 和工具

- 创建计划、展示步骤和完成条件。
- 主状态机、暂停/继续、软停止、取消、失败重试。
- Task 事件、快照和安全恢复。
- 工具注册、Zod 参数校验、权限评估、审批和审计。
- MVP 工具：
  - `list_directory`
  - `read_file`
  - `read_files`
  - `search_files`
  - `search_text`
  - `read_selection`
  - `read_diagnostics`
  - `get_git_status`
  - `get_git_diff`
  - `create_file`
  - `update_file`
  - `delete_file`
  - `move_file`
  - `apply_patch`
  - `run_command`
  - `run_build`
  - `run_tests`
  - `analyze_code`
  - `generate_tests`
  - `generate_document`
- `format_file` 可在已有格式化能力可控时纳入，否则作为首版增强并明确状态。

所有写工具只生成候选 ChangeSet；工具名存在不代表可以绕过审核落盘。

### 3.5 Diff、应用与回滚

- create/update/delete/rename 数据模型。
- 原生 Diff 预览。
- 单文件批准/拒绝、全部普通变更批准/拒绝。
- delete 和高风险 rename 单独审批。
- 用户编辑提议内容后重新生成 Diff。
- 基线 revision/hash 冲突检测。
- 使用 WorkspaceEdit/workspace.fs 应用。
- 逐项结果、部分失败显示和任务级逆向 ChangeSet 回滚。

### 3.6 命令

- 完整命令、参数、cwd、Shell、风险、文件和网络副作用展示。
- 每次执行前审批；低风险 remember 规则不是 MVP 必需。
- 危险命令和提权默认拒绝。
- 取消、超时、退出码、stdout/stderr、输出限长和脱敏。
- 构建/测试不能在未批准时自动运行。

### 3.7 代码分析

- 读取并展示 VS Code Diagnostics。
- 基础 AI Review，标记为 `ai_inference`。
- Finding 映射到专属 DiagnosticCollection。
- 展示位置、严重级别、类型、描述、来源、AI 解释、建议和 fixable。
- ESLint/TypeScript/C/C++/clang-tidy/Cppcheck 的完整 Adapter 属于首版增强；MVP 可先提供接口和至少一个真实静态来源，不能用 Mock 声称全部支持。

### 3.8 测试生成

- 当前文件和选区的测试生成。
- 探测现有测试框架、目录、命名和风格。
- 测试计划与候选代码。
- 经 ChangeSet/Diff 写入。
- 经命令审批运行测试。
- 结果展示并与任务关联。
- 不默认引入新测试框架。

### 3.9 文档生成

- README 和模块说明。
- 当前文件、指定目录、工作区结构、Git Diff、测试结果、用户需求作为来源。
- 草稿预览和编辑。
- 新文件/覆盖现有文件均通过 ChangeSet；现有文档覆盖需显式确认。

### 3.10 任务与历史

- 当前任务、计划、当前/已完成步骤。
- 工具、变更、命令、失败、重试、开始/完成时间。
- 会话和任务持久化。
- 恢复前重新检查 Trust、Provider、审批和文件版本。
- 用户可清除历史，默认保留策略和空间上限。

## 4. MVP 明确不包含

- 多 Agent 协作。
- 云端账号、团队协作和共享审批。
- 公共插件市场发布流程。
- 自动 Git commit、push、Pull Request。
- 向量数据库、全量代码索引和独立知识库。
- 完整语言服务器。
- 模型训练、微调、评测和推理部署。
- Kubernetes/算力管理。
- 自动永久授权命令。
- 未审核的文件写入。
- 自动上传整个工作区。
- 所有语言/测试框架/静态分析器的完整覆盖。

## 5. MVP 用户故事与验收场景

### AC-01 安装与激活

**给定** 支持的 VS Code 环境和合法 VSIX，  
**当** 用户通过 UI 或 `code --install-extension <vsix>` 安装并打开 Activity Bar，  
**那么** 插件成功激活、视图可见，停用后没有遗留进程。

### AC-02 离线安装

**给定** 一台无法访问公共互联网/Extension Marketplace 的银河麒麟或 Linux 测试机，  
**当** 用户复制 VSIX、校验 SHA-256 并离线安装，  
**那么** Webview 静态资源完整加载，插件不尝试下载运行时依赖；未配置可访问模型时明确显示离线/不可用，而非崩溃。

### AC-03 Secret

**给定** 用户配置 API Key，  
**当** 保存、重启、编辑 Provider、查看日志和存储，  
**那么** Key 只存在 SecretStorage 中，Webview 不收到回显，日志和普通状态无明文。

### AC-04 流式聊天

**给定** 可用 OpenAI Compatible 服务，  
**当** 用户携带当前选区提问，  
**那么** UI 流式显示回答，可取消，ContextManifest 与实际发送项一致。

### AC-05 敏感文件

**给定** 工作区含 `.env`、PEM 和普通源码，  
**当** 用户或模型请求目录搜索/读取，  
**那么** 敏感文件被阻断且内容不进入模型、日志或 ToolResult。

### AC-06 Agent 计划与工具

**给定** 一个跨文件修改目标，  
**当** 用户启动 Agent，  
**那么** 先看到计划；只读工具按策略执行，命令/网络/写入请求分别审批，所有事件可在任务视图追踪。

### AC-07 Diff 应用

**给定** Agent 产生两个更新和一个删除，  
**当** 用户批准更新但不批准删除，  
**那么** 只应用获批更新；删除仍待单独决定，结果逐项记录。

### AC-08 冲突

**给定** Diff 展示后用户又修改目标文件，  
**当** 插件尝试应用，  
**那么** 检测基线冲突并拒绝静默覆盖。

### AC-09 回滚

**给定** 已应用 ChangeSet 且文件未再变化，  
**当** 用户确认回滚，  
**那么** 逆向 ChangeSet 恢复原内容；若文件已变化则报告冲突。

### AC-10 命令审批

**给定** Agent 建议运行测试，  
**当** 审批卡片出现，  
**那么** 显示完整 CommandSpec、cwd、Shell、风险和副作用；拒绝后不启动进程。

### AC-11 分析来源

**给定** 同时存在 VS Code Diagnostic 和 AI Review，  
**当** 用户查看分析结果，  
**那么** 两者来源清晰，AI 内容不能冒充编译器/静态工具结论。

### AC-12 测试生成

**给定** 项目已有测试框架，  
**当** 用户为选区生成测试，  
**那么** 生成计划和符合现有风格的候选文件，经 Diff 才写入；运行需另行审批，真实结果被展示。

### AC-13 文档生成

**给定** 目标 README 已存在，  
**当** 用户生成文档，  
**那么** 先获得可编辑草稿和 Diff，未经确认不覆盖。

### AC-14 任务恢复

**给定** 插件在等待审批时重启，  
**当** 用户恢复任务，  
**那么** 旧审批失效，工作区和文件版本重新校验，不自动重放副作用。

### AC-15 银河麒麟路径兼容

**给定** 银河麒麟目标机上含中文和空格的多根工作区，  
**当** 用户读取、搜索、生成 Diff、应用和运行已审批测试，  
**那么** URI、编码和 cwd 正确，未出现 Windows 路径假设或乱码导致的数据破坏。

## 6. 质量门禁

### 6.1 必须通过

- TypeScript strict 类型检查。
- ESLint 和 Prettier 检查。
- 需求指定的领域/应用单元测试。
- Provider、文件、Diff、应用、回滚、命令审批、测试和文档集成测试。
- Extension Host 激活、命令、视图、协议、SecretStorage、Trust、DiagnosticCollection、Test Controller 测试。
- 安全滥用测试。
- Windows、Linux 和指定银河麒麟矩阵烟测。
- 在线与离线 VSIX 安装烟测。
- VSIX 包内容和 SHA-256 检查。

### 6.2 不允许作为通过证据

- 只编译未运行。
- 只用 Mock 返回成功。
- 在一个平台通过后声称全部平台支持。
- 仅能打开 Webview 而未验证 Extension Host 能力。
- 未配置真实模型却声称 Provider 兼容。
- 未断网验证却声称可离线安装。

## 7. 性能与稳定性验收

- 激活不执行网络请求或全工作区扫描。
- Webview 打开后立即显示本地状态；长请求异步执行。
- 流式增量批量刷新，持续输出时 UI 可操作。
- 文件搜索、模型输出、工具输出和历史存储均有限额。
- 所有长操作响应取消。
- 崩溃/重载后任务恢复不自动重复副作用。
- 大工作区场景不默认把全仓库内容发送给模型。

具体数值基线在阶段 2 建立测试环境后锁定，MVP 发布说明必须披露已测规模。

## 8. 安全验收

- Workspace Trust 限制生效。
- API Key 与敏感 Header 仅在 SecretStorage。
- Webview CSP/nonce、消息 Zod 校验和大小限制生效。
- 敏感路径、符号链接逃逸和工作区外访问测试通过。
- 命令、网络、删除和 Diff 审批不可伪造或重放。
- 外发前展示 Provider/Origin/ContextManifest。
- 审计日志不含 secret、完整源码或完整 prompt。
- 默认无遥测；离线模式可强制阻断网络。

## 9. 离线交付物

每个候选版本输出：

```text
ai-coding-assistant-<version>.vsix
ai-coding-assistant-<version>.vsix.sha256
ai-coding-assistant-<version>.metadata.json
OFFLINE-INSTALL.zh-CN.md
THIRD_PARTY_NOTICES.txt
```

可选企业签名：

```text
ai-coding-assistant-<version>.vsix.manifest
ai-coding-assistant-<version>.signature.p7s
```

离线说明至少包含：

- 支持的 VS Code/银河麒麟版本与 CPU 架构。
- 校验 hash、安装、启用、升级、降级和卸载命令。
- 本地 Ollama/内网 Provider 配置示例，但不包含密钥。
- 扩展存储位置、日志查看和清理方式。
- 已知限制与故障排查。

## 10. MVP Definition of Done

只有同时满足以下条件，才可标记 MVP 完成：

1. 本文所有 P0 范围实现，未实现项从宣传和 UI 中移除或明确标为不可用。
2. 关键用户故事 AC-01 至 AC-15 有测试或可复现的手工验收记录。
3. 质量、安全、平台和离线门禁通过。
4. 没有未处置的 critical/high 安全缺陷。
5. 文档、UI、package manifest 和真实能力一致。
6. 使用真实 VSIX 在干净环境安装验证，而非仅使用 Extension Development Host。
7. 银河麒麟与离线安装的实际测试环境、版本、架构和结果被记录；没有测试就不能声称通过。

## 11. MVP 后优先增强

- DeepSeek/Qwen/GLM/Moonshot/Kimi/Ollama 正式 Adapter 与契约验证。
- ESLint/TypeScript/C/C++/clang-tidy/Cppcheck Analyzer。
- 更多测试框架和 Test Explorer 深度集成。
- 更多文档模板与模板管理。
- 企业自定义 CA、策略导入、VSIX 签名流水线。
- macOS 和更多 Remote/Container 组合的正式支持矩阵。

