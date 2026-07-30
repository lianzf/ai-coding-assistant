import { z } from "zod";
import type { ProjectOverview } from "../domain/project.js";

export interface ProjectCacheStatePort {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const overviewSchema = z
  .object({
    workspaceName: z.string(),
    roots: z.array(z.string()),
    fileCount: z.number().int().nonnegative(),
    testFileCount: z.number().int().nonnegative(),
    languages: z.array(
      z.object({ name: z.string(), count: z.number().int().nonnegative() }).strict(),
    ),
    technologies: z.array(z.string()),
    modules: z.array(z.string()),
    moduleDependencies: z.array(
      z
        .object({
          source: z.string(),
          target: z.string(),
          references: z.number().int().positive(),
          examples: z.array(z.string()).max(3),
        })
        .strict(),
    ),
    moduleAnalysis: z
      .object({
        analyzedFiles: z.number().int().nonnegative(),
        skippedFiles: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .strict(),
    entryFiles: z.array(z.string()),
    configurationFiles: z.array(z.string()),
    scripts: z.record(z.string(), z.string()),
    packageManagers: z.array(z.string()),
    dependencyCount: z.number().int().nonnegative(),
    devDependencyCount: z.number().int().nonnegative(),
    dependencies: z.array(z.string()),
    gitStatus: z
      .object({
        available: z.boolean(),
        branch: z.string(),
        changedFiles: z.number().int().nonnegative(),
        stagedFiles: z.number().int().nonnegative(),
        untrackedFiles: z.number().int().nonnegative(),
        conflictedFiles: z.number().int().nonnegative(),
      })
      .strict(),
    risks: z.array(z.string()),
    readingSuggestions: z.array(z.string()),
    index: z
      .object({
        status: z.enum(["ready", "partial"]),
        cached: z.boolean(),
        maximumFiles: z.number().int().positive(),
        validUntil: z.string().datetime(),
      })
      .strict(),
    warnings: z.array(z.string()),
    truncated: z.boolean(),
    analyzedAt: z.string().datetime(),
  })
  .strict();

const storedSchema = z
  .object({
    version: z.literal(2),
    rootKey: z.string().min(1),
    overview: overviewSchema,
  })
  .strict();

export class ProjectOverviewCache {
  private static readonly storageKey = "aiCodingAssistant.projectOverview.v2";

  public constructor(private readonly state: ProjectCacheStatePort) {}

  public get(rootKey: string, now = Date.now()): ProjectOverview | undefined {
    const parsed = storedSchema.safeParse(this.state.get<unknown>(ProjectOverviewCache.storageKey));
    if (
      !parsed.success ||
      parsed.data.rootKey !== rootKey ||
      Date.parse(parsed.data.overview.index.validUntil) <= now
    ) {
      return undefined;
    }
    return {
      ...parsed.data.overview,
      index: {
        ...parsed.data.overview.index,
        cached: true,
      },
    };
  }

  public async save(rootKey: string, overview: ProjectOverview): Promise<void> {
    await this.state.update(ProjectOverviewCache.storageKey, {
      version: 2,
      rootKey,
      overview: {
        ...overview,
        index: {
          ...overview.index,
          cached: false,
        },
      },
    });
  }
}
