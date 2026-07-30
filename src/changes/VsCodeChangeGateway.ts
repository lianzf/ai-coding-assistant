import * as path from "node:path";
import * as vscode from "vscode";
import type { FileChange } from "../domain/change.js";
import type { ChangeWorkspaceGateway } from "./ChangeManager.js";
import type { WorkspaceService } from "../workspace/WorkspaceService.js";
import type { PermissionGate } from "../domain/permission.js";

class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly values = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.emitter.event;

  public set(id: string, label: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: "ai-coding-assistant-preview",
      path: `/${id}/${encodeURIComponent(label)}`,
    });
    this.values.set(uri.toString(), content);
    this.emitter.fire(uri);
    return uri;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.values.get(uri.toString()) ?? "";
  }

  public dispose(): void {
    this.emitter.dispose();
    this.values.clear();
  }
}

export class VsCodeChangeGateway implements ChangeWorkspaceGateway, vscode.Disposable {
  private readonly previews = new PreviewContentProvider();
  private readonly registration: vscode.Disposable;

  public constructor(
    private readonly workspace: WorkspaceService,
    private readonly permissions: PermissionGate,
  ) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(
      "ai-coding-assistant-preview",
      this.previews,
    );
  }

  public async read(relativePath: string): Promise<string | undefined> {
    const uri = this.workspace.resolveRelativePath(relativePath);
    try {
      return await this.workspace.readText(uri, 2_000_000);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return undefined;
      }
      throw error;
    }
  }

  public async showDiff(change: FileChange): Promise<void> {
    const target = this.workspace.resolveRelativePath(change.path);
    const proposed = this.previews.set(
      change.id,
      `${path.basename(change.path)} (AI 建议)`,
      change.proposedContent,
    );
    const original =
      change.operation === "create"
        ? this.previews.set(`${change.id}-empty`, "新文件（空）", "")
        : target;
    await vscode.commands.executeCommand(
      "vscode.diff",
      original,
      proposed,
      `${change.path} — 审核 AI 修改`,
      { preview: true },
    );
  }

  public async apply(change: FileChange): Promise<void> {
    this.permissions.assertAvailable("modify");
    if (!vscode.workspace.isTrusted) {
      throw new Error("当前工作区未受信任，禁止应用修改。");
    }
    const target = this.workspace.resolveRelativePath(change.path);
    const edit = new vscode.WorkspaceEdit();
    if (change.operation === "create") {
      edit.createFile(target, { ignoreIfExists: false, overwrite: false });
      edit.insert(target, new vscode.Position(0, 0), change.proposedContent);
    } else {
      const document = await vscode.workspace.openTextDocument(target);
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      edit.replace(target, fullRange, change.proposedContent);
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error("VS Code 拒绝了 WorkspaceEdit。");
    }
  }

  public async rollback(change: FileChange): Promise<void> {
    this.permissions.assertAvailable("modify");
    if (!vscode.workspace.isTrusted) {
      throw new Error("当前工作区未受信任，禁止回滚修改。");
    }
    const target = this.workspace.resolveRelativePath(change.path);
    const edit = new vscode.WorkspaceEdit();
    if (change.operation === "create") {
      edit.deleteFile(target, { ignoreIfNotExists: false, recursive: false });
    } else {
      if (change.originalContent === undefined) {
        throw new Error("检查点缺少原始文件内容，无法安全回滚。");
      }
      const document = await vscode.workspace.openTextDocument(target);
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      edit.replace(target, fullRange, change.originalContent);
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error("VS Code 拒绝了检查点回滚操作。");
    }
  }

  public dispose(): void {
    this.registration.dispose();
    this.previews.dispose();
  }
}
