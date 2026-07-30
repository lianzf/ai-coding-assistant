# AI Coding Assistant 安全设计

> 文档状态：阶段 1 基线  
> 安全原则：默认拒绝、最小权限、明确同意、数据最小化、全程可取消、结果可审计  
> 相关文档：[需求规格](requirements.md) · [总体架构](architecture.md) · [Agent 设计](agent-design.md) · [数据模型](data-model.md)

## 1. 目标与非目标

本设计保护：

- 用户源代码、配置、凭据、终端输出和测试数据。
- 工作区文件完整性与用户未保存的编辑。
- Extension Host、远程开发环境和本机命令执行边界。
- 模型服务认证信息和自定义请求头。
- 审批决定、任务历史与审计记录的可信度。

本设计不承诺：

- 将第三方模型变成可信执行主体。
- 在已被系统管理员或其他扩展完全控制的宿主机上建立强隔离。
- 代替操作系统沙箱、企业 DLP、代理或终端安全产品。

## 2. 信任边界

```text
可信度较高
┌───────────────────────────────────────────────┐
│ Extension Host policy / domain rules          │
│ SecretStorage / signed extension package      │
├───────────────────────────────────────────────┤
│ User approval / VS Code workspace APIs        │
├───────────────────────────────────────────────┤
│ Workspace files / Git / terminal output       │  不可信数据
├───────────────────────────────────────────────┤
│ Webview messages / imported files             │  不可信输入
├───────────────────────────────────────────────┤
│ Model output / tool calls / remote HTTP        │  不可信输入
└───────────────────────────────────────────────┘
可信度较低
```

关键判断：

- 工作区内容可能包含 prompt injection，不能被当作系统指令。
- 模型发出的工具调用只是请求，不是授权。
- Webview 可被注入或重放消息，不能决定权限、secret、文件基线和任务归属。
- 用户审批必须基于 Extension Host 重新构造的完整事实，而非模型提供的描述。

## 3. 数据分类

| 级别 | 示例 | 处理规则 |
| --- | --- | --- |
| S0 公开 | 插件版本、公开模型能力 | 可记录和显示。 |
| S1 内部 | 文件路径、任务标题、非敏感配置 | 最小化存储，外发前提示。 |
| S2 机密 | 源码片段、Git Diff、诊断、终端/测试输出 | 仅为明确任务收集；外发需策略允许；日志不记录正文。 |
| S3 秘密 | API Key、Token、Authorization、自定义敏感 Header、私钥 | 只能存 SecretStorage 或内存短暂使用；禁止 Webview、日志、普通存储和模型上下文。 |

任何无法判断的数据按更高一级处理。

## 4. Workspace Trust

### 4.1 非受信工作区

工作区未受信时：

- 允许无工作区内容的模型配置管理和静态帮助。
- 默认禁止读取工作区文件、Git、诊断正文和终端输出。
- 禁止命令、分析器、格式化、构建、测试和任何写入。
- 禁止自动恢复会产生副作用的历史任务。
- UI 明确显示受限模式及启用功能所需条件。

### 4.2 信任变化

- 监听 Workspace Trust 变化并重新计算能力。
- 从受信变为非受信时取消运行中的命令/写工具，作废待审批请求。
- 已构建的 ContextManifest 在发送前再次检查信任状态。

## 5. 密钥与 Provider 配置

### 5.1 SecretStorage

每个敏感值使用不可推导明文的引用：

```text
aiCodingAssistant.provider.<providerConfigId>.apiKey
aiCodingAssistant.provider.<providerConfigId>.header.<headerId>
aiCodingAssistant.provider.<providerConfigId>.proxyCredential
```

规则：

- `ProviderConfig` 只保存 `secretRef` 或 `hasSecret`。
- 设置密钥使用专门的 Extension Host 命令；Webview 发送的新密钥只存在单次消息内，处理后立即丢弃引用。
- 读取密钥仅发生在即将发送请求的 Provider Adapter 内。
- 删除 Provider 时先删除 SecretStorage，再删除非敏感配置；失败时显示部分完成状态。
- 不支持 API Key 回显。编辑表单显示“已配置/未配置”，更改时必须重新输入。
- Secret 值和包含它们的 Header 永不进入错误详情、审计字段或崩溃报告。

### 5.2 自定义请求头

- Header 名称与值分别建模。
- `Authorization`、`Proxy-Authorization`、`X-API-Key`、名称含 `token/secret/key/auth/cookie` 的值按 S3 存 SecretStorage。
- 禁止用户覆盖 `Host`、`Content-Length`、`Transfer-Encoding` 等 hop-by-hop/请求完整性 Header。
- 日志仅记录允许的 Header 名称，不记录值。

