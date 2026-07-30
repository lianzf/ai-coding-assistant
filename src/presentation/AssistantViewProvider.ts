import { randomBytes, randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { ChatMode } from "../domain/model.js";
import type { FileChange } from "../domain/change.js";
import { inboundMessageSchema, type InboundMessage } from "../protocol/messages.js";
import type { ChatService } from "../chat/ChatService.js";
import type { ChangeManager } from "../changes/ChangeManager.js";
import type { OpenAICompatibleProvider } from "../providers/OpenAICompatibleProvider.js";
import type { ProviderConfigStore } from "../providers/ProviderConfigStore.js";
import type { SecretManager } from "../security/SecretManager.js";
import type { TestRunner } from "../testing/TestRunner.js";
import type { WorkspaceService } from "../workspace/WorkspaceService.js";
import { toProviderSavePayload, type ProviderSaveMessage } from "./providerSavePayload.js";

export type ViewKind = "chat" | "models";

export interface AssistantViewDependencies {
  readonly extensionUri: vscode.Uri;
  readonly chat: ChatService;
  readonly configs: ProviderConfigStore;
  readonly secrets: SecretManager;
  readonly provider: OpenAICompatibleProvider;
  readonly workspace: WorkspaceService;
  readonly changes: ChangeManager;
  readonly tests: TestRunner;
}

export class AssistantViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private pendingPrefill: { readonly text: string; readonly mode: ChatMode } | undefined;
  private readonly requests = new Map<string, AbortController>();
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly kind: ViewKind,
    private readonly dependencies: AssistantViewDependencies,
  ) {
    this.disposables.push(
      dependencies.changes.onDidChange((changes) => {
        void this.post({ type: "changes/state", changes: this.changeViews(changes) });
      }),
    );
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const webviewRoot = vscode.Uri.joinPath(this.dependencies.extensionUri, "dist", "webview");
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((value: unknown) => {
        void this.receive(value);
      }),
      webviewView.onDidDispose(() => {
        this.view = undefined;
        for (const controller of this.requests.values()) {
          controller.abort();
        }
        this.requests.clear();
      }),
    );
  }

  public async prefill(text: string, mode: ChatMode): Promise<void> {
    this.pendingPrefill = { text, mode };
    if (this.view) {
      await this.post({ type: "chat/prefill", text, mode });
      this.pendingPrefill = undefined;
    }
  }

  public dispose(): void {
    for (const request of this.requests.values()) {
      request.abort();
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async receive(value: unknown): Promise<void> {
    const parsed = inboundMessageSchema.safeParse(value);
    if (!parsed.success) {
      await this.post({
        type: "ui/error",
        message: "Webview 消息格式无效，操作已拒绝。",
      });
      return;
    }
    try {
      await this.handle(parsed.data);
    } catch (error) {
      await this.post({
        type: "ui/error",
        message: this.errorMessage(error),
      });
    }
  }

  private async handle(message: InboundMessage): Promise<void> {
    switch (message.type) {
      case "view/ready":
        await this.pushState();
        if (this.pendingPrefill && this.kind === "chat") {
          await this.post({
            type: "chat/prefill",
            text: this.pendingPrefill.text,
            mode: this.pendingPrefill.mode,
          });
          this.pendingPrefill = undefined;
        }
        return;
      case "provider/save":
        await this.saveProvider(message);
        return;
      case "provider/set-key":
        await this.dependencies.secrets.setApiKey(message.apiKey);
        await this.pushState();
        await this.post({ type: "ui/info", message: "API Key 已安全保存。" });
        return;
      case "provider/clear-key":
        await this.dependencies.secrets.deleteApiKey();
        await this.pushState();
        await this.post({ type: "ui/info", message: "API Key 已移除。" });
        return;
      case "provider/test":
        await this.testProvider();
        return;
      case "chat/send":
        await this.beginChat(
          message.requestId,
          message.text,
          message.mode,
          message.includeActiveEditor,
        );
        return;
      case "chat/cancel":
        this.requests.get(message.requestId)?.abort();
        return;
      case "workspace/search":
        await this.search(message.query);
        return;
      case "change/preview":
        await this.dependencies.changes.preview(message.changeId);
        return;
      case "change/apply":
        await this.confirmAndApply(message.changeId);
        return;
      case "change/reject":
        this.dependencies.changes.reject(message.changeId);
        await this.post({ type: "ui/info", message: "已拒绝该修改。" });
        return;
      case "test/run":
        await this.confirmAndRunTests();
        return;
    }
  }

  private async saveProvider(input: ProviderSaveMessage): Promise<void> {
    const payload = toProviderSavePayload(input);
    await this.dependencies.configs.save(payload.config);
    if (payload.apiKey !== undefined) {
      await this.dependencies.secrets.setApiKey(payload.apiKey);
    }
    await this.pushState();
    await this.post({
      type: "ui/info",
      message:
        payload.apiKey === undefined ? "模型配置已保存。" : "模型配置与 API Key 已安全保存。",
    });
  }

  private async testProvider(): Promise<void> {
    const config = await this.dependencies.configs.get();
    const apiKey = await this.dependencies.secrets.getApiKey();
    if (!config || !apiKey) {
      throw new Error("请先保存模型配置和 API Key。");
    }
    const controller = new AbortController();
    const result = await this.dependencies.provider.testConnection(
      config,
      apiKey,
      controller.signal,
    );
    await this.post({ type: "provider/test-result", result });
  }

  private async beginChat(
    requestId: string,
    text: string,
    mode: ChatMode,
    includeActiveEditor: boolean,
  ): Promise<void> {
    if (this.requests.has(requestId)) {
      throw new Error("请求 ID 重复。");
    }
    const controller = new AbortController();
    this.requests.set(requestId, controller);
    await this.post({ type: "chat/accepted", requestId, text, mode });
    try {
      const result = await this.dependencies.chat.send(
        {
          text,
          mode,
          includeActiveEditor,
          signal: controller.signal,
        },
        (event) => {
          if (event.type === "text") {
            void this.post({ type: "chat/delta", requestId, text: event.text });
          }
        },
      );
      await this.post({
        type: "chat/complete",
        requestId,
        changeIds: result.changes.map((change) => change.id),
      });
    } catch (error) {
      await this.post({
        type: "chat/error",
        requestId,
        message: controller.signal.aborted ? "生成已停止。" : this.errorMessage(error),
      });
    } finally {
      this.requests.delete(requestId);
    }
  }

  private async search(query: string): Promise<void> {
    const results = await this.dependencies.workspace.searchText(query);
    await this.post({ type: "workspace/search-results", query, results });
  }

  public async confirmAndApply(changeId: string): Promise<void> {
    const change = this.dependencies.changes.get(changeId);
    await this.dependencies.changes.preview(changeId);
    const choice = await vscode.window.showWarningMessage(
      [`确认应用 AI 建议到 ${change.path}？`, "该操作会修改工作区。请先检查已经打开的 Diff。"].join(
        "\n",
      ),
      { modal: true },
      "批准并应用",
    );
    if (choice !== "批准并应用") {
      return;
    }
    this.dependencies.changes.approve(changeId);
    const result = await this.dependencies.changes.apply(changeId);
    if (result.status === "applied") {
      await vscode.window.showInformationMessage(
        `已应用 ${result.path}；可使用 VS Code 撤销或保存。`,
      );
    } else {
      throw new Error(result.error ?? "应用修改失败。");
    }
  }

  public async confirmAndRunTests(): Promise<void> {
    const command = await this.dependencies.tests.detect();
    const choice = await vscode.window.showWarningMessage(
      [
        "确认运行单元测试？",
        `命令：${command.displayCommand}`,
        `工作目录：${command.cwd}`,
        process.platform === "win32" && command.executable.endsWith(".cmd")
          ? "执行方式：受限 Windows 命令处理器（仅固定检测参数）"
          : "执行方式：直接进程（不启用 Shell）",
      ].join("\n"),
      { modal: true },
      "运行测试",
    );
    if (choice !== "运行测试") {
      return;
    }
    const controller = new AbortController();
    await this.post({ type: "test/started", command: command.displayCommand });
    const result = await this.dependencies.tests.run(command, controller.signal);
    await this.post({ type: "test/result", result });
    if (result.exitCode === 0) {
      await vscode.window.showInformationMessage("单元测试执行成功。");
    } else {
      await vscode.window.showErrorMessage(`单元测试失败，退出码：${result.exitCode ?? "未知"}`);
    }
  }

  private async pushState(): Promise<void> {
    const provider = await this.dependencies.configs.get();
    await this.post({
      type: "state/snapshot",
      viewKind: this.kind,
      ...(provider ? { provider } : {}),
      changes: this.changeViews(this.dependencies.changes.list()),
      workspaceTrusted: vscode.workspace.isTrusted,
    });
  }

  private changeViews(changes: readonly FileChange[]): readonly object[] {
    return changes.map((change) => ({
      id: change.id,
      path: change.path,
      operation: change.operation,
      reason: change.reason ?? "",
      status: change.status,
      error: change.error ?? "",
    }));
  }

  private post(message: unknown): Thenable<boolean> | Promise<boolean> {
    if (!this.view) {
      return Promise.resolve(false);
    }
    return this.view.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("base64");
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.dependencies.extensionUri,
        "dist",
        "webview",
        "assets",
        "webview.js",
      ),
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.dependencies.extensionUri,
        "dist",
        "webview",
        "assets",
        "webview.css",
      ),
    );
    const sessionId = randomUUID();
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none';">
  <link rel="stylesheet" href="${style.toString()}">
  <title>AI Coding Assistant</title>
</head>
<body data-view-kind="${this.kind}" data-session-id="${sessionId}">
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${script.toString()}"></script>
</body>
</html>`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
