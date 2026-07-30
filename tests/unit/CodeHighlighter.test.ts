import { describe, expect, it } from "vitest";
import { tokenizeCode } from "../../webview/src/codeHighlighter.js";

describe("tokenizeCode", () => {
  it("classifies common code tokens without producing HTML", () => {
    const tokens = tokenizeCode('const answer = "safe"; // note\nreturn 42;');
    expect(tokens).toEqual(
      expect.arrayContaining([
        { kind: "keyword", value: "const" },
        { kind: "string", value: '"safe"' },
        { kind: "comment", value: "// note" },
        { kind: "keyword", value: "return" },
        { kind: "number", value: "42" },
      ]),
    );
  });

  it("renders oversized code as one plain token", () => {
    const code = "x".repeat(50_001);
    expect(tokenizeCode(code)).toEqual([{ kind: "plain", value: code }]);
  });
});
