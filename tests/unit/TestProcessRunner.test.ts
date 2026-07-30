import { describe, expect, it } from "vitest";
import type { TestCommand } from "../../src/domain/testing.js";
import { buildTestSpawnInvocation, runTestCommand } from "../../src/testing/TestProcessRunner.js";

function command(executable: string, args: readonly string[]): TestCommand {
  return {
    executable,
    args,
    cwd: process.cwd(),
    displayCommand: [executable, ...args].join(" "),
    source: "test",
  };
}

describe("TestProcessRunner", () => {
  it("uses a constrained command processor for Windows .cmd launchers", () => {
    const invocation = buildTestSpawnInvocation(command("pnpm.cmd", ["test"]), "win32", {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    });

    expect(invocation).toEqual({
      executable: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm.cmd test"],
      usesCommandProcessor: true,
    });
  });

  it("rejects shell metacharacters in a Windows .cmd invocation", () => {
    expect(() =>
      buildTestSpawnInvocation(command("pnpm.cmd", ["test", "&&", "whoami"]), "win32"),
    ).toThrow(/不安全/);
  });

  it("runs a direct process and captures its output", async () => {
    const result = await runTestCommand(
      command(process.execPath, ["-e", "process.stdout.write('runner-ok')"]),
      new AbortController().signal,
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("runner-ok");
    expect(result.cancelled).toBe(false);
  });

  it.runIf(process.platform === "win32")(
    "runs the detected pnpm.cmd launcher on Windows",
    async () => {
      const result = await runTestCommand(
        command("pnpm.cmd", ["--version"]),
        new AbortController().signal,
      );

      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toMatch(/^\d+\.\d+\.\d+/);
    },
  );
});
