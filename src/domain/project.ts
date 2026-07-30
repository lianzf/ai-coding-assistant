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
  readonly warnings: readonly string[];
  readonly truncated: boolean;
  readonly analyzedAt: string;
}
