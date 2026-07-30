import { describe, expect, it } from "vitest";
import { redactPotentialSecrets, sanitizeGitDiff } from "../../src/security/ContentRedactor.js";

describe("ContentRedactor", () => {
  it("redacts common credentials copied from terminal output", () => {
    const sanitized = redactPotentialSecrets(
      "API_KEY=sk-private123\nAuthorization: Bearer abcdefghijklmnop\nnormal=value",
    );

    expect(sanitized).not.toContain("sk-private123");
    expect(sanitized).not.toContain("abcdefghijklmnop");
    expect(sanitized).toContain("normal=value");
    expect(sanitized.match(/<已隐藏>/g)).toHaveLength(2);
  });

  it("drops sensitive file blocks from Git Diff and keeps ordinary code", () => {
    const sanitized = sanitizeGitDiff(
      [
        "diff --git a/.env b/.env",
        "--- a/.env",
        "+++ b/.env",
        "+TOKEN=secret-value",
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "+export const ready = true;",
      ].join("\n"),
    );

    expect(sanitized).not.toContain(".env");
    expect(sanitized).not.toContain("secret-value");
    expect(sanitized).toContain("src/app.ts");
    expect(sanitized).toContain("ready = true");
  });
});
