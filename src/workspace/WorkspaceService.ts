import * as vscode from "vscode";
import type {
  BuiltContext,
  ContextAttachment,
  WorkspaceSearchResult,
} from "../domain/workspace.js";
import { isSensitivePath } from "../security/PathPolicy.js";

const defaultExclude = "**/{node_modules,.git,dist,build,out,coverage,.venv,venv,target,vendor}/**";
const textDecoder = new TextDecoder("utf-8", { fatal: false });

export class WorkspaceService {
  public async buildContext(prompt: string, includeActiveEditor: boolean): Promise<BuiltContext> {
    if (includeActiveEditor || /@workspace\b|@file\(|@search\(/.test(prompt)) {
      this.requireTrustedWorkspace();
    }
    const attachments: ContextAttachment[] = [];
    if (includeActiveEditor) {
      const active = this.activeEditorAttachment();
      if (active) {
        attachments.push(active);
      }
    }

    for (const query of this.extractCalls(prompt, "search")) {
      const results = await this.searchText(query, 20);
      attachments.push({
        title: `工作区搜索：${query}`,
        source: "@search",
        content: results
          .map((result) => `${result.relativePath}:${result.line + 1}: ${result.preview}`)
          .join("\n"),
        truncated: results.length >= 20,
      });
    }

    for (const path of this.extractCalls(prompt, "file")) {
      const uri = this.resolveRelativePath(path);
      const content = await this.readText(uri);
      attachments.push({
        title: vscode.workspace.asRelativePath(uri, false),
        source: uri.toString(),
        content,
        truncated: false,
      });
    }

    if (prompt.includes("@workspace")) {
      const files = await vscode.workspace.findFiles("**/*", defaultExclude, 200);
      attachments.push({
        title: "工作区文件结构",
        source: "@workspace",
        content: files
          .filter((uri) => !isSensitivePath(uri.path))
          .map((uri) => vscode.workspace.asRelativePath(uri, false))
          .join("\n"),
        truncated: files.length >= 200,
      });
    }

    const maxCharacters = vscode.workspace
      .getConfiguration("aiCodingAssistant")
      .get<number>("maxContextCharacters", 24_000);
    return this.fitBudget(attachments, maxCharacters);
  }

  public async searchText(query: string, requestedLimit = 100): Promise<WorkspaceSearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      throw new Error("搜索内容至少需要 2 个字符。");
    }
    this.requireTrustedWorkspace();
    const maxFiles = vscode.workspace
      .getConfiguration("aiCodingAssistant")
      .get<number>("maxSearchFiles", 200);
    const files = await vscode.workspace.findFiles("**/*", defaultExclude, maxFiles);
    const needle = trimmed.toLocaleLowerCase();
    const results: WorkspaceSearchResult[] = [];

    for (const uri of files) {
      if (results.length >= requestedLimit || isSensitivePath(uri.path)) {
        continue;
      }
      let content: string;
      try {
        content = await this.readText(uri, 512_000);
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let line = 0; line < lines.length; line += 1) {
        const value = lines[line];
        if (value?.toLocaleLowerCase().includes(needle)) {
          results.push({
            uri: uri.toString(),
            relativePath: vscode.workspace.asRelativePath(uri, false),
            line,
            preview: value.trim().slice(0, 300),
          });
          if (results.length >= requestedLimit) {
            break;
          }
        }
      }
    }
    return results;
  }

  public async readText(uri: vscode.Uri, maxBytes = 1_000_000): Promise<string> {
    this.requireTrustedWorkspace();
    this.assertInsideWorkspace(uri);
    if (isSensitivePath(uri.path)) {
      throw new Error("安全策略禁止读取该敏感文件。");
    }
    const openDocument = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    if (openDocument) {
      return openDocument.getText().slice(0, maxBytes);
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > maxBytes) {
      throw new Error(`文件超过读取上限 ${maxBytes} 字节。`);
    }
    if (bytes.slice(0, 8000).includes(0)) {
      throw new Error("不读取二进制文件。");
    }
    return textDecoder.decode(bytes);
  }

  public resolveRelativePath(input: string): vscode.Uri {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error("请先打开一个工作区。");
    }
    const normalized = input.trim().replaceAll("\\", "/");
    if (normalized.length === 0 || /^(?:[a-zA-Z]:|\/|\\\\)/.test(normalized)) {
      throw new Error("只允许工作区内相对路径。");
    }
    const segments = normalized.split("/").filter(Boolean);
    if (segments.some((segment) => segment === ".." || segment === ".")) {
      throw new Error("路径不能包含 . 或 ..。");
    }
    let folder = folders[0];
    if (folders.length > 1) {
      const matched = folders.find((candidate) => candidate.name === segments[0]);
      if (matched) {
        folder = matched;
        segments.shift();
      }
    }
    if (!folder || segments.length === 0) {
      throw new Error("路径没有指向工作区中的文件。");
    }
    const uri = vscode.Uri.joinPath(folder.uri, ...segments);
    this.assertInsideWorkspace(uri);
    if (isSensitivePath(uri.path)) {
      throw new Error("安全策略禁止访问该敏感路径。");
    }
    return uri;
  }

  public assertInsideWorkspace(uri: vscode.Uri): void {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      throw new Error("路径不在当前工作区内。");
    }
  }

  private activeEditorAttachment(): ContextAttachment | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }
    this.assertInsideWorkspace(editor.document.uri);
    if (isSensitivePath(editor.document.uri.path)) {
      throw new Error("当前文件命中敏感路径策略，不能发送给模型。");
    }
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const content = selectedText.length > 0 ? selectedText : editor.document.getText();
    return {
      title:
        selectedText.length > 0
          ? `当前选区：${editor.document.fileName}`
          : `当前文件：${editor.document.fileName}`,
      source: editor.document.uri.toString(),
      content,
      truncated: false,
    };
  }

  private extractCalls(prompt: string, name: string): string[] {
    const expression = new RegExp(`@${name}\\(([^)]+)\\)`, "g");
    return [...prompt.matchAll(expression)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value));
  }

  private fitBudget(
    attachments: readonly ContextAttachment[],
    maxCharacters: number,
  ): BuiltContext {
    let remaining = Math.max(0, maxCharacters);
    const selected: ContextAttachment[] = [];
    for (const attachment of attachments) {
      if (remaining === 0) {
        break;
      }
      const content = attachment.content.slice(0, remaining);
      selected.push({
        ...attachment,
        content,
        truncated: attachment.truncated || content.length < attachment.content.length,
      });
      remaining -= content.length;
    }
    const text = selected
      .map(
        (item) =>
          `--- ${item.title} (${item.source})${item.truncated ? " [已截断]" : ""} ---\n${item.content}`,
      )
      .join("\n\n");
    return {
      attachments: selected,
      text,
      characterCount: maxCharacters - remaining,
    };
  }

  private requireTrustedWorkspace(): void {
    if (!vscode.workspace.isTrusted) {
      throw new Error("当前工作区未受信任，已禁止读取代码。");
    }
  }
}
