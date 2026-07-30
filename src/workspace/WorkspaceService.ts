import * as vscode from "vscode";
import type {
  BuiltContext,
  ContextAttachment,
  WorkspaceSearchResult,
} from "../domain/workspace.js";
import type { ProjectOverview } from "../domain/project.js";
import type { ChangeSpec } from "../domain/change.js";
import type { PermissionGate } from "../domain/permission.js";
import { isSensitivePath } from "../security/PathPolicy.js";
import { sanitizeGitDiff } from "../security/ContentRedactor.js";
import type { ProjectOverviewCache } from "./ProjectOverviewCache.js";
import { insertTextRange } from "./EditorInsertion.js";
import {
  analyzeModuleDependencies,
  isModuleAnalysisFile,
  type ModuleSourceFile,
} from "./ModuleDependencyAnalyzer.js";

interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

interface GitApi {
  readonly repositories: readonly GitRepository[];
}

interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly HEAD?: {
      readonly name?: string;
      readonly commit?: string;
    };
    readonly workingTreeChanges: readonly GitChange[];
    readonly indexChanges: readonly GitChange[];
    readonly untrackedChanges: readonly GitChange[];
    readonly mergeChanges: readonly GitChange[];
  };
  diff(cached?: boolean): Promise<string>;
}

interface GitChange {
  readonly uri: vscode.Uri;
}

const defaultExclude = "**/{node_modules,.git,dist,build,out,coverage,.venv,venv,target,vendor}/**";
const textDecoder = new TextDecoder("utf-8", { fatal: false });
const languageNames: Readonly<Record<string, string>> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript React",
  ".js": "JavaScript",
  ".jsx": "JavaScript React",
  ".vue": "Vue",
  ".py": "Python",
  ".java": "Java",
  ".kt": "Kotlin",
  ".go": "Go",
  ".rs": "Rust",
  ".cs": "C#",
  ".cpp": "C++",
  ".c": "C",
  ".php": "PHP",
  ".rb": "Ruby",
  ".swift": "Swift",
  ".dart": "Dart",
  ".sql": "SQL",
  ".md": "Markdown",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
};
const technologyDependencies: Readonly<Record<string, string>> = {
  react: "React",
  vue: "Vue",
  "@angular/core": "Angular",
  next: "Next.js",
  nuxt: "Nuxt",
  vite: "Vite",
  express: "Express",
  fastify: "Fastify",
  "@nestjs/core": "NestJS",
  electron: "Electron",
  typescript: "TypeScript",
  vitest: "Vitest",
  jest: "Jest",
  mocha: "Mocha",
  playwright: "Playwright",
  cypress: "Cypress",
};

export class WorkspaceService implements vscode.Disposable {
  private readonly watcher = vscode.workspace.createFileSystemWatcher("**/*");
  private readonly watcherSubscriptions: vscode.Disposable[];
  private dirty = false;

  public constructor(
    private readonly permissions: PermissionGate,
    private readonly cache: ProjectOverviewCache,
  ) {
    const invalidate = (uri: vscode.Uri): void => {
      if (!this.isIgnoredPath(uri.path)) {
        this.dirty = true;
      }
    };
    this.watcherSubscriptions = [
      this.watcher.onDidCreate(invalidate),
      this.watcher.onDidChange(invalidate),
      this.watcher.onDidDelete(invalidate),
    ];
  }

  public dispose(): void {
    this.watcher.dispose();
    for (const subscription of this.watcherSubscriptions) {
      subscription.dispose();
    }
  }

