# AI Coding Assistant 离线安装

## 交付物

执行 `pnpm package` 后，`artifacts/` 包含：

- `ai-coding-assistant-<version>.vsix`
- `ai-coding-assistant-<version>.vsix.sha256`
- `ai-coding-assistant-<version>.metadata.json`

VSIX 已包含 React Webview、Extension Host 代码、样式和图标，运行时不访问 CDN，也不在首次启动时下载依赖。

完整安装、模型配置和功能操作说明见 [USER-GUIDE.zh-CN.md](USER-GUIDE.zh-CN.md)。

## 校验

Windows PowerShell：

```powershell
Get-FileHash .\ai-coding-assistant-0.5.0.vsix -Algorithm SHA256
```

银河麒麟/Linux：

```bash
sha256sum ai-coding-assistant-0.5.0.vsix
```

结果必须与 `.sha256` 文件一致。

## 安装与升级

```bash
code --install-extension ./ai-coding-assistant-0.5.0.vsix --force
```

也可以在 VS Code 的 Extensions 视图中选择“从 VSIX 安装”。

升级前保留上一版本 VSIX。需要回退时：

```bash
code --uninstall-extension local-project.ai-coding-assistant
code --install-extension ./ai-coding-assistant-previous.vsix --force
```

升级会自动保留旧版 `default` 模型配置和密钥。卸载扩展不会把 API Key 写到普通文件；各模型密钥由 VS Code SecretStorage 分别管理。

## 银河麒麟兼容说明

- Extension Host 运行代码为 TypeScript/JavaScript 打包产物。
- Webview 为自包含浏览器资源。
- 运行时不依赖本项目提供的原生 Node Addon。
- 文件访问使用 VS Code URI 和 `workspace.fs`。
- 测试命令不假设 Bash，按项目标记选择可执行文件和参数。
- 支持中文和带空格的工作区路径。

正式部署前仍应在目标银河麒麟版本、CPU 架构和所用 VS Code 发行版上执行安装、激活、SecretStorage、Diff、命令和卸载烟测，并记录实际环境。

## 完全离线运行

远程 OpenAI Compatible 服务在完全断网时不可使用。可以配置网络可达的企业内网兼容服务；本插件不会自动寻找或下载模型。

没有模型连接时，插件仍可安装、激活和显示本地 UI，但模型对话、修改生成和测试生成不可用。

也可以在“设置 → 权限与离线模式”中把“模型网络访问”设为“关闭”。此时插件会在模型 Provider 边界阻止外部请求，本地项目概览、会话、Diff 审核等能力仍可使用。
