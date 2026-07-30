import { create } from "zustand";

export type ChatMode = "ask" | "plan" | "agent";
export type ProviderAssignments = Partial<Record<ChatMode, string>>;
export type PermissionKind = "read" | "network" | "modify" | "command";
export type PermissionMode = "allow" | "ask" | "deny";
export type PermissionState = Readonly<Record<PermissionKind, PermissionMode>>;
export type NavigationItem = "chat" | "project" | "changes";

export interface ProviderView {
  readonly id: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly timeoutMs: number;
  readonly hasApiKey: boolean;
  readonly lastTestedAt?: string;
  readonly updatedAt: string;
}

export interface ChangeView {
  readonly id: string;
  readonly groupId: string;
  readonly path: string;
  readonly operation: "create" | "update";
  readonly reason: string;
  readonly status:
    | "pending"
    | "approved"
    | "applied"
    | "rejected"
    | "conflicted"
    | "failed"
    | "rollback-conflicted"
    | "rolled-back";
  readonly addedLines: number;
  readonly deletedLines: number;
  readonly rolledBackAt: string;
  readonly error: string;
}

export interface SearchResult {
  readonly uri: string;
  readonly relativePath: string;
  readonly line: number;
  readonly preview: string;
}

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly mode?: ChatMode;
  readonly error?: boolean;
}

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly archived: boolean;
}

export interface ChatSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly messages: readonly ConversationMessage[];
}