  public async listFiles(requestedLimit = 500): Promise<readonly string[]> {
    this.requireTrustedWorkspace();
    const limit = Math.min(Math.max(requestedLimit, 1), 1_000);
    const files = await vscode.workspace.findFiles("**/*", defaultExclude, limit);
    return files
      .filter((uri) => !isSensitivePath(uri.path))
      .map((uri) => vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/"))
      .sort();
  }

  public cachedProjectOverview(): ProjectOverview | undefined {
    if (this.dirty || !vscode.workspace.isTrusted || this.permissions.get().read === "deny") {
      return undefined;
    }
    const rootKey = this.rootKey();
    return rootKey ? this.cache.get(rootKey) : undefined;
  }

  public async analyzeProject(force = false): Promise<ProjectOverview> {
    this.requireTrustedWorkspace();
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error("请先在 VS Code 中打开一个项目或工作区。");
    }
    const rootKey = this.rootKey();
    if (!force && !this.dirty && rootKey) {
      const cached = this.cache.get(rootKey);
      if (cached) {
        return cached;
      }
    }

    const maximumFiles = vscode.workspace
      .getConfiguration("aiCodingAssistant")
      .get<number>("maxIndexFiles", 4_000);
    const discovered = await vscode.workspace.findFiles("**/*", defaultExclude, maximumFiles);
    const files = discovered.filter((uri) => !isSensitivePath(uri.path));
    const languageCounts = new Map<string, number>();
    const modules = new Set<string>();
    const entryFiles: string[] = [];
    const configurationFiles: string[] = [];
    const packageManagers = new Set<string>();
    const technologies = new Set<string>();
    const dependencies = new Set<string>();
    const devDependencies = new Set<string>();
    const scripts: Record<string, string> = {};
    let testFileCount = 0;

    for (const uri of files) {
      const relativePath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
      const extension = this.extension(relativePath);
      const language = languageNames[extension];
      if (language) {
        languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
      }

      const segments = relativePath.split("/");
      if (segments.length > 1 && segments[0]) {
        modules.add(segments[0]);
      }
      const fileName = segments.at(-1)?.toLocaleLowerCase() ?? "";
      if (/(?:^|[._-])(?:test|spec)\.[^.]+$/i.test(fileName) || /\/tests?\//i.test(relativePath)) {
        testFileCount += 1;
      }
      if (
        /^(?:src\/)?(?:index|main|app|server|extension)\.(?:ts|tsx|js|jsx|py|java|go|rs)$/i.test(
          relativePath,
        )
      ) {
        entryFiles.push(relativePath);
      }
      if (
        /^(?:package\.json|tsconfig(?:\.[^.]+)?\.json|vite\.config\.|webpack\.config\.|vue\.config\.|next\.config\.|pyproject\.toml|requirements\.txt|pom\.xml|build\.gradle|go\.mod|cargo\.toml|dockerfile|docker-compose|\.github\/workflows)/i.test(
          relativePath,
        )
      ) {
        configurationFiles.push(relativePath);
      }
      this.detectPackageManager(fileName, packageManagers);
    }

    for (const folder of folders) {
      const packageUri = vscode.Uri.joinPath(folder.uri, "package.json");
      try {
        const parsed = JSON.parse(await this.readText(packageUri, 1_000_000)) as unknown;
        if (!this.isRecord(parsed)) {
          continue;
        }
        const packageScripts = this.isRecord(parsed.scripts) ? parsed.scripts : {};
        for (const [name, command] of Object.entries(packageScripts)) {
          if (typeof command === "string") {
            scripts[folders.length > 1 ? `${folder.name}:${name}` : name] = command;
          }
        }
        const runtimeDependencies = this.isRecord(parsed.dependencies) ? parsed.dependencies : {};
        const developmentDependencies = this.isRecord(parsed.devDependencies)
          ? parsed.devDependencies
          : {};
        for (const dependency of Object.keys(runtimeDependencies)) {
          dependencies.add(dependency);
        }
        for (const dependency of Object.keys(developmentDependencies)) {
          devDependencies.add(dependency);
        }
        for (const dependency of Object.keys({
          ...runtimeDependencies,
          ...developmentDependencies,
        })) {
          const technology = technologyDependencies[dependency];
          if (technology) {
            technologies.add(technology);
          }
        }
      } catch {
        // A missing or malformed package.json is reported through the structural overview instead.
      }
    }

    for (const language of languageCounts.keys()) {
      if (language !== "JSON" && language !== "Markdown" && language !== "YAML") {
        technologies.add(language);
      }
    }

    const truncated = discovered.length >= maximumFiles;
    const moduleCandidates = files
      .map((uri) => ({
        uri,
        path: vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/"),
      }))
      .filter((file) => isModuleAnalysisFile(file.path))
      .sort((left, right) => {
        const leftManifest = left.path.endsWith("package.json") ? 0 : 1;
        const rightManifest = right.path.endsWith("package.json") ? 0 : 1;
        return leftManifest - rightManifest || left.path.localeCompare(right.path);
      });
    const moduleSources: ModuleSourceFile[] = [];
    const maximumModuleFiles = 400;
    const maximumModuleCharacters = 8_000_000;
    let moduleCharacters = 0;
    for (const candidate of moduleCandidates.slice(0, maximumModuleFiles)) {
      try {
        const content = await this.readText(candidate.uri, 256_000);
        if (moduleCharacters + content.length > maximumModuleCharacters) {
          break;
        }
        moduleSources.push({ path: candidate.path, content });
        moduleCharacters += content.length;
      } catch {
        // Binary, oversized and unreadable files are counted as skipped below.
      }
    }
    const moduleDependencies = analyzeModuleDependencies(moduleSources).dependencies;
    const moduleAnalysis = {
      analyzedFiles: moduleSources.length,
      skippedFiles: Math.max(0, moduleCandidates.length - moduleSources.length),
      truncated:
        truncated ||
        moduleSources.length < moduleCandidates.length ||
        moduleCharacters >= maximumModuleCharacters,
    };
    const gitStatus = await this.projectGitStatus();
    const sensitiveFileCount = discovered.filter((uri) => isSensitivePath(uri.path)).length;
    const risks = this.projectRisks({
      truncated,
      testFileCount,
      dependencyCount: dependencies.size + devDependencies.size,
      sensitiveFileCount,
      gitStatus,
    });
    const readingSuggestions = this.readingSuggestions(
      configurationFiles,
      entryFiles,
      [...modules].sort(),
      testFileCount,
    );
    const overview: ProjectOverview = {
      workspaceName: vscode.workspace.name ?? folders.map((folder) => folder.name).join(", "),
      roots: folders.map((folder) => folder.name),
      fileCount: files.length,
      testFileCount,
      languages: [...languageCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 12),
      technologies: [...technologies].sort(),
      modules: [...modules].sort().slice(0, 30),
      moduleDependencies,
      moduleAnalysis,
      entryFiles: entryFiles.slice(0, 20),
      configurationFiles: configurationFiles.slice(0, 30),
      scripts,
      packageManagers: [...packageManagers].sort(),
      dependencyCount: dependencies.size,
      devDependencyCount: devDependencies.size,
      dependencies: [...new Set([...dependencies, ...devDependencies])].sort().slice(0, 40),
      gitStatus,
      risks,
      readingSuggestions,
      index: {
        status: truncated ? "partial" : "ready",
        cached: false,
        maximumFiles,
        validUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
      },
      warnings: [
        ...(truncated ? [`项目文件数量达到索引上限 ${maximumFiles}，当前概览可能不完整。`] : []),
        ...(moduleAnalysis.truncated
          ? [
              `模块依赖分析已限制在 ${moduleAnalysis.analyzedFiles} 个安全文本文件，关系图可能不完整。`,
            ]
          : []),
      ],
      truncated,
      analyzedAt: new Date().toISOString(),
    };
    if (rootKey) {
      await this.cache.save(rootKey, overview);
    }
    this.dirty = false;
    return overview;
  }

