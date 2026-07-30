import { create } from "zustand";

export type ChatMode = "ask" | "plan" | "agent";
export type NavigationItem = "chat" | "project" | "changes";

export interface ProviderView {
  readonly id: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly timeoutMs: number;
  readonly hasApiKey: boolean;
  readonly updatedAt: string;
}

export interface ChangeView {
  readonly id: string;
  readonly path: string;
  readonly operation: "create" | "update";
  readonly reason: string;
  readonly status: "pending" | "approved" | "applied" | "rejected" | "conflicted" | "failed";
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
}

export interface ChatSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
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
  readonly entryFiles: readonly string[];
  readonly configurationFiles: readonly string[];
  readonly scripts: Readonly<Record<string, string>>;
  readonly packageManagers: readonly string[];
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

interface AppState {
  viewKind: "chat" | "models";
  navigation: NavigationItem;
  provider: ProviderView | undefined;
  workspaceTrusted: boolean;
  changes: readonly ChangeView[];
  sessions: readonly SessionSummary[];
  activeSession: ChatSession | undefined;
  messages: readonly ChatItem[];
  searchResults: readonly SearchResult[];
  activeRequestId: string | undefined;
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
  workspaceTrusted: false,
  changes: [],
  sessions: [],
  activeSession: undefined,
  messages: [],
  searchResults: [],
  activeRequestId: undefined,
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
        set({
          provider: isRecord(message.provider)
            ? (message.provider as unknown as ProviderView)
            : undefined,
          changes: Array.isArray(message.changes) ? (message.changes as ChangeView[]) : [],
          sessions: Array.isArray(message.sessions) ? (message.sessions as SessionSummary[]) : [],
          activeSession,
          messages: sessionMessages(activeSession),
          workspaceTrusted: message.workspaceTrusted === true,
        });
        break;
      }
      case "sessions/state": {
        const activeSession = isRecord(message.activeSession)
          ? (message.activeSession as unknown as ChatSession)
          : undefined;
        set((state) => ({
          sessions: Array.isArray(message.sessions)
            ? (message.sessions as SessionSummary[])
            : state.sessions,
          activeSession,
          messages: state.activeRequestId ? state.messages : sessionMessages(activeSession),
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
          activeRequestId: requestId,
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
            },
          ],
        }));
        break;
      }
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
        set({ testRunning: true, testResult: undefined });
        break;
      case "test/result":
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
