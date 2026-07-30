import { describe, expect, it } from "vitest";
import type { ProjectOverview } from "../../src/domain/project.js";
import {
  ProjectOverviewCache,
  type ProjectCacheStatePort,
} from "../../src/workspace/ProjectOverviewCache.js";

class MemoryState implements ProjectCacheStatePort {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  public update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

function overview(validUntil: string): ProjectOverview {
  return {
    workspaceName: "Fixture",
    roots: ["fixture"],
    fileCount: 12,
    testFileCount: 2,
    languages: [{ name: "TypeScript", count: 10 }],
    technologies: ["TypeScript"],
    modules: ["src"],
    entryFiles: ["src/index.ts"],
    configurationFiles: ["package.json"],
    scripts: { test: "vitest run" },
    packageManagers: ["pnpm"],
    dependencyCount: 4,
    devDependencyCount: 3,
    dependencies: ["react", "typescript"],
    gitStatus: {
      available: true,
      branch: "main",
      changedFiles: 1,
      stagedFiles: 0,
      untrackedFiles: 1,
      conflictedFiles: 0,
    },
    risks: [],
    readingSuggestions: ["先阅读 package.json。"],
    index: {
      status: "ready",
      cached: false,
      maximumFiles: 4_000,
      validUntil,
    },
    warnings: [],
    truncated: false,
    analyzedAt: "2026-07-30T00:00:00.000Z",
  };
}

describe("ProjectOverviewCache", () => {
  it("reuses a valid snapshot only for the matching workspace roots", async () => {
    const cache = new ProjectOverviewCache(new MemoryState());
    const validUntil = "2026-07-30T00:15:00.000Z";
    await cache.save("file:///workspace", overview(validUntil));

    expect(cache.get("file:///workspace", Date.parse("2026-07-30T00:10:00.000Z"))).toMatchObject({
      workspaceName: "Fixture",
      index: { cached: true },
    });
    expect(cache.get("file:///other", Date.parse("2026-07-30T00:10:00.000Z"))).toBeUndefined();
  });

  it("expires old or malformed snapshots", async () => {
    const state = new MemoryState();
    const cache = new ProjectOverviewCache(state);
    await cache.save("file:///workspace", overview("2026-07-30T00:15:00.000Z"));

    expect(cache.get("file:///workspace", Date.parse("2026-07-30T00:15:00.000Z"))).toBeUndefined();
    await state.update("aiCodingAssistant.projectOverview.v1", { version: 1 });
    expect(cache.get("file:///workspace")).toBeUndefined();
  });
});
