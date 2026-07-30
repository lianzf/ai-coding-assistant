# AI Coding Assistant 安装与使用手册

## 1. 文档说明

本文档适用于 AI Coding Assistant `0.2.x`。

插件标识：

```text
local-project.ai-coding-assistant
```

AI Coding Assistant 是一款本地优先的 VS Code AI 编程插件，主要功能包括：

- 配置用户自备的 OpenAI Compatible 模型；
- 使用 VS Code SecretStorage 保存 API Key；
- 流式 AI 对话；
- 读取当前文件、选区和工作区代码；
- 搜索工作区文本；
- 生成代码修改并使用 VS Code 原生 Diff 审核；
- 只有获得用户批准后才应用修改；
- 生成单元测试；
- 经用户确认后运行项目已有测试命令。

## 2. 系统要求

### 2.1 编辑器要求

- VS Code `1.96.0` 或更高版本；
- 工作区需要处于“受信任”状态，才能读取代码、应用修改或运行测试。

### 2.2 支持的操作系统

- Windows x64；
- Linux x64；
- Linux arm64；
- 银河麒麟桌面操作系统。

插件运行包由 JavaScript、HTML 和 CSS 组成，不依赖插件自带的原生 Node Addon。银河麒麟正式部署前，建议在目标系统版本、CPU 架构和所用 VS Code 发行版上完成一次烟雾测试。

### 2.3 网络要求

安装 VSIX 不需要访问互联网。使用远程模型时，VS Code 所在环境必须能够访问用户配置的模型 Base URL。

完全离线环境可以使用企业内网中的 OpenAI Compatible 服务。插件不会自动下载模型。

## 3. 获取交付物

标准离线交付目录包含：

```text
ai-coding-assistant-0.2.0.vsix
ai-coding-assistant-0.2.0.vsix.sha256
ai-coding-assistant-0.2.0.metadata.json
```

安装前应先验证 VSIX 的 SHA-256。

Windows PowerShell：

```powershell
Get-FileHash .\ai-coding-assistant-0.2.0.vsix -Algorithm SHA256
Get-Content .\ai-coding-assistant-0.2.0.vsix.sha256
```

银河麒麟/Linux：

```bash
sha256sum ai-coding-assistant-0.2.0.vsix
cat ai-coding-assistant-0.2.0.vsix.sha256
```

两个校验值必须一致。

## 4. 安装插件

### 4.1 使用 VS Code 图形界面安装

1. 打开 VS Code。
2. 按 `Ctrl+Shift+X` 打开“扩展”视图。
3. 点击扩展视图右上角的 `...`。
4. 选择“从 VSIX 安装...”。
5. 选择 `ai-coding-assistant-0.2.0.vsix`。
6. 安装完成后执行 **Developer: Reload Window**。

### 4.2 Windows 命令行安装

```powershell
code --install-extension .\ai-coding-assistant-0.2.0.vsix --force
```

检查安装结果：

```powershell
code --list-extensions --show-versions |
  Select-String "local-project.ai-coding-assistant"
```

正常结果示例：

```text
local-project.ai-coding-assistant@0.2.0
```

### 4.3 银河麒麟/Linux 命令行安装

```bash
code --install-extension ./ai-coding-assistant-0.2.0.vsix --force
code --list-extensions --show-versions |
  grep local-project.ai-coding-assistant
```

如果 `code` 命令不在 `PATH` 中，可以在 VS Code 中使用“从 VSIX 安装...”。

### 4.4 升级

保留旧版本 VSIX，然后执行：

```bash
code --install-extension ./ai-coding-assistant-new.vsix --force
```

升级后必须重新加载 VS Code 窗口。

### 4.5 卸载

```bash
code --uninstall-extension local-project.ai-coding-assistant
```

如果需要同时清理已保存的 API Key，请先在“设置”中点击“移除密钥”，再卸载插件。

## 5. 首次启动

1. 打开需要处理的项目文件夹。
2. 如果 VS Code 显示工作区信任提示，请确认该项目可信后再授予信任。
3. 点击 Activity Bar 中的 **AI Coding Assistant** 图标。
4. 使用 **AI 编程**主视图中的“对话、项目、变更”三个入口。
5. 模型配置位于默认折叠的 **设置**视图，也可以点击主视图右上角的模型名称或齿轮。

也可以按 `Ctrl+Shift+P` 打开命令面板，然后运行：

- `AI Coding Assistant：打开对话`
- `AI Coding Assistant：配置模型`

## 6. 配置模型

### 6.1 配置字段