## 6. Webview 安全

### 6.1 CSP 与资源

每次生成 HTML 使用加密随机 nonce：

```text
default-src 'none';
img-src <webview.cspSource> https: data:;
style-src <webview.cspSource> 'nonce-<nonce>';
font-src <webview.cspSource>;
script-src 'nonce-<nonce>';
connect-src 'none';
```

- Webview 不直接联网，模型和资源请求由 Extension Host 代理。
- 不使用 `unsafe-eval`、内联事件处理器或未带 nonce 的脚本。
- 本地资源通过 `asWebviewUri`，`localResourceRoots` 限定在 Webview 构建产物和必要资源目录。
- Markdown HTML 必须消毒；默认禁用原始 HTML，链接使用 allowlist scheme。
- 文件链接不直接拼接命令 URI，由 Extension Host 校验后打开。

### 6.2 消息校验

- 所有入站消息用带 `protocolVersion` 的 Zod discriminated union 校验。
- 设置最大消息大小；超限拒绝并审计，不尝试解析大对象。
- `messageId` 防重放，`correlationId` 只能引用当前 Webview session 可见对象。
- Extension Host 从当前会话重新解析 task/change/approval 所有权。
- 未知字段默认剥离或拒绝，安全敏感消息使用 `.strict()`。
- UI 收到的文本按文本渲染，禁止将模型输出拼入 `innerHTML`。

## 7. 工作区路径与文件安全

### 7.1 URI-first 边界

允许范围由当前 `workspaceFolders[].uri` 定义，不使用字符串前缀判断。

检查顺序：

1. 解析并规范化 URI。
2. 确认 scheme 是当前 FileSystemProvider 支持的 scheme。
3. 查找最长匹配的 workspace folder。
4. 对本地 `file` URI 解析真实路径并检查符号链接/junction。
5. 对非 `file` URI 使用对应 Provider 能力，并将无法证明的边界判为需要审批。
6. 应用 ignore/sensitive policy。
7. 在真正读写前再次检查，降低 TOCTOU 风险。

### 7.2 默认禁止读取

默认大小写不敏感匹配：

```text
.env
.env.*
*.key
*.pem
*.p12
*.pfx
id_rsa
id_ed25519
credentials
secrets
```

同时阻止：

- `.ssh/`、云厂商凭据目录、浏览器资料、系统密钥链导出。
- 工作区外路径，除非用户针对明确 URI 单独授权。
- 二进制文件、设备文件和超出大小上限的文件。

用户不能通过模型工具调用覆盖硬拒绝项。企业策略可增加拒绝项，不能由 Webview 降级。

### 7.3 默认排除

```text
node_modules
.git/objects
dist
build
out
coverage
大型二进制文件
```

`.gitignore`、`.ignore` 与插件专用 ignore 只用于进一步减少范围；它们不是敏感文件保护的替代。

### 7.4 文件写入

- 任何写入必须关联已批准 ChangeSet。
- 应用前校验 URI、基线 revision/hash、当前文档版本和工作区信任。
- 打开的脏文档不能被后台字节写入覆盖；使用 WorkspaceEdit 并保留编辑器撤销语义。
- 删除/重命名必须单独审批。
- 回滚也是写入，必须进行版本冲突检查。
- 临时文件只创建在 `storageUri` 或目标目录的受控临时位置，使用不可预测名称和最小权限。

## 8. 命令安全

### 8.1 不使用 shell 字符串作为默认执行模型

优先使用：

```ts
type CommandSpec = {
  executable: string;
  args: readonly string[];
  cwd: string; // 持久化层使用 URI，执行前由适配器解析
  shell: false;
};
```

只有明确需要 shell 语法时才允许 `shell: true`，并把完整 shell、命令文本和原因展示给用户。

### 8.2 风险分类

| 风险 | 示例 | 默认策略 |
| --- | --- | --- |
| read | `git status`、编译器版本 | 仍需命令审批；可由用户创建严格 remember 规则。 |
| write | formatter、构建、包管理 | 每次审批，展示可能修改文件。 |
| network | 下载依赖、远程测试 | 每次审批并展示网络标记。 |
| dangerous | 删除、重置、提权、设备/注册表修改 | 默认拒绝，不提供“始终允许”。 |

硬拒绝示例：

- `sudo`、`su`、runas/提权。
- 读取 SSH 私钥、系统凭据、浏览器 Cookie。
- 未限定目标的递归删除或磁盘格式化。
- `git reset --hard`、`git clean -fdx` 等破坏性仓库操作，除非未来引入专门且更严格的人工流程；MVP 直接拒绝。
- 编码/混淆后规避策略的命令。