export interface ProjectOverview {
  readonly workspaceName: string;
  readonly roots: readonly string[];
  readonly fileCount: number;
  readonly testFileCount: number;
  readonly languages: readonly { readonly name: string; readonly count: number }[];
  readonly technologies: readonly string[];
  readonly modules: readonly string[];
  readonly moduleDependencies: readonly {
    readonly source: string;
    readonly target: string;
    readonly references: number;
    readonly examples: readonly string[];
  }[];
  readonly moduleAnalysis: {
    readonly analyzedFiles: number;
    readonly skippedFiles: number;
    readonly truncated: boolean;
  };
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

export interface ChatItem {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly pending: boolean;
  readonly error: boolean;
  readonly mode?: ChatMode;
}

export interface ExecutionStep {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly input: string;
  readonly status: "running" | "completed" | "failed";
  readonly summary: string;
  readonly durationMs?: number;
}

export interface TaskExecutionView {
  readonly sessionId: string;
  readonly requestId: string;
  readonly kind: "chat" | "test";
  readonly mode?: ChatMode;
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly summary: string;
  readonly steps: readonly ExecutionStep[];
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface ManualContextView {
  readonly id: string;
  readonly kind: "directory" | "git-diff" | "terminal";
  readonly label: string;
  readonly characters: number;
  readonly truncated: boolean;
}

interface AppState {
  viewKind: "chat" | "models";
  navigation: NavigationItem;
  provider: ProviderView | undefined;
  providers: readonly ProviderView[];
  providerAssignments: ProviderAssignments;
  permissions: PermissionState;
  workspaceTrusted: boolean;
  changes: readonly ChangeView[];
  sessions: readonly SessionSummary[];
  activeSession: ChatSession | undefined;
  messages: readonly ChatItem[];
  searchResults: readonly SearchResult[];
  activeRequestId: string | undefined;
  requestStatus: string | undefined;
  executionSteps: readonly ExecutionStep[];
  executionHistory: readonly TaskExecutionView[];
  contexts: readonly ManualContextView[];
  notice: { readonly level: "info" | "error"; readonly message: string } | undefined;
  testRunning: boolean;
  testResult:
    | {
        readonly command: string;
        readonly exitCode: number | null;
        readonly output: string;
        readonly durationMs: number;
      }
    | undefined;
  projectOverview: ProjectOverview | undefined;
  projectAnalyzing: boolean;
  prefill: { readonly text: string; readonly mode: ChatMode } | undefined;
  handleMessage: (message: unknown) => void;
  clearNotice: () => void;
  consumePrefill: () => void;
  setNavigation: (navigation: NavigationItem) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionMessages(session: ChatSession | undefined): readonly ChatItem[] {
  return (session?.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    pending: false,
    error: message.error === true,
    ...(message.mode ? { mode: message.mode } : {}),
  }));
}

const initialView = document.body.dataset.viewKind === "models" ? "models" : "chat";

export const useAppStore = create<AppState>((set) => ({
  viewKind: initialView,
  navigation: "chat",
  provider: undefined,
  providers: [],
  providerAssignments: {},
  permissions: {
    read: "allow",
    network: "allow",
    modify: "ask",
    command: "ask",
  },
  workspaceTrusted: false,
  changes: [],
  sessions: [],
  activeSession: undefined,
  messages: [],
  searchResults: [],
  activeRequestId: undefined,
  requestStatus: undefined,
  executionSteps: [],
  executionHistory: [],
  contexts: [],
  notice: undefined,
  testRunning: false,
  testResult: undefined,
  projectOverview: undefined,
  projectAnalyzing: false,
  prefill: undefined,
  handleMessage: (value) => {
    if (!isRecord(value) || typeof value.type !== "string") {
      return;
    }
    const message = value;
    switch (message.type) {
      case "state/snapshot": {
        const activeSession = isRecord(message.activeSession)
          ? (message.activeSession as unknown as ChatSession)
          : undefined;
        const executionHistory = Array.isArray(message.executionHistory)
          ? (message.executionHistory as TaskExecutionView[])
          : [];
        set((state) => ({
          provider: isRecord(message.provider)
            ? (message.provider as unknown as ProviderView)
            : undefined,
          providers: Array.isArray(message.providers) ? (message.providers as ProviderView[]) : [],
          providerAssignments: isRecord(message.providerAssignments)
            ? message.providerAssignments
            : {},
          permissions: isRecord(message.permissions)
            ? (message.permissions as unknown as PermissionState)
            : {
                read: "allow",
                network: "allow",
                modify: "ask",
                command: "ask",
              },
          contexts: Array.isArray(message.contexts)
            ? (message.contexts as ManualContextView[])
            : [],
          projectOverview: isRecord(message.projectOverview)
            ? (message.projectOverview as unknown as ProjectOverview)
            : undefined,
          changes: Array.isArray(message.changes) ? (message.changes as ChangeView[]) : [],
          sessions: Array.isArray(message.sessions) ? (message.sessions as SessionSummary[]) : [],
          activeSession,
          messages: sessionMessages(activeSession),
          workspaceTrusted: message.workspaceTrusted === true,
          executionHistory,
          ...(state.activeRequestId
            ? {}
            : {
                requestStatus: executionHistory[0]?.summary,
                executionSteps: executionHistory[0]?.steps ?? [],
              }),
        }));
        break;
      }
      case "sessions/state": {
        const activeSession = isRecord(message.activeSession)
          ? (message.activeSession as unknown as ChatSession)
          : undefined;
        const executionHistory = Array.isArray(message.executionHistory)
          ? (message.executionHistory as TaskExecutionView[])
          : [];
        set((state) => ({
          sessions: Array.isArray(message.sessions)
            ? (message.sessions as SessionSummary[])
            : state.sessions,
          activeSession,
          messages: state.activeRequestId ? state.messages : sessionMessages(activeSession),
          executionHistory,
          executionSteps:
            state.activeRequestId && state.activeSession?.id === activeSession?.id
              ? state.executionSteps
              : (executionHistory[0]?.steps ?? []),
          requestStatus:
            state.activeRequestId && state.activeSession?.id === activeSession?.id
              ? state.requestStatus
              : executionHistory[0]?.summary,
        }));
        break;
      }
      case "changes/state":
        set({
          changes: Array.isArray(message.changes) ? (message.changes as ChangeView[]) : [],
        });
        break;
      case "chat/accepted": {
        if (
          typeof message.requestId !== "string" ||
          typeof message.sessionId !== "string" ||
          !isRecord(message.userMessage) ||
          typeof message.userMessage.text !== "string"
        ) {
          return;
        }
        const requestId = message.requestId;
        const userMessage = message.userMessage as unknown as ConversationMessage;
        set((state) => ({
          navigation: "chat",
          activeRequestId: requestId,
          requestStatus: "正在准备任务…",
          executionSteps: [],
          sessions: Array.isArray(message.sessions)
            ? (message.sessions as SessionSummary[])
            : state.sessions,
          messages: [
            ...state.messages,
            {
              id: userMessage.id,
              role: "user",
              text: userMessage.text,
              pending: false,
              error: false,
              ...(userMessage.mode ? { mode: userMessage.mode } : {}),
            },
            {
              id: requestId,
              role: "assistant",
              text: "",
              pending: true,
              error: false,
              ...(userMessage.mode ? { mode: userMessage.mode } : {}),
            },
          ],
        }));
        break;
      }
      case "chat/status":
        if (typeof message.requestId === "string" && typeof message.message === "string") {
          set((state) =>
            state.activeRequestId === message.requestId
              ? { requestStatus: message.message as string }
              : {},
          );
        }
        break;
      case "chat/tool-start":
        if (
          typeof message.requestId === "string" &&
          typeof message.callId === "string" &&
          typeof message.name === "string" &&
          typeof message.label === "string"
        ) {
          set((state) =>
            state.activeRequestId === message.requestId
              ? {
                  requestStatus: `${String(message.label)}…`,
                  executionSteps: [
                    ...state.executionSteps,
                    {
                      id: message.callId as string,
                      name: message.name as string,
                      label: message.label as string,
                      input: typeof message.input === "string" ? message.input : "",
                      status: "running",
                      summary: "",
                    },
                  ],
                }
              : {},
          );
        }
        break;
      case "chat/tool-result":
        if (
          typeof message.requestId === "string" &&
          typeof message.callId === "string" &&
          typeof message.summary === "string"
        ) {
          set((state) =>
            state.activeRequestId === message.requestId
              ? {
                  requestStatus: message.summary as string,
                  executionSteps: state.executionSteps.map((step) =>
                    step.id === message.callId
                      ? {
                          ...step,
                          status:
                            message.ok === true ? ("completed" as const) : ("failed" as const),
                          summary: message.summary as string,
                          ...(typeof message.durationMs === "number"
                            ? { durationMs: message.durationMs }
                            : {}),
                        }
                      : step,
                  ),
                }
              : {},
          );
        }
        break;
      case "chat/delta":
        if (typeof message.requestId === "string" && typeof message.text === "string") {
          set((state) => ({
            messages: state.messages.map((item) =>
              item.id === message.requestId
                ? { ...item, text: item.text + (message.text as string) }
                : item,
            ),
          }));
        }
        break;
      case "chat/complete":
        if (typeof message.requestId === "string") {
          set((state) => ({
            activeRequestId: undefined,
            requestStatus: "任务已完成",
            messages: state.messages.map((item) =>
              item.id === message.requestId ? { ...item, pending: false } : item,
            ),
          }));
        }
        break;
      case "chat/error":
        if (typeof message.requestId === "string" && typeof message.message === "string") {
          set((state) => ({
            activeRequestId: undefined,
            requestStatus: "任务执行失败",
            messages: state.messages.map((item) =>
              item.id === message.requestId
                ? {
                    ...item,
                    text: message.message as string,
                    pending: false,
                    error: true,
                  }
                : item,
            ),
          }));
        }
        break;
      case "workspace/search-results":
        set({
          searchResults: Array.isArray(message.results) ? (message.results as SearchResult[]) : [],
        });
        break;
      case "context/state":
        set({
          contexts: Array.isArray(message.contexts)
            ? (message.contexts as ManualContextView[])
            : [],
        });
        break;
      case "code/proposed":
        if (typeof message.path === "string") {
          set({
            navigation: "changes",
            notice: {
              level: "info",
              message: `已将代码片段作为 ${message.path} 的候选修改送入变更中心。`,
            },
          });
        }
        break;
      case "provider/test-result":
        if (isRecord(message.result) && typeof message.result.message === "string") {
          set({
            notice: {
              level: message.result.ok === true ? "info" : "error",
              message: message.result.message,
            },
          });
        }
        break;
      case "test/started":
        if (typeof message.command === "string") {
          set((state) => ({
            testRunning: true,
            testResult: undefined,
            requestStatus: "正在运行项目测试…",
            executionSteps: [
              ...state.executionSteps.filter((step) => step.id !== "local-test"),
              {
                id: "local-test",
                name: "run_tests",
                label: "运行项目测试",
                input: message.command as string,
                status: "running",
                summary: "",
              },
            ],
          }));
        }
        break;
      case "test/result":
        if (isRecord(message.result)) {
          const result = message.result as unknown as NonNullable<AppState["testResult"]>;
          const passed = result.exitCode === 0;
          const summary = passed ? "测试通过" : `测试失败（退出码 ${result.exitCode ?? "未知"}）`;
          set((state) => ({
            testRunning: false,
            testResult: result,
            requestStatus: summary,
            executionSteps: state.executionSteps.map((step) =>
              step.id === "local-test"
                ? {
                    ...step,
                    status: passed ? ("completed" as const) : ("failed" as const),
                    summary,
                    durationMs: result.durationMs,
                  }
                : step,
            ),
          }));
        }
        break;
      case "test/error":
        if (typeof message.message === "string") {
          set({
            testRunning: false,
            requestStatus: message.message,
          });
        }
        break;
      case "test/agent-result":
        if (isRecord(message.result)) {
          set({
            testRunning: false,
            testResult: message.result as unknown as AppState["testResult"],
          });
        }
        break;
      case "project/analyzing":
        set({ projectAnalyzing: true });
        break;
      case "project/result":
        if (isRecord(message.overview)) {
          set({
            projectAnalyzing: false,
            projectOverview: message.overview as unknown as ProjectOverview,
          });
        }
        break;
      case "chat/prefill":
        if (
          typeof message.text === "string" &&
          (message.mode === "ask" || message.mode === "plan" || message.mode === "agent")
        ) {
          set({
            navigation: "chat",
            prefill: {
              text: message.text,
              mode: message.mode,
            },
          });
        }
        break;
      case "ui/info":
      case "ui/error":
        if (typeof message.message === "string") {
          set({
            notice: {
              level: message.type === "ui/info" ? "info" : "error",
              message: message.message,
            },
          });
        }
        break;
    }
  },
  clearNotice: () => set({ notice: undefined }),
  consumePrefill: () => set({ prefill: undefined }),
  setNavigation: (navigation) => set({ navigation }),
}));