| 字段     | 说明                                         |
| -------- | -------------------------------------------- |
| 配置名称 | 便于识别的名称，例如“企业模型网关”           |
| Base URL | OpenAI Compatible API 基础地址               |
| Model ID | 服务端接受的模型标识                         |
| 请求超时 | 单次请求超时，单位为毫秒                     |
| API Key  | 模型服务密钥，仅保存到 VS Code SecretStorage |

插件使用以下接口：

```text
GET  <Base URL>/models
POST <Base URL>/chat/completions
```

如果 Base URL 已经以 `/chat/completions` 结尾，插件不会重复追加该路径。

### 6.2 DeepSeek 配置示例

使用 DeepSeek 的 OpenAI Compatible 接口时，可以填写：

```text
配置名称：DeepSeek
Base URL：https://api.deepseek.com
Model ID：deepseek-v4-pro
请求超时：120000
```

不要把 Anthropic 格式地址 `https://api.deepseek.com/anthropic` 用于本插件。

### 6.3 保存配置

1. 填写模型配置。
2. 第一次配置时输入 API Key。
3. 点击“保存”。
4. 确认页面显示“密钥状态：已安全配置”。
5. 再点击“测试连接”。
6. 出现“连接成功”后即可开始对话。

保存成功后，API Key 输入框会显示：

```text
已配置；留空表示不修改
```

以后只修改 Base URL 或 Model ID 时，不需要重新输入 API Key。

### 6.4 SecretStorage 说明

- API Key 不写入 `settings.json`；
- API Key 不写入工作区文件；
- API Key 不保存到普通全局状态；
- Webview 只会收到“是否已经配置密钥”的布尔状态；
- 已保存的明文密钥不会从 Extension Host 返回 Webview。

## 7. 使用 AI 对话

### 7.1 三种工作模式

| 模式 | 适用场景                               | 文件修改               |
| ---- | -------------------------------------- | ---------------------- |
| 问答 | 编程问题、代码解释和一般咨询           | 禁止                   |
| 规划 | 分析项目、代码审查、制定方案和评估风险 | 禁止                   |
| 执行 | 按任务生成代码、测试或文档修改         | 只生成待审核 ChangeSet |

“解释代码、分析项目、代码审查、生成单元测试”等常用操作会显示为新对话快捷模板。

### 7.2 发送消息

1. 在输入框上方选择“问答、规划、执行”。
2. 根据需要启用“当前文件/选区”或“项目结构”上下文标签。
3. 输入问题或任务。
4. 按 `Enter` 或点击“发送”；`Shift+Enter` 用于换行。

模型响应会以流式 Markdown 逐步显示。代码块、表格和列表会格式化显示；消息支持复制和再次使用。生成过程中可以点击“停止生成”取消当前请求。

### 7.3 会话管理

对话顶部可以：

- 新建对话；
- 切换当前工作区的历史对话；
- 重命名或删除对话；
- 在重新加载 VS Code 后恢复多轮上下文。

### 7.4 当前文件与选区

勾选“当前文件/选区”后：

- 编辑器存在非空选区时，只发送选区内容；
- 没有选区时，发送当前活动文件内容；
- 敏感路径命中安全策略时，插件会拒绝发送。

## 8. 添加工作区上下文

优先使用输入区的可视化上下文标签：

- “当前文件/选区”附加活动编辑器内容；
- “项目结构”附加经过安全过滤的文件结构；
- “添加上下文”搜索代码并引用具体文件。

高级用户仍可以在消息中使用以下兼容语法。

### 8.1 获取工作区文件结构

```text
@workspace
```

示例：

```text
请结合 @workspace 说明该项目的主要模块。
```

默认最多附带 200 个工作区文件路径。

### 8.2 读取指定文件

```text
@file(src/example.ts)
```

示例：

```text
请解释 @file(src/services/order.ts) 的异常处理逻辑。
```

只允许使用工作区内的相对路径。绝对路径、`.`、`..` 和工作区外路径会被拒绝。

### 8.3 搜索代码

```text
@search(keyword)
```

示例：

```text
请根据 @search(createOrder) 找出订单创建流程。
```

### 8.4 可视化工作区搜索

点击输入区的“添加上下文”后可以直接搜索代码：

1. 输入至少两个字符；
2. 点击“搜索”；
3. 查看文件路径、行号和命中内容；
4. 点击结果，把对应文件引用加入当前任务。

默认排除：

- `node_modules`
- `.git`
- `dist`
- `build`
- `out`
- `coverage`
- 虚拟环境和常见构建目录

### 8.5 项目概览

打开“项目”入口并点击“分析项目”，插件会在本地扫描受信任工作区，生成：