  public async createDirectoryContext(uri: vscode.Uri): Promise<ContextAttachment> {
    this.requireTrustedWorkspace();
    this.assertInsideWorkspace(uri);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(uri, "**/*"),
      defaultExclude,
      300,
    );
    const safeFiles = files
      .filter((file) => !isSensitivePath(file.path))
      .map((file) => vscode.workspace.asRelativePath(file, false).replaceAll("\\", "/"))
      .sort();
    const label = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
    return {
      title: `目录结构：${label || uri.path.split("/").at(-1) || "工作区"}`,
      source: uri.toString(),
      content: safeFiles.join("\n"),
      truncated: files.length >= 300,
    };
  }

  public async createGitDiffContext(): Promise<ContextAttachment> {
    this.requireTrustedWorkspace();
    const repository = await this.gitRepository();
    if (!repository) {
      throw new Error("当前 VS Code 未提供内置 Git 扩展，无法读取 Git Diff。");
    }
    const [workingTree, staged] = await Promise.all([
      repository.diff(false),
      repository.diff(true),
    ]);
    const sections = [
      staged.trim() ? `--- 已暂存变更 ---\n${staged}` : "",
      workingTree.trim() ? `--- 未暂存变更 ---\n${workingTree}` : "",
    ].filter(Boolean);
    if (sections.length === 0) {
      throw new Error("当前 Git 仓库没有已暂存或未暂存的文本变更。");
    }
    const sanitized = sanitizeGitDiff(sections.join("\n\n"));
    if (!sanitized.trim()) {
      throw new Error("Git Diff 只包含敏感路径，已根据安全策略过滤。");
    }
    return {
      title: "当前 Git Diff",
      source: "vscode.git",
      content: sanitized.slice(0, 100_000),
      truncated: sanitized.length > 100_000,
    };
  }

  public async buildContext(
    prompt: string,
    includeActiveEditor: boolean,
    includeWorkspace = false,
    extraAttachments: readonly ContextAttachment[] = [],
  ): Promise<BuiltContext> {
    if (includeActiveEditor || includeWorkspace || /@workspace\b|@file\(|@search\(/.test(prompt)) {
      this.requireTrustedWorkspace();
    }
    const attachments: ContextAttachment[] = [...extraAttachments];
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

    if (includeWorkspace || prompt.includes("@workspace")) {
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

  public async openFile(path: string): Promise<void> {
    this.requireTrustedWorkspace();
    const uri = this.resolveRelativePath(path);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true });
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

  public createActiveEditorInsertion(code: string, language?: string): ChangeSpec {
    this.requireTrustedWorkspace();
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("请先打开需要插入代码的工作区文件。");
    }
    this.assertInsideWorkspace(editor.document.uri);
    if (isSensitivePath(editor.document.uri.path)) {
      throw new Error("当前文件命中敏感路径策略，禁止生成修改。");
    }
    const original = editor.document.getText();
    if (original.length > 2_000_000) {
      throw new Error("当前文件超过 200 万字符，无法生成安全变更。");
    }
    const selection = editor.selection;
    const proposed = insertTextRange(
      original,
      editor.document.offsetAt(selection.start),
      editor.document.offsetAt(selection.end),
      code,
    );
    if (proposed === original) {
      throw new Error("代码片段没有产生任何内容变化。");
    }
    const relativePath = vscode.workspace
      .asRelativePath(editor.document.uri, false)
      .replaceAll("\\", "/");
    this.resolveRelativePath(relativePath);
    return {
      path: relativePath,
      operation: "update",
      content: proposed,
      reason: language ? `从 AI 回复插入 ${language} 代码片段` : "从 AI 回复插入代码片段",
    };
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

  private extension(path: string): string {
    const fileName = path.split("/").at(-1) ?? "";
    const index = fileName.lastIndexOf(".");
    return index >= 0 ? fileName.slice(index).toLocaleLowerCase() : "";
  }

  private detectPackageManager(fileName: string, packageManagers: Set<string>): void {
    const names: Readonly<Record<string, string>> = {
      "pnpm-lock.yaml": "pnpm",
      "package-lock.json": "npm",
      "yarn.lock": "Yarn",
      "bun.lock": "Bun",
      "bun.lockb": "Bun",
      "poetry.lock": "Poetry",
      "uv.lock": "uv",
      "pipfile.lock": "Pipenv",
      "go.mod": "Go Modules",
      "cargo.lock": "Cargo",
      "pom.xml": "Maven",
      gradlew: "Gradle",
    };
    const manager = names[fileName];
    if (manager) {
      packageManagers.add(manager);
    }
  }

  private async gitRepository(): Promise<GitRepository | undefined> {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) {
      return undefined;
    }
    const exports = extension.isActive ? extension.exports : await extension.activate();
    if (!exports.enabled) {
      return undefined;
    }
    return exports
      .getAPI(1)
      .repositories.find((item) => vscode.workspace.getWorkspaceFolder(item.rootUri));
  }

  private async projectGitStatus(): Promise<ProjectOverview["gitStatus"]> {
    try {
      const repository = await this.gitRepository();
      if (!repository) {
        return this.emptyGitStatus();
      }
      const state = repository.state;
      const changed = new Set(
        [
          ...state.workingTreeChanges,
          ...state.indexChanges,
          ...state.untrackedChanges,
          ...state.mergeChanges,
        ].map((change) => change.uri.toString()),
      );
      return {
        available: true,
        branch: state.HEAD?.name ?? state.HEAD?.commit?.slice(0, 8) ?? "未提交分支",
        changedFiles: changed.size,
        stagedFiles: state.indexChanges.length,
        untrackedFiles: state.untrackedChanges.length,
        conflictedFiles: state.mergeChanges.length,
      };
    } catch {
      return this.emptyGitStatus();
    }
  }

  private emptyGitStatus(): ProjectOverview["gitStatus"] {
    return {
      available: false,
      branch: "",
      changedFiles: 0,
      stagedFiles: 0,
      untrackedFiles: 0,
      conflictedFiles: 0,
    };
  }

  private projectRisks(input: {
    readonly truncated: boolean;
    readonly testFileCount: number;
    readonly dependencyCount: number;
    readonly sensitiveFileCount: number;
    readonly gitStatus: ProjectOverview["gitStatus"];
  }): readonly string[] {
    const risks: string[] = [];
    if (input.truncated) {
      risks.push("项目规模超过当前索引上限，画像和搜索结果可能不完整。");
    }
    if (input.testFileCount === 0) {
      risks.push("未识别到测试文件，修改后的自动验证能力可能不足。");
    }
    if (input.dependencyCount > 150) {
      risks.push(`直接依赖和开发依赖共 ${input.dependencyCount} 个，升级与供应链影响面较大。`);
    }
    if (input.sensitiveFileCount > 0) {
      risks.push(`检测到 ${input.sensitiveFileCount} 个敏感路径文件，已从索引和上下文中排除。`);
    }
    if (input.gitStatus.conflictedFiles > 0) {
      risks.push(`Git 工作区存在 ${input.gitStatus.conflictedFiles} 个冲突文件，请先处理冲突。`);
    } else if (input.gitStatus.changedFiles > 50) {
      risks.push(`Git 工作区已有 ${input.gitStatus.changedFiles} 个变更文件，建议先建立基线提交。`);
    }
    return risks;
  }

  private readingSuggestions(
    configurationFiles: readonly string[],
    entryFiles: readonly string[],
    modules: readonly string[],
    testFileCount: number,
  ): readonly string[] {
    const suggestions: string[] = [];
    const packageFile = configurationFiles.find((path) => path.endsWith("package.json"));
    if (packageFile) {
      suggestions.push(`先阅读 ${packageFile}，了解依赖、脚本和项目元数据。`);
    }
    if (entryFiles[0]) {
      suggestions.push(`从入口文件 ${entryFiles[0]} 跟踪启动和主要调用链。`);
    }
    if (modules.length > 0) {
      suggestions.push(`按模块顺序阅读：${modules.slice(0, 5).join(" → ")}。`);
    }
    if (testFileCount > 0) {
      suggestions.push("结合现有测试文件理解关键行为、边界条件和回归约束。");
    }
    return suggestions;
  }

  private rootKey(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.length
      ? folders
          .map((folder) => folder.uri.toString())
          .sort()
          .join("|")
      : undefined;
  }

  private isIgnoredPath(path: string): boolean {
    return /(?:^|\/)(?:node_modules|\.git|dist|build|out|coverage|\.venv|venv|target|vendor)(?:\/|$)/i.test(
      path.replaceAll("\\", "/"),
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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
    this.permissions.assertAvailable("read");
    if (!vscode.workspace.isTrusted) {
      throw new Error("当前工作区未受信任，已禁止读取代码。");
    }
  }
}
