import * as vscode from "vscode";
import type { TestCommand, TestRunResult } from "../domain/testing.js";
import { detectTestCommand, type TestProjectSnapshot } from "./TestCommandDetector.js";
import { runTestCommand } from "./TestProcessRunner.js";
import type { PermissionGate } from "../domain/permission.js";

export class TestRunner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("AI Coding Assistant Tests");

  public constructor(private readonly permissions: PermissionGate) {}

  public async detect(): Promise<TestCommand> {
    this.permissions.assertAvailable("command");
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error("请先打开一个工作区。");
    }
    if (!vscode.workspace.isTrusted) {
      throw new Error("当前工作区未受信任，禁止运行命令。");
    }
    const files = new Set<string>();
    for (const name of [
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "package.json",
      "pyproject.toml",
      "pytest.ini",
      "setup.cfg",
      "pom.xml",
      "CMakeLists.txt",
    ]) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, name));
        files.add(name);
      } catch {
        // Missing marker files are expected.
      }
    }
    const snapshot: TestProjectSnapshot = {
      rootPath: folder.uri.fsPath,
      files,
      ...(files.has("package.json")
        ? { packageScripts: await this.readPackageScripts(folder.uri) }
        : {}),
    };
    const command = detectTestCommand(snapshot);
    if (!command) {
      throw new Error("未检测到受支持的测试命令。");
    }
    return command;
  }

  public run(command: TestCommand, signal: AbortSignal): Promise<TestRunResult> {
    this.permissions.assertAvailable("command");
    this.output.show(true);
    this.output.appendLine(`> ${command.displayCommand}`);
    this.output.appendLine(`cwd: ${command.cwd}`);
    return runTestCommand(command, signal, (text) => this.output.append(text));
  }

  public dispose(): void {
    this.output.dispose();
  }

  private async readPackageScripts(root: vscode.Uri): Promise<Readonly<Record<string, string>>> {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, "package.json"));
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!this.isRecord(value) || !this.isRecord(value.scripts)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value.scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
