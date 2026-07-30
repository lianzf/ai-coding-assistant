import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectTestCommand } from "../../src/testing/TestCommandDetector.js";
import { runTestCommand } from "../../src/testing/TestProcessRunner.js";

describe("test execution integration", () => {
  it("detects and runs the fixture workspace unit-test script", async () => {
    const rootPath = resolve(import.meta.dirname, "../fixtures/workspace");
    const command = detectTestCommand({
      rootPath,
      files: new Set(["package.json"]),
      packageScripts: { test: "node --test" },
    });
    expect(command).toBeDefined();

    const result = await runTestCommand(command!, new AbortController().signal);

    expect(result.command).toBe("npm test");
    expect(result.exitCode).toBe(0);
    expect(result.cancelled).toBe(false);
    expect(result.output).toContain("fixture runner executes a real unit test");
  }, 15_000);
});
