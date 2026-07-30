import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import type { ChatMode } from "../domain/model.js";
import type { ChatSession, ChatSessionSummary, ConversationMessage } from "../domain/session.js";

const storageKey = "aiCodingAssistant.chatSessions.v2";
const maximumSessions = 50;
const maximumMessagesPerSession = 80;
const maximumMessageCharacters = 100_000;

export class ChatSessionStore {
  public constructor(private readonly state: vscode.Memento) {}

  public list(): readonly ChatSessionSummary[] {
    return this.sessions()
      .map((session) => ({
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public get(id: string): ChatSession | undefined {
    return this.sessions().find((session) => session.id === id);
  }

  public async ensure(): Promise<ChatSession> {
    const existing = this.sessions()[0];
    return existing ?? this.create();
  }

  public async create(): Promise<ChatSession> {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: randomUUID(),
      title: "新对话",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await this.save([session, ...this.sessions()]);
    return session;
  }

  public async rename(id: string, title: string): Promise<void> {
    const normalized = this.title(title);
    await this.replace(id, (session) => ({
      ...session,
      title: normalized,
      updatedAt: new Date().toISOString(),
    }));
  }

  public async remove(id: string): Promise<ChatSession> {
    const remaining = this.sessions().filter((session) => session.id !== id);
    if (remaining.length > 0) {
      await this.save(remaining);
      return remaining[0] as ChatSession;
    }
    await this.save([]);
    return this.create();
  }

  public async appendUser(id: string, text: string, mode: ChatMode): Promise<ConversationMessage> {
    const message: ConversationMessage = {
      id: randomUUID(),
      role: "user",
      text: text.slice(0, maximumMessageCharacters),
      mode,
      createdAt: new Date().toISOString(),
    };
    await this.replace(id, (session) => ({
      ...session,
      title: session.messages.length === 0 ? this.title(text) : session.title,
      updatedAt: message.createdAt,
      messages: [...session.messages, message].slice(-maximumMessagesPerSession),
    }));
    return message;
  }

  public async appendAssistant(id: string, requestId: string, text: string): Promise<void> {
    const createdAt = new Date().toISOString();
    const message: ConversationMessage = {
      id: requestId,
      role: "assistant",
      text: text.slice(0, maximumMessageCharacters),
      createdAt,
    };
    await this.replace(id, (session) => ({
      ...session,
      updatedAt: createdAt,
      messages: [...session.messages, message].slice(-maximumMessagesPerSession),
    }));
  }

  public async appendError(id: string, requestId: string, text: string): Promise<void> {
    const createdAt = new Date().toISOString();
    const message: ConversationMessage = {
      id: requestId,
      role: "assistant",
      text: text.slice(0, maximumMessageCharacters),
      createdAt,
      error: true,
    };
    await this.replace(id, (session) => ({
      ...session,
      updatedAt: createdAt,
      messages: [...session.messages, message].slice(-maximumMessagesPerSession),
    }));
  }

  private sessions(): readonly ChatSession[] {
    const stored = this.state.get<readonly ChatSession[]>(storageKey, []);
    return Array.isArray(stored) ? (stored as readonly ChatSession[]) : [];
  }

  private async replace(id: string, update: (session: ChatSession) => ChatSession): Promise<void> {
    let found = false;
    const next = this.sessions().map((session) => {
      if (session.id !== id) {
        return session;
      }
      found = true;
      return update(session);
    });
    if (!found) {
      throw new Error("对话不存在或已被删除。");
    }
    await this.save(next);
  }

  private save(sessions: readonly ChatSession[]): Thenable<void> {
    const sorted = [...sessions]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, maximumSessions);
    return this.state.update(storageKey, sorted);
  }

  private title(value: string): string {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length === 0) {
      return "新对话";
    }
    return compact.length > 28 ? `${compact.slice(0, 28)}…` : compact;
  }
}
