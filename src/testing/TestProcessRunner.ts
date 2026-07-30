import { spawn } from "node:child_process";
import type { TestCommand, TestRunResult } from "../domain/testing.js";

const outputLimit = 1_000_000;
const safeWindowsToken = /^[A-Za-z0-9_./:@\\=+-]+$/;

export interface TestSpawnInvocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly usesCommandProcessor: boolean;
}

export function buildTestSpawnInvocation(
  command: TestCommand,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): TestSpawnInvocation {
  if (platform !== "win32" || !command.executable.toLowerCase().endsWith(".cmd")) {
    return {
      executable: command.executable,
      args: command.args,
      usesCommandProcessor: false,
    };
  }

  const tokens = [command.executable, ...command.args];
  if (tokens.some((token) => !safeWindowsToken.test(token))) {
    throw new Error("检测到不安全的 Windows 测试命令参数，已拒绝执行。");
  }
  return {
    executable:
      environment.ComSpec ?? `${environment.SystemRoot ?? "C:\\Windows"}\\System32\\cmd.exe`,
    args: ["/d", "/s", "/c", tokens.join(" ")],
    usesCommandProcessor: true,
  };
}

export async function runTestCommand(
  command: TestCommand,
  signal: AbortSignal,
  onOutput: (text: string) => void = () => undefined,
): Promise<TestRunResult> {
  const started = Date.now();
  if (signal.aborted) {
    return {
      command: command.displayCommand,
      exitCode: null,
      output: "",
      durationMs: 0,
      cancelled: true,
    };
  }

  const invocation = buildTestSpawnInvocation(command);
  return await new Promise<TestRunResult>((resolve, reject) => {
    const child = spawn(invocation.executable, [...invocation.args], {
      cwd: command.cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
    });
    let output = "";
    let cancelled = false;
    let settled = false;

    const append = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      onOutput(text);
      if (output.length < outputLimit) {
        output += text.slice(0, outputLimit - output.length);
      }
    };
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cancelled = true;
      child.kill();
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        command: command.displayCommand,
        exitCode,
        output,
        durationMs: Date.now() - started,
        cancelled,
      });
    });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
