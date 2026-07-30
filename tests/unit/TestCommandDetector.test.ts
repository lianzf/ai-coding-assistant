import { describe, expect, it } from "vitest";
import { detectTestCommand } from "../../src/testing/TestCommandDetector.js";

describe("detectTestCommand", () => {
  it("prefers the existing pnpm test script on Windows", () => {
    const command = detectTestCommand(
      {
        rootPath: "C:\\repo",
        files: new Set(["package.json", "pnpm-lock.yaml"]),
        packageScripts: { test: "vitest run" },
      },
      "win32",
    );
    expect(command).toMatchObject({
      executable: "pnpm.cmd",
      args: ["test"],
      displayCommand: "pnpm test",
    });
  });

  it("detects pytest without inventing a new framework", () => {
    const command = detectTestCommand(
      {
        rootPath: "/repo",
        files: new Set(["pyproject.toml"]),
      },
      "linux",
    );
    expect(command).toMatchObject({
      executable: "python3",
      args: ["-m", "pytest"],
    });
  });

  it("returns undefined when no test framework is present", () => {
    expect(
      detectTestCommand({
        rootPath: "/repo",
        files: new Set(["README.md"]),
      }),
    ).toBeUndefined();
  });
});
