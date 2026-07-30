import { create } from "zustand";

export type ChatMode = "ask" | "explain" | "edit" | "agent" | "review" | "test" | "document";

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

export interface ChatItem {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly pending: boolean;
  readonly error: boolean;
}

interface AppState {
  viewKind: "chat" | "models";
  provider: ProviderView | undefined;
  workspaceTrusted: boolean;
  changes: readonly ChangeView[];
  messages: readonly ChatItem[];
  searchResults: readonly SearchResult[];
  activeRequestId: string | undefined;
  notice: { readonly level: "info" | "error"; readonly message: string } | undefined;
  testResult:
    | {
        readonly command: string;
        readonly exitCode: number | null;
        readonly output: string;
        readonly durationMs: number;
      }
    | undefined;
  prefill: { readonly text: string; readonly mode: ChatMode } | undefined;
  handleMessage: (message: unknown) => void;
  clearNotice: () => void;
  consumePrefill: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const initialView = document.body.dataset.viewKind === "models" ? "models" : "chat";

export const useAppStore = create<AppState>((set) => ({
  viewKind: initialView,
  provider: undefined,
  workspaceTrusted: false,
  changes: [],
  messages: [],
  searchResults: [],
  activeRequestId: undefined,
  notice: undefined,
  testResult: undefined,
  prefill: undefined,
  handleMessage: (value) => {
    if (!isRecord(value) || typeof value.type !== "string") {
      return;
    }
    const message = value;
    switch (message.type) {
      case "state/snapshot":
        set({
          provider: isRecord(message.provider)
            ? (message.provider as unknown as ProviderView)
            : undefined,
          changes: Array.isArray(message.changes) ? (message.changes as ChangeView[]) : [],
          workspaceTrusted: message.workspaceTrusted === true,
        });
        break;
      case "changes/state":
        set({
          changes: Array.isArray(message.changes) ? (message.changes as ChangeView[]) : [],
        });
        break;
      case "chat/accepted": {
        if (typeof message.requestId !== "string" || typeof message.text !== "string") {
          return;
        }
        const requestId = message.requestId;
        set((state) => ({
          activeRequestId: requestId,
          messages: [
            ...state.messages,
            {
              id: crypto.randomUUID(),
              role: "user",
              text: message.text as string,
              pending: false,
              error: false,
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
      case "test/result":
        if (isRecord(message.result)) {
          set({
            testResult: message.result as unknown as AppState["testResult"],
          });
        }
        break;
      case "chat/prefill":
        if (typeof message.text === "string" && typeof message.mode === "string") {
          set({
            prefill: {
              text: message.text,
              mode: message.mode as ChatMode,
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
}));
