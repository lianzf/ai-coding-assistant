import { describe, expect, it } from "vitest";
import { extractChangeSpecs } from "../../src/changes/ChangeParser.js";

describe("extractChangeSpecs", () => {
  it("extracts explicitly marked create/update changes", () => {
    const answer = `建议如下。
\`\`\`ai-change-set
{"changes":[{"path":"src/a.ts","operation":"update","content":"export const a = 2;","reason":"修复"},{"path":"tests/a.test.ts","operation":"create","content":"test('a',()=>{});"}]}
\`\`\``;
    expect(extractChangeSpecs(answer)).toEqual([
      {
        path: "src/a.ts",
        operation: "update",
        content: "export const a = 2;",
        reason: "修复",
      },
      {
        path: "tests/a.test.ts",
        operation: "create",
        content: "test('a',()=>{});",
      },
    ]);
  });

  it("does not accept delete operations", () => {
    const answer =
      '```ai-change-set\n{"changes":[{"path":"src/a.ts","operation":"delete","content":""}]}\n```';
    expect(extractChangeSpecs(answer)).toEqual([]);
  });
});
