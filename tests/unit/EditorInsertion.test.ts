import { describe, expect, it } from "vitest";
import { insertTextRange } from "../../src/workspace/EditorInsertion.js";

describe("insertTextRange", () => {
  it("inserts code at an empty cursor selection", () => {
    expect(insertTextRange("const a = 1;\n", 0, 0, "// generated\n")).toBe(
      "// generated\nconst a = 1;\n",
    );
  });

  it("replaces only the selected range", () => {
    expect(insertTextRange("before old after", 7, 10, "new")).toBe("before new after");
  });

  it.each([
    [-1, 0],
    [3, 2],
    [0, 99],
    [0.5, 1],
  ])("rejects an invalid editor range", (start, end) => {
    expect(() => insertTextRange("text", start, end, "code")).toThrow("编辑器选区范围无效");
  });
});