### 8.3 审批卡片

由 Extension Host 生成并显示：

- 可执行文件及完整参数/完整 shell 文本。
- 解析后的工作目录 URI。
- Shell 名称与是否启用 shell 解析。
- 风险等级和触发规则。
- 预计是否写文件、访问网络、启动子进程。
- 发起任务、步骤、工具及理由。
- 单次允许、拒绝；低风险时可选作用域受限的规则。

审批内容 hash 与实际执行 spec 绑定；任一字段变化都使审批失效。

### 8.4 执行控制

- 限制超时、输出字节数、并发子进程和环境变量。
- 默认继承经过过滤的环境变量；删除常见 token/credential 变量，除非工具显式需要并经策略允许。
- stdout/stderr 流式脱敏；完整输出只在内存限长保留。
- 取消时终止进程树；无法确认终止时任务标记为不确定结果，不自动重试。

## 9. 网络与代码外发

### 9.1 网络策略

模式：

- `offline`：禁止所有 Provider 和工具网络访问，本地 Ollama 可按用户设置视为本机网络例外。
- `prompt`：新域名/Provider 首次请求或上下文类别变化时提示。
- `allow-listed`：只允许配置中的明确 HTTPS Origin。
- `deny`：针对某 Provider 或域名禁止。

强制规则：

- 远程 Provider 默认要求 HTTPS；HTTP 只允许 loopback 或用户明确确认的企业内网。
- 跟随重定向前重新检查目标 Origin，禁止把 Authorization 转发到不同 Origin。
- DNS/代理重定向不能绕过逻辑 Origin 审核。
- 设置连接、首字节、总时长和响应体上限。
- 代理凭据按 Secret 处理。

### 9.2 代码外发提示

发送前生成 ContextManifest，至少显示：

- Provider、模型和目标 Origin。
- 文件数量、相对路径、上下文类别、估算 token。
- 是否含 Git Diff、终端、诊断、测试结果。
- 被过滤/截断的项目数。
- 敏感内容过滤结果。

首次使用 Provider、目标 Origin 变化、加入新的高敏感上下文类别时需要重新确认。不得用笼统的“允许 AI”永久授权所有工作区内容。

### 9.3 Prompt injection

- 系统策略、用户任务、工作区数据和工具结果使用明确边界标签。
- 文件中的“忽略规则/执行命令/上传秘密”等文本始终作为数据。
- 模型输出的 URL、命令、路径和工具参数全部重新校验。
- 工具结果只返回完成当前任务所需字段，避免把无关敏感内容带回模型。
- 不允许模型修改安全策略、审批记录或 Provider secret。

## 10. 敏感内容过滤

过滤分两层：

1. 路径级硬阻断：收集前拒绝敏感文件。
2. 内容级检测：外发、日志、工具结果和持久化前检测。

检测器包括：

- 常见 API Key/Token/Authorization/Cookie 模式。
- PEM/SSH 私钥头。
- 高熵长字符串与已配置 secret 的精确匹配。
- `.npmrc`、`.pypirc`、云配置中的凭据键。
- 用户/企业自定义正则。

动作：

- `block`：S3 或高置信秘密，阻止发送并告知来源。
- `redact`：用稳定占位符替换，便于同一 secret 去重。
- `warn`：低置信匹配，用户可排除上下文，但不能显示完整 secret。

过滤器本身不得把命中正文写日志。

## 11. 审计日志与普通日志

### 11.1 审计事件

记录：

- Provider 配置创建/修改/删除（不含秘密）。
- 外发决策的 Provider、Origin、上下文摘要。
- 工具请求、策略结果、审批人动作和执行结果摘要。
- ChangeSet 审批、应用、冲突和回滚。
- 安全策略变更、Workspace Trust 变化、敏感内容阻断。

不记录：

- API Key、Authorization、自定义 Header 值。
- 完整源代码、完整 prompt、完整模型回答。
- 完整终端输出、未脱敏路径外敏感内容。

### 11.2 完整性与保留

- 审计事件具有单调 sequence、时间、任务/请求关联 ID。
- 本地日志采用滚动文件、大小/时长上限。
- 用户可查看和清除日志；清除动作本身只在清除前记录一次。
- 默认不上传。未来若增加遥测，必须独立、显式 opt-in，且不能复用审计正文。

## 12. 本地存储安全

- JSON/JSONL 读取前用 Zod 校验并检查 schemaVersion。
- 写入采用临时文件 + 原子替换或 FileSystemProvider 可用的等效方式。
- 损坏数据隔离，不自动执行其中记录的工具或命令。
- 恢复任务时所有审批默认过期；写入、命令、网络重新评估。
- 会话只保存消息、引用和摘要；源码片段只在未完成 ChangeSet 的有限回滚窗口保存。
- 提供保留策略：会话数量、任务数量、快照空间和审计天数上限。

