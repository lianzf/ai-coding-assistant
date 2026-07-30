import * as vscode from "vscode";
import { ChatService } from "../chat/ChatService.js";
import { ChangeManager } from "../changes/ChangeManager.js";
import { VsCodeChangeGateway } from "../changes/VsCodeChangeGateway.js";
import { AssistantViewProvider } from "../presentation/AssistantViewProvider.js";
import { registerCommands } from "../presentation/registerCommands.js";
import { OpenAICompatibleProvider } from "../providers/OpenAICompatibleProvider.js";
import { ProviderConfigStore } from "../providers/ProviderConfigStore.js";
import { SecretManager } from "../security/SecretManager.js";
import { TestRunner } from "../testing/TestRunner.js";
import { WorkspaceService } from "../workspace/WorkspaceService.js";

export function activateExtension(context: vscode.ExtensionContext): void {
  const secrets = new SecretManager(context.secrets);
  const configs = new ProviderConfigStore(context.globalState, () => secrets.hasApiKey());
  const provider = new OpenAICompatibleProvider();
  const workspace = new WorkspaceService();
  const changeGateway = new VsCodeChangeGateway(workspace);
  const changes = new ChangeManager(changeGateway);
  const tests = new TestRunner();
  const chat = new ChatService(configs, secrets, provider, workspace, changes);
  const shared = {
    extensionUri: context.extensionUri,
    chat,
    configs,
    secrets,
    provider,
    workspace,
    changes,
    tests,
  };
  const chatView = new AssistantViewProvider("chat", shared);
  const modelsView = new AssistantViewProvider("models", shared);

  context.subscriptions.push(
    changeGateway,
    tests,
    chatView,
    modelsView,
    vscode.window.registerWebviewViewProvider("aiCodingAssistant.chatView", chatView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider("aiCodingAssistant.modelsView", modelsView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  registerCommands(context, { chatView, modelsView, changes });
}
