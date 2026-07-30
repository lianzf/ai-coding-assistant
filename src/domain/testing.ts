export interface TestCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly displayCommand: string;
  readonly source: string;
}

export interface TestRunResult {
  readonly command: string;
  readonly exitCode: number | null;
  readonly output: string;
  readonly durationMs: number;
  readonly cancelled: boolean;
}
