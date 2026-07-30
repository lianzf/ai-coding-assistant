# AI Coding Assistant

AI Coding Assistant 是一个本地优先的 VS Code AI 编程插件 MVP。它支持用户自备 OpenAI Compatible 模型、流式对话、工作区代码读取与搜索、代码/测试修改的原生 Diff 审核，以及审批后的测试执行。

## 安全边界

- API Key 只保存到 `ExtensionContext.secrets`（VS Code SecretStorage）。
- Webview 只收到 `hasApiKey`，插件不会把已保存的密钥传回 Webview。
- `.env`、私钥、证书和凭据路径默认禁止读取。
- 工作区未受信任时禁止读取代码、应用修改和运行测试。
- 模型只能提出 `create`/`update` 候选修改，不能删除用户文件。
- 修改必须先打开 VS Code Diff，并在模态确认框中批准后才可应用。
- 应用前重新校验原始内容 SHA-256；文件已变化时拒绝覆盖。
- 测试命令会显示完整命令、工作目录和执行方式并要求确认；Linux/银河麒麟直接以参数数组启动进程，Windows 的 `.cmd` 启动器通过仅接受固定检测参数的受限命令处理器执行。

## 安装

要求 VS Code 1.96 或更高版本。

```powershell
code --install-extension .\artifacts\ai-coding-assistant-0.1.0.vsix
```

离线和银河麒麟说明见 [OFFLINE-INSTALL.zh-CN.md](OFFLINE-INSTALL.zh-CN.md)。

完整安装与使用说明见 [USER-GUIDE.zh-CN.md](USER-GUIDE.zh-CN.md)。

## 配置模型

1. 打开 Activity Bar 中的 **AI Coding Assistant**。
2. 展开 **模型配置**。
3. 输入 Base URL，例如 `https://gateway.example.com/v1`。
4. 输入模型 ID 和 API Key。
5. 点击“保存”，再点击“测试连接”。

插件调用：

- `GET <baseUrl>/models` 测试连接。
- `POST <baseUrl>/chat/completions` 进行流式对话。

服务返回非 SSE JSON 时也支持普通 Chat Completions 响应。

## 对话与工作区上下文

聊天支持 Ask、Explain、Edit、Agent、Review、Test、Document 模式。

- 勾选“当前文件/选区”附带活动编辑器内容。
- `@workspace` 添加最多 200 个工作区文件路径。
- `@file(src/example.ts)` 添加指定工作区文件。
- `@search(keyword)` 添加工作区文本搜索结果。

侧边栏的“工作区搜索”也可以独立查询代码。默认排除 `node_modules`、`.git`、`dist`、`build`、`out` 和 `coverage`。

## 代码修改与 Diff

Edit、Agent、Test 模式允许模型返回：

````text
```ai-change-set
{
  "changes": [
    {
      "path": "src/example.ts",
      "operation": "update",
      "content": "完整的新文件内容",
      "reason": "修改原因"
    }
  ]
}
```
````

插件只把它保存为待审核建议：

1. 点击“查看 Diff”。
2. 检查 VS Code 原生 Diff。
3. 点击“审核并应用”。
4. 在 Extension Host 创建的模态确认框中再次批准。

没有批准、路径不在工作区或原文件已变化时均禁止写入。

## 生成和运行单元测试

- 使用编辑器菜单或命令面板执行“为当前文件或选区生成测试”。
- 插件以 Test 模式请求模型，并要求匹配项目现有框架。
- 测试文件仍以 ChangeSet 形式经过 Diff 审核。
- “运行单元测试”会探测 `pnpm/npm/yarn test`、pytest、Maven 或 CTest。
- 运行前显示完整命令、工作目录和执行方式，用户拒绝则不会启动进程。

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

构建不从 CDN 加载任何 Webview 资源。VSIX 包含 Extension Host bundle、React Webview bundle、样式和图标。

## 项目结构

```text
src/
  chat/          对话用例
  changes/       ChangeSet 解析、审批状态和 VS Code Diff
  domain/        纯领域类型
  extension/     Composition Root
  presentation/  WebviewViewProvider 与命令
  protocol/      Zod 消息协议
  providers/     OpenAI Compatible Provider
  security/      SecretStorage 和路径策略
  testing/       测试探测和受控执行
  workspace/     URI-first 读取、上下文和搜索
webview/src/     React + Zustand UI
tests/           单元、集成和 Extension Host 测试
```

更完整的架构、安全和路线设计位于 `docs/`。