- 文件和测试文件数量；
- 主要语言、技术栈和包管理器；
- 顶层模块、常见入口和配置文件；
- `package.json` 中可用的项目脚本；
- 索引是否达到文件数量上限。

项目概览不会自动发送给远程模型，敏感路径仍会被安全策略过滤。

## 9. 生成与审核代码修改

### 9.1 生成修改

使用“执行”模式描述修改目标。模型可以返回受约束的 ChangeSet，操作类型只允许：

- `create`
- `update`

插件不接受 `delete` 或 `rename`。

### 9.2 查看 Diff

模型返回有效修改后，“变更”入口会显示文件路径、操作类型、状态和原因。

点击“查看 Diff”，插件会打开 VS Code 原生 Diff：

- 左侧为原始内容；
- 右侧为 AI 建议内容。

### 9.3 批准并应用

1. 完整检查 Diff。
2. 点击“审核并应用”。
3. 在 Extension Host 显示的模态确认框中再次确认。
4. 只有明确选择“批准并应用”后，插件才会写入工作区。
5. 检查修改结果并根据需要保存文件。

如果文件在生成建议后被其他操作修改，插件会比较原始内容的 SHA-256，并阻止覆盖。

### 9.4 拒绝修改

点击“拒绝”后，该 ChangeSet 不会应用到工作区。

## 10. 生成单元测试

### 10.1 从编辑器生成

1. 打开需要测试的文件，或者选中部分代码。
2. 右键编辑器。
3. 选择 `AI Coding Assistant：为当前文件或选区生成测试`。
4. 插件会切换到“执行”模式并填充任务说明。
5. 发送任务。
6. 使用 Diff 审核生成的测试文件。
7. 明确批准后再应用。

插件会要求模型优先匹配项目已经使用的测试框架，不会自动引入新的测试框架。

## 11. 运行单元测试

点击“运行测试”或执行命令：

```text
AI Coding Assistant：运行单元测试
```

插件按以下规则检测测试命令：

| 项目标记                                             | 检测命令                                     |
| ---------------------------------------------------- | -------------------------------------------- |
| `pnpm-lock.yaml` 且 `package.json` 有 `scripts.test` | `pnpm test`                                  |
| `yarn.lock` 且 `package.json` 有 `scripts.test`      | `yarn test`                                  |
| 其他 Node 项目且 `package.json` 有 `scripts.test`    | `npm test`                                   |
| `pyproject.toml`、`pytest.ini` 或 `setup.cfg`        | `python -m pytest` / `python3 -m pytest`     |
| `pom.xml`                                            | `mvn test`                                   |
| `CMakeLists.txt`                                     | `ctest --test-dir build --output-on-failure` |

运行前会显示：

- 完整命令；
- 工作目录；
- 执行方式。

只有在模态确认框中同意后才会启动进程。测试输出显示在 **AI Coding Assistant Tests** 输出通道，并同步显示在插件页面。

如果提示“未检测到受支持的测试命令”：

1. 确认 VS Code 打开的是项目根目录；
2. Node 项目确认 `package.json` 中存在 `scripts.test`；
3. 多根工作区确认目标项目位于第一个工作区文件夹；
4. 如果项目没有测试框架，请先由项目维护者确定测试方案。

## 12. 命令面板

按 `Ctrl+Shift+P` 后可以运行：

| 命令                                          | 用途                      |
| --------------------------------------------- | ------------------------- |
| AI Coding Assistant：打开对话                 | 打开聊天视图              |
| AI Coding Assistant：配置模型                 | 打开设置视图              |
| AI Coding Assistant：为当前文件或选区生成测试 | 生成测试任务              |
| AI Coding Assistant：运行单元测试             | 检测并运行测试            |
| AI Coding Assistant：预览待审核修改           | 打开最近待审核修改的 Diff |
| AI Coding Assistant：批准并应用待审核修改     | 进入批准流程              |

## 13. 可配置设置

打开 VS Code 设置，搜索 `AI Coding Assistant`。

| 设置项                                   |  默认值 | 说明                       |
| ---------------------------------------- | ------: | -------------------------- |
| `aiCodingAssistant.includeActiveEditor`  |  `true` | 默认附带当前文件或选区     |
| `aiCodingAssistant.maxContextCharacters` | `24000` | 单次请求的上下文字符上限   |
| `aiCodingAssistant.maxSearchFiles`       |   `200` | 工作区搜索最多检查的文件数 |
| `aiCodingAssistant.maxIndexFiles`        |  `4000` | 项目概览最多索引的文件数   |

## 14. 安全策略

### 14.1 工作区信任

工作区未受信任时，插件禁止：

- 读取工作区代码；
- 搜索工作区；
- 应用代码修改；
- 运行测试命令。

