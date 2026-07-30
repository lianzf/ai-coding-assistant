import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const root = resolve(import.meta.dirname, "../..");
const extensionUnderTestPath = process.env.EXTENSION_UNDER_TEST_PATH
  ? resolve(process.env.EXTENSION_UNDER_TEST_PATH)
  : root;
const candidates = [
  process.env.VSCODE_EXECUTABLE_PATH,
  "D:\\VSCode\\Code.exe",
  process.env.LOCALAPPDATA
    ? resolve(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe")
    : undefined,
].filter((value) => typeof value === "string");

let executable = candidates.find((candidate) => existsSync(candidate));
if (!executable) {
  executable = await downloadAndUnzipVSCode("stable");
}

// The VS Code CLI sets this for its own helper process. Passing it through to
// Code.exe would make Electron treat the workspace path as a Node entrypoint.
delete process.env.ELECTRON_RUN_AS_NODE;

await runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: extensionUnderTestPath,
  extensionTestsPath: resolve(root, "tests", "extension-host", "suite", "index.cjs"),
  launchArgs: [resolve(root, "tests", "fixtures", "workspace"), "--disable-extensions"],
});
