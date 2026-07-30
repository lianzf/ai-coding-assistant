import { describe, expect, it } from "vitest";
import { isSensitivePath } from "../../src/security/PathPolicy.js";

describe("isSensitivePath", () => {
  it.each([
    ".env",
    "app/.env.production",
    "keys/server.pem",
    "C:\\work\\.ssh\\id_rsa",
    "config/credentials",
  ])("blocks %s", (path) => {
    expect(isSensitivePath(path)).toBe(true);
  });

  it("allows ordinary source files", () => {
    expect(isSensitivePath("src/security/SecretManager.ts")).toBe(false);
  });
});
