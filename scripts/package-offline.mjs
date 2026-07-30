import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const artifacts = resolve(root, "artifacts");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const fileName = `${packageJson.name}-${packageJson.version}.vsix`;
const output = resolve(artifacts, fileName);

await mkdir(artifacts, { recursive: true });
const vsceCli = resolve(root, "node_modules", "@vscode", "vsce", "vsce");
const commandArgs = [
  vsceCli,
  "package",
  "--no-dependencies",
  "--allow-missing-repository",
  "--no-rewrite-relative-links",
  "--out",
  output,
];
const result = spawnSync(process.execPath, commandArgs, {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
if (result.error) {
  console.error(result.error);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const bytes = await readFile(output);
const sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${output}.sha256`, `${sha256}  ${fileName}\n`, "utf8");
await writeFile(
  resolve(artifacts, `${packageJson.name}-${packageJson.version}.metadata.json`),
  `${JSON.stringify(
    {
      extensionId: `${packageJson.publisher}.${packageJson.name}`,
      version: packageJson.version,
      file: fileName,
      sha256,
      createdAt: new Date().toISOString(),
      supportedPlatforms: ["win32-x64", "linux-x64", "linux-arm64"],
      offlineInstall: true,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`Offline package: ${output}`);
console.log(`SHA-256: ${sha256}`);
