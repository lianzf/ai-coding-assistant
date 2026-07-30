import type { ChatMode } from "./model.js";

export interface ConversationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly mode?: ChatMode;
  readonly error?: boolean;
}

export interface ChatSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly messages: readonly ConversationMessage[];
}

export interface ChatSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly archived: boolean;
}
