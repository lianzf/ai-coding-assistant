import { randomBytes, randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { ChatMode } from "../domain/model.js";
import type { FileChange } from "../domain/change.js";
import { inboundMessageSchema, type InboundMessage } from "../protocol/messages.js";
import type { ChatService } from "../chat/ChatService.js";
import type { ChatSessionStore } from "../chat/ChatSessionStore.js";
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
  readonly sessions: ChatSessionStore;
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
  private activeSessionId: string | undefined;
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
      dependencies.configs.onDidChange(() => {
        if (this.view) {
          void this.pushState();
        }
      }),
      dependencies.secrets.onDidChange(() => {
        if (this.view) {
          void this.pushState();
        }
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
        await this.dependencies.secrets.setApiKey(message.apiKey, message.providerId);
        await this.pushState();
        await this.post({ type: "ui/info", message: "API Key 已安全保存。" });
        return;
      case "provider/clear-key":
        await this.dependencies.secrets.deleteApiKey(message.providerId);
        await this.pushState();
        await this.post({ type: "ui/info", message: "API Key 已移除。" });
        return;
      case "provider/test":
        await this.testProvider(message.providerId);
        return;
      case "provider/delete":
        await this.dependencies.configs.remove(message.providerId);
        await this.dependencies.secrets.deleteApiKey(message.providerId);
        await this.pushState();
        await this.post({ type: "ui/info", message: "模型配置及其密钥已删除。" });
        return;
      case "provider/assign":
        await this.dependencies.configs.assign(message.mode, message.providerId);
        await this.pushState();
        await this.post({ type: "ui/info", message: "默认模型分配已更新。" });
        return;
      case "session/new": {
        const session = await this.dependencies.sessions.create();
        this.activeSessionId = session.id;
        await this.postSessionState();
        return;
      }
      case "session/select":
        if (!this.dependencies.sessions.get(message.sessionId)) {
          throw new Error("选择的对话不存在或已经被删除。");
        }
        this.activeSessionId = message.sessionId;
        await this.postSessionState();
        return;
      case "session/delete": {
        const fallback = await this.dependencies.sessions.remove(message.sessionId);
        if (this.activeSessionId === message.sessionId) {
          this.activeSessionId = fallback.id;
        }
        await this.postSessionState();
        return;
      }
      case "session/rename":
        await this.dependencies.sessions.rename(message.sessionId, message.title);
        await this.postSessionState();
        return;
      case "chat/send":
        await this.beginChat(
          message.requestId,
          message.sessionId,
          message.text,
          message.mode,
          message.providerId,
          message.includeActiveEditor,
          message.includeWorkspace,
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
      case "change/rollback":
        await this.confirmAndRollback(message.changeId);
        return;
      case "change/apply-all":
        await this.confirmAndApplyAll();
        return;
      case "change/reject-all":
        await this.confirmAndRejectAll();
        return;
      case "change/rollback-latest":
        await this.confirmAndRollbackLatest();
        return;
      case "test/run":
        await this.confirmAndRunTests();
        return;
      case "project/analyze": {
        await this.post({ type: "project/analyzing" });
        const overview = await this.dependencies.workspace.analyzeProject();
        await this.post({ type: "project/result", overview });
        return;
      }
      case "ui/open-settings":
        await vscode.commands.executeCommand("workbench.view.extension.aiCodingAssistant");
        await vscode.commands.executeCommand("aiCodingAssistant.modelsView.focus");
        return;
    }
  }

  private async saveProvider(input: ProviderSaveMessage): Promise<void> {
    const payload = toProviderSavePayload(input);
    await this.dependencies.configs.save(payload.config, payload.providerId);
    if (payload.apiKey !== undefined) {
      await this.dependencies.secrets.setApiKey(payload.apiKey, payload.providerId);
    }
    await this.pushState();
    await this.post({
      type: "ui/info",
      message:
        payload.apiKey === undefined ? "模型配置已保存。" : "模型配置与 API Key 已安全保存。",
    });
  }

  private async testProvider(providerId: string): Promise<void> {
    const config = await this.dependencies.configs.get(providerId);
    const apiKey = await this.dependencies.secrets.getApiKey(providerId);
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
    sessionId: string,
    text: string,
    mode: ChatMode,
    providerId: string | undefined,
    includeActiveEditor: boolean,
    includeWorkspace: boolean,
  ): Promise<void> {
    if (this.requests.has(requestId)) {
      throw new Error("请求 ID 重复。");
    }
    const session = this.dependencies.sessions.get(sessionId);
    if (!session) {
      throw new Error("当前对话不存在，请新建对话后重试。");
    }
    const history = session.messages.map((message) => ({
      role: message.role,
      content: message.text,
    }));
    const userMessage = await this.dependencies.sessions.appendUser(sessionId, text, mode);
    this.activeSessionId = sessionId;
    const controller = new AbortController();
    this.requests.set(requestId, controller);
    await this.post({
      type: "chat/accepted",
      requestId,
      sessionId,
      userMessage,
      sessions: this.dependencies.sessions.list(),
    });
    try {
      const result = await this.dependencies.chat.send(
        {
          text,
          mode,
          ...(providerId ? { providerId } : {}),
          includeActiveEditor,
          includeWorkspace,
          history,
          signal: controller.signal,
        },
        (event) => {
          switch (event.type) {
            case "text":
              void this.post({ type: "chat/delta", requestId, text: event.text });
              break;
            case "status":
              void this.post({
                type: "chat/status",
                requestId,
                phase: event.phase,
                message: event.message,
              });
              break;
            case "tool-start":
              void this.post({
                type: "chat/tool-start",
                requestId,
                callId: event.callId,
                name: event.name,
                label: event.label,
                input: event.input,
              });
              break;
            case "tool-result":
              void this.post({
                type: "chat/tool-result",
                requestId,
                callId: event.callId,
                ok: event.ok,
                summary: event.summary,
                durationMs: event.durationMs,
              });
              break;
          }
        },
      );
      await this.dependencies.sessions.appendAssistant(sessionId, requestId, result.answer);
      await this.post({
        type: "chat/complete",
        requestId,
        sessionId,
        changeIds: result.changes.map((change) => change.id),
      });
      await this.postSessionState();
    } catch (error) {
      const message = controller.signal.aborted ? "生成已停止。" : this.errorMessage(error);
      await this.dependencies.sessions.appendError(sessionId, requestId, message);
      await this.post({
        type: "chat/error",
        requestId,
        sessionId,
        message,
      });
      await this.postSessionState();
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

  public async confirmAndApplyAll(): Promise<void> {
    const pending = this.dependencies.changes.latestPendingGroup();
    if (pending.length === 0) {
      await this.post({ type: "ui/info", message: "当前没有待审核修改。" });
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      [
        `确认批量应用 ${pending.length} 个 AI 修改？`,
        "请确保已经逐文件检查变更中心中的 Diff。",
        ...pending.slice(0, 12).map((change) => `• ${change.path}`),
        pending.length > 12 ? `• 以及另外 ${pending.length - 12} 个文件` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      { modal: true },
      "全部批准并应用",
    );
    if (choice !== "全部批准并应用") {
      return;
    }
    let applied = 0;
    const failed: string[] = [];
    for (const change of pending) {
      this.dependencies.changes.approve(change.id);
      const result = await this.dependencies.changes.apply(change.id);
      if (result.status === "applied") {
        applied += 1;
      } else {
        failed.push(result.path);
      }
    }
    await this.post({
      type: failed.length === 0 ? "ui/info" : "ui/error",
      message:
        failed.length === 0
          ? `已应用 ${applied} 个修改，并创建可回滚检查点。`
          : `已应用 ${applied} 个修改；${failed.length} 个文件因冲突或错误未应用：${failed.join("、")}`,
    });
  }

  public async confirmAndRejectAll(): Promise<void> {
    const pending = this.dependencies.changes.latestPendingGroup();
    if (pending.length === 0) {
      await this.post({ type: "ui/info", message: "当前没有待审核修改。" });
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `确认拒绝当前任务的 ${pending.length} 个待审核修改？`,
      { modal: true },
      "全部拒绝",
    );
    if (choice !== "全部拒绝") {
      return;
    }
    for (const change of pending) {
      this.dependencies.changes.reject(change.id);
    }
    await this.post({ type: "ui/info", message: `已拒绝 ${pending.length} 个修改。` });
  }

  public async confirmAndRollback(changeId: string): Promise<void> {
    const change = this.dependencies.changes.get(changeId);
    const choice = await vscode.window.showWarningMessage(
      [
        `确认将 ${change.path} 恢复到 AI 修改前的检查点？`,
        "如果文件在应用后又被修改，安全校验会阻止回滚。",
      ].join("\n"),
      { modal: true },
      "确认回滚",
    );
    if (choice !== "确认回滚") {
      return;
    }
    const result = await this.dependencies.changes.rollback(changeId);
    if (result.status !== "rolled-back") {
      throw new Error(result.error ?? "回滚修改失败。");
    }
    await this.post({ type: "ui/info", message: `已恢复 ${result.path}。` });
  }

  public async confirmAndRollbackLatest(): Promise<void> {
    const checkpoint = this.dependencies.changes.latestAppliedGroup();
    if (checkpoint.length === 0) {
      await this.post({ type: "ui/info", message: "当前没有可回滚的任务检查点。" });
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      [
        `确认回滚最近任务检查点中的 ${checkpoint.length} 个文件？`,
        "只有内容仍与 AI 应用结果一致的文件才会恢复，用户后续修改不会被覆盖。",
        ...checkpoint.slice(0, 12).map((change) => `• ${change.path}`),
      ].join("\n"),
      { modal: true },
      "回滚最近检查点",
    );
    if (choice !== "回滚最近检查点") {
      return;
    }
    let restored = 0;
    const blocked: string[] = [];
    for (const change of [...checkpoint].reverse()) {
      const result = await this.dependencies.changes.rollback(change.id);
      if (result.status === "rolled-back") {
        restored += 1;
      } else {
        blocked.push(result.path);
      }
    }
    await this.post({
      type: blocked.length === 0 ? "ui/info" : "ui/error",
      message:
        blocked.length === 0
          ? `已安全回滚 ${restored} 个文件。`
          : `已回滚 ${restored} 个文件；${blocked.length} 个文件因后续内容变化而保留：${blocked.join("、")}`,
    });
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
    const providers = await this.dependencies.configs.list();
    const providerAssignments = this.dependencies.configs.getAssignments();
    const activeSession = await this.resolveActiveSession();
    await this.post({
      type: "state/snapshot",
      viewKind: this.kind,
      ...(providers[0] ? { provider: providers[0] } : {}),
      providers,
      providerAssignments,
      changes: this.changeViews(this.dependencies.changes.list()),
      workspaceTrusted: vscode.workspace.isTrusted,
      sessions: this.dependencies.sessions.list(),
      activeSession,
    });
  }

  private async postSessionState(): Promise<void> {
    const activeSession = await this.resolveActiveSession();
    await this.post({
      type: "sessions/state",
      sessions: this.dependencies.sessions.list(),
      activeSession,
    });
  }

  private async resolveActiveSession() {
    const selected =
      this.activeSessionId === undefined
        ? undefined
        : this.dependencies.sessions.get(this.activeSessionId);
    const session = selected ?? (await this.dependencies.sessions.ensure());
    this.activeSessionId = session.id;
    return session;
  }

  private changeViews(changes: readonly FileChange[]): readonly object[] {
    return changes.map((change) => ({
      id: change.id,
      groupId: change.groupId,
      path: change.path,
      operation: change.operation,
      reason: change.reason ?? "",
      status: change.status,
      addedLines: change.addedLines,
      deletedLines: change.deletedLines,
      rolledBackAt: change.rolledBackAt ?? "",
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