## 13. 供应链与构建

- pnpm lockfile 必须提交并在 CI 使用 frozen lockfile。
- 依赖更新必须评审脚本、许可证、漏洞和 Webview bundle 变化。
- 尽量禁用不必要的依赖 install scripts。
- Webview 不从 CDN 加载运行时代码。
- VSIX 只包含构建产物、声明、许可证和必要资源；排除测试 fixture、源码密钥样例和本地日志。
- 发布生成 SHA-256；企业分发可增加 VSIX 签名与验证。
- CI 运行类型检查、lint、单元/集成/Extension Host 测试、依赖审计和包内容检查。
- 离线包必须自包含 Webview 资源和运行时依赖，不允许通过 CDN 或首次启动脚本补下载。
- 银河麒麟目标架构若涉及原生二进制，必须验证 ABI、CPU 架构、来源和 hash；MVP 优先避免此类依赖。

## 14. 安全审批矩阵

| 操作 | 自动允许 | 必须审批 | 硬拒绝 |
| --- | --- | --- | --- |
| 工作区内普通文本读取 | 受信、非敏感、范围有限 | 工作区外/边界不确定 | 私钥、凭据、敏感策略命中 |
| 文件搜索 | 同上 | 超大范围或工作区外 | 扫描系统/凭据目录 |
| 生成候选 Diff | 是 | 无 | 直接写盘 |
| create/update 应用 | 否 | Diff 审批 | 无审批或基线冲突 |
| delete/rename | 否 | 单项审批 | 目标不明确 |
| 命令 | 否 | 完整 spec 审批 | 提权/破坏/凭据读取 |
| Provider 网络 | 根据网络策略 | 新 Origin/代码外发 | offline/deny/不安全重定向 |
| 本地 Ollama | 根据 loopback 策略 | 首次或外发类别变化 | offline 且未设本地例外 |
| AI Finding | 可展示为推测 | 自动修复仍走 Diff | 伪装成静态工具结论 |

## 15. 安全测试计划

### 15.1 单元测试

- SecretManager 永不返回给 Webview DTO。
- 敏感 Header 分类和日志脱敏。
- WorkspaceBoundary 的 `..`、大小写、UNC、中文、空格、符号链接/junction。
- 敏感路径与 ignore 的优先级。
- 命令参数注入、shell 元字符、危险命令和审批 hash。
- 重定向 Origin、HTTP/HTTPS、loopback、离线策略。
- Webview Schema 的未知类型、超大 payload、重放和越权 ID。
- 敏感内容检测和不记录命中正文。
- ChangeSet 未审批、冲突、删除和回滚不变量。

### 15.2 集成测试

- SecretStorage 写入/读取/删除。
- 恶意模型工具调用无法越权。
- 文件在审批后、应用前变化时被拒绝。
- 符号链接从工作区逃逸被阻止。
- Authorization 不跨 Origin 重定向。
- 取消命令能终止进程树。
- Webview CSP 下无外部网络和内联脚本。

### 15.3 Extension Host 测试

- 非受信工作区禁用读写/命令能力。
- WorkspaceEdit 保留未保存编辑并支持撤销。
- DiagnosticCollection 不覆盖其他来源。
- Webview 重载后审批和任务所有权仍由 Extension Host 控制。

## 16. 安全发布门禁

MVP 发布前必须满足：

1. SecretStorage、WorkspaceBoundary、Redaction、CommandPolicy 和协议校验测试通过。
2. 没有高危或严重依赖漏洞；例外需书面风险接受。
3. VSIX 内容检查确认不含 `.env`、key、日志、测试秘密或工作区源码。
4. 对网络外发、命令、Diff 和回滚完成手工滥用场景测试。
5. 默认配置为无遥测、受限网络、敏感路径阻断和危险命令拒绝。
6. 在断网的干净目标机完成 VSIX hash 校验、安装、激活、升级/回退和卸载烟测。

## 17. 已知剩余风险

- 用户批准后，合法命令仍可能因依赖脚本产生超出预期的副作用。
- 第三方 Provider 可能保留输入数据；插件只能提示和最小化，不能控制其服务端。
- 非 `file` FileSystemProvider 可能无法提供可证明的符号链接语义，需要更保守审批。
- 本地恶意扩展可访问同一 VS Code 环境中的部分数据，超出本插件隔离能力。
- 高熵/正则检测可能漏报或误报，不能代替路径阻断和用户判断。
