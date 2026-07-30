import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });

await Promise.all([
  esbuild({
    absWorkingDir: root,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.cjs",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    external: ["vscode"],
    sourcemap: false,
    logLevel: "info",
  }),
  viteBuild({
    configFile: resolve(root, "webview/vite.config.ts"),
  }),
]);