### 14.2 敏感文件

插件默认阻止读取：

- `.env` 和 `.env.*`
- `.ssh` 目录
- `id_rsa`
- `id_ed25519`
- `credentials`
- `secrets`
- `.key`
- `.pem`
- `.p12`
- `.pfx`

### 14.3 修改权限

- 模型不能直接写文件；
- 所有模型修改先保存为待审核 ChangeSet；
- 必须先查看 Diff；
- 必须经过用户模态确认；
- 未批准修改不能调用应用流程；
- 不支持删除用户文件。

### 14.4 命令权限

插件不接受模型提供的任意终端命令，只运行内部检测出的固定测试命令。执行前必须获得用户确认。

## 15. 常见问题

### 15.1 提示“请先保存 OpenAI Compatible 配置”

打开“设置”，填写配置名称、Base URL、Model ID 和超时，点击“保存配置”。

### 15.2 API Key 已保存，但状态显示未配置

1. 执行 **Developer: Reload Window**；
2. 重新点击一次“保存”；
3. API Key 已存在时可以留空；
4. 确认状态变为“已安全配置”。

### 15.3 测试连接失败

检查：

- Base URL 是否可访问；
- 是否错误使用了 Anthropic 专用路径；
- API Key 是否正确；
- 企业代理、防火墙或证书策略是否允许访问；
- 模型服务是否实现 `GET /models`。

### 15.4 HTTP 401

认证失败。检查 API Key 是否正确、是否失效或是否属于当前服务地址。

### 15.5 HTTP 402 / Insufficient Balance

模型账户余额不足。连接测试可能成功，但正式对话请求仍会因为计费余额不足而失败。请充值或换用有余额的 API Key。

### 15.6 HTTP 404

通常表示 Base URL 路径错误。插件会调用：

```text
<Base URL>/models
<Base URL>/chat/completions
```

不要把已经属于其他协议的路径当作 OpenAI Compatible Base URL。

### 15.7 HTTP 429

请求速率达到服务商限制。降低请求频率，等待后重试。

### 15.8 工作区搜索没有结果

- 搜索词至少需要两个字符；
- 检查目标文件是否位于排除目录；
- 检查工作区是否受信任；
- 增大 `aiCodingAssistant.maxSearchFiles` 后重试。

### 15.9 未检测到测试命令

确认项目根目录和测试标记文件正确，并为 Node 项目配置 `package.json` 的 `scripts.test`。

### 15.10 安装后没有出现图标

1. 确认扩展已安装：

   ```bash
   code --list-extensions --show-versions
   ```

2. 执行 **Developer: Reload Window**；
3. 检查扩展是否被禁用；
4. 确认 VS Code 版本不低于 1.96。

### 15.11 完全断网时能否使用

插件 UI、工作区搜索和本地审核能力可以加载，但远程模型对话、代码生成和测试生成不可用。可以改用企业内网 OpenAI Compatible 服务。

## 16. 日常使用建议

1. 对陌生项目先使用“解释”或“审查”模式。
2. 只附带完成任务所需的上下文。
3. 处理大项目时优先使用 `@file(...)` 和 `@search(...)`。
4. 任何修改都先检查 Diff。
5. 应用修改后运行格式化、静态检查和单元测试。
6. 不要把密钥、证书或生产环境凭据写入聊天内容。
7. 定期保留已验证的 VSIX 和 SHA-256 文件，便于回退。

## 17. 安装验收清单

安装完成后建议逐项确认：

- [ ] 扩展 ID 和版本正确；
- [ ] AI Coding Assistant 图标正常显示；
- [ ] 工作区信任状态正确；
- [ ] 模型配置可以保存；
- [ ] 密钥状态显示“已安全配置”；
- [ ] 测试连接成功；
- [ ] 流式对话可以正常返回；
- [ ] 当前文件/选区可以作为上下文；
- [ ] 工作区搜索可以返回结果；
- [ ] AI 修改可以打开原生 Diff；
- [ ] 拒绝修改时不会写入文件；
- [ ] 批准修改后可以应用；
- [ ] 测试命令运行前会要求确认；
- [ ] 离线环境下插件可以正常安装和激活。

## 18. 技术支持所需信息

反馈问题时，请提供：

- 操作系统及版本；
- CPU 架构；
- VS Code 版本；
- 插件版本；
- 模型服务类型；
- Base URL 的域名和路径结构，隐藏敏感参数；
- HTTP 状态码和错误消息；
- 是否为多根工作区；
- 是否处于工作区受信任状态；
- 复现步骤。

请勿发送 API Key、`.env` 内容、私钥或其他凭据。
