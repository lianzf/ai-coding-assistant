import { describe, expect, it } from "vitest";
import {
  analyzeModuleDependencies,
  isModuleAnalysisFile,
} from "../../src/workspace/ModuleDependencyAnalyzer.js";

describe("ModuleDependencyAnalyzer", () => {
  it("detects relative and workspace-package dependencies without external noise", () => {
    const result = analyzeModuleDependencies([
      {
        path: "apps/web/package.json",
        content: JSON.stringify({
          name: "@demo/web",
          dependencies: { "@demo/core": "workspace:*", react: "^19.0.0" },
        }),
      },
      {
        path: "packages/core/package.json",
        content: JSON.stringify({ name: "@demo/core" }),
      },
      {
        path: "apps/web/src/index.ts",
        content: [
          'import { core } from "@demo/core";',
          'import { helper } from "../../../packages/core/src/helper";',
          'import React from "react";',
        ].join("\n"),
      },
      {
        path: "packages/core/src/helper.ts",
        content: "export const helper = true;",
      },
    ]);

    expect(result.dependencies).toEqual([
      {
        source: "apps/web",
        target: "packages/core",
        references: 2,
        examples: ["apps/web/package.json", "apps/web/src/index.ts"],
      },
    ]);
  });

  it("detects Python imports across top-level modules and ignores self references", () => {
    const result = analyzeModuleDependencies([
      {
        path: "tests/test_service.py",
        content: "from src.service import run\nimport pytest\n",
      },
      {
        path: "src/service.py",
        content: "from .helpers import value\n",
      },
      {
        path: "src/helpers.py",
        content: "value = 1\n",
      },
    ]);

    expect(result.dependencies).toEqual([
      {
        source: "tests",
        target: "src",
        references: 1,
        examples: ["tests/test_service.py"],
      },
    ]);
  });

  it("selects only bounded text source and manifest files", () => {
    expect(isModuleAnalysisFile("src/index.ts")).toBe(true);
    expect(isModuleAnalysisFile("packages/core/package.json")).toBe(true);
    expect(isModuleAnalysisFile("assets/logo.png")).toBe(false);
  });
});
