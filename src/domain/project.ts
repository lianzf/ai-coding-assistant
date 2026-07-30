export interface ProjectOverview {
  readonly workspaceName: string;
  readonly roots: readonly string[];
  readonly fileCount: number;
  readonly testFileCount: number;
  readonly languages: readonly {
    readonly name: string;
    readonly count: number;
  }[];
  readonly technologies: readonly string[];
  readonly modules: readonly string[];
  readonly entryFiles: readonly string[];
  readonly configurationFiles: readonly string[];
  readonly scripts: Readonly<Record<string, string>>;
  readonly packageManagers: readonly string[];
  readonly dependencyCount: number;
  readonly devDependencyCount: number;
  readonly dependencies: readonly string[];
  readonly gitStatus: {
    readonly available: boolean;
    readonly branch: string;
    readonly changedFiles: number;
    readonly stagedFiles: number;
    readonly untrackedFiles: number;
    readonly conflictedFiles: number;
  };
  readonly risks: readonly string[];
  readonly readingSuggestions: readonly string[];
  readonly index: {
    readonly status: "ready" | "partial";
    readonly cached: boolean;
    readonly maximumFiles: number;
    readonly validUntil: string;
  };
  readonly warnings: readonly string[];
  readonly truncated: boolean;
  readonly analyzedAt: string;
}
