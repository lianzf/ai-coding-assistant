export interface WorkspaceSearchResult {
  readonly uri: string;
  readonly relativePath: string;
  readonly line: number;
  readonly preview: string;
}

export interface ContextAttachment {
  readonly title: string;
  readonly source: string;
  readonly content: string;
  readonly truncated: boolean;
}

export interface BuiltContext {
  readonly attachments: readonly ContextAttachment[];
  readonly text: string;
  readonly characterCount: number;
}
