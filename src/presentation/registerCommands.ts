import * as vscode from "vscode";
import type { ChangeManager } from "../changes/ChangeManager.js";
import type { AssistantViewProvider } from "./AssistantViewProvider.js";

export interface CommandDependencies {
  readonly chatView: AssistantViewProvider;
  readonly modelsView: AssistantViewProvider;
  readonly changes: ChangeManager;
}

export function registerCommands(
  context: vscode.ExtensionContext,
  dependencies: CommandDependencies,
): void {
  const focus = async (viewId: string): Promise<void> => {
    await vscode.commands.executeCommand("workbench.view.extension.aiCodingAssistant");
    await vscode.commands.executeCommand(`${viewId}.focus`);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("aiCodingAssistant.openChat", () =>
      focus("aiCodingAssistant.chatView"),
    ),
    vscode.commands.registerCommand("aiCodingAssistant.configureModel", async () => {
      await focus("aiCodingAssistant.modelsView");
    }),
    vscode.commands.registerCommand("aiCodingAssistant.generateTests", async () => {
      await dependencies.chatView.prefill(
        "请为当前选区或当前文件生成单元测试。先识别项目已有测试框架和风格，然后给出测试计划和可审核的测试文件修改。",
        "test",
      );
      await focus("aiCodingAssistant.chatView");
    }),
    vscode.commands.registerCommand("aiCodingAssistant.runTests", async () => {
      await dependencies.chatView.confirmAndRunTests();
    }),
    vscode.commands.registerCommand("aiCodingAssistant.previewPendingChange", async () => {
      const change = dependencies.changes.latestPending();
      if (!change) {
        await vscode.window.showInformationMessage("当前没有待审核修改。");
        return;
      }
      await dependencies.changes.preview(change.id);
    }),
    vscode.commands.registerCommand("aiCodingAssistant.applyPendingChange", async () => {
      const change = dependencies.changes.latestPending();
      if (!change) {
        await vscode.window.showInformationMessage("当前没有待审核修改。");
        return;
      }
      await dependencies.chatView.confirmAndApply(change.id);
    }),
  );
}
