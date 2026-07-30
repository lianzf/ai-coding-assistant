import type { TestCommand } from "../domain/testing.js";

export interface TestProjectSnapshot {
  readonly rootPath: string;
  readonly files: ReadonlySet<string>;
  readonly packageScripts?: Readonly<Record<string, string>>;
}

export function detectTestCommand(
  project: TestProjectSnapshot,
  platform: NodeJS.Platform = process.platform,
): TestCommand | undefined {
  if (project.packageScripts?.test) {
    const manager = project.files.has("pnpm-lock.yaml")
      ? "pnpm"
      : project.files.has("yarn.lock")
        ? "yarn"
        : "npm";
    const executable = platform === "win32" ? `${manager}.cmd` : manager;
    return {
      executable,
      args: ["test"],
      cwd: project.rootPath,
      displayCommand: `${manager} test`,
      source: "package.json scripts.test",
    };
  }
  if (
    project.files.has("pyproject.toml") ||
    project.files.has("pytest.ini") ||
    project.files.has("setup.cfg")
  ) {
    const executable = platform === "win32" ? "python.exe" : "python3";
    return {
      executable,
      args: ["-m", "pytest"],
      cwd: project.rootPath,
      displayCommand: `${executable} -m pytest`,
      source: "Python project marker",
    };
  }
  if (project.files.has("pom.xml")) {
    const executable = platform === "win32" ? "mvn.cmd" : "mvn";
    return {
      executable,
      args: ["test"],
      cwd: project.rootPath,
      displayCommand: "mvn test",
      source: "pom.xml",
    };
  }
  if (project.files.has("CMakeLists.txt")) {
    return {
      executable: "ctest",
      args: ["--test-dir", "build", "--output-on-failure"],
      cwd: project.rootPath,
      displayCommand: "ctest --test-dir build --output-on-failure",
      source: "CMakeLists.txt",
    };
  }
  return undefined;
}
