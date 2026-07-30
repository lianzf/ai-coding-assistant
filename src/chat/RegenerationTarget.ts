import type { ChatMode } from "../domain/model.js";
import type { ChatSession } from "../domain/session.js";

export interface RegenerationTarget {
  readonly text: string;
  readonly mode: ChatMode;
  readonly historyEndIndex: number;
}

export function requireRegenerationTarget(
  session: ChatSession | undefined,
  assistantMessageId: string,
): RegenerationTarget {
  const messages = session?.messages ?? [];
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId);
  const assistant = messages[assistantIndex];
  if (!assistant || assistant.role !== "assistant" || assistantIndex !== messages.length - 1) {
    throw new Error("只能重新生成当前对话中最近一条 AI 回复。");
  }

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const user = messages[index];
    if (user?.role === "user" && user.text.trim().length > 0) {
      return {
        text: user.text,
        mode: assistant.mode ?? user.mode ?? "ask",
        historyEndIndex: index,
      };
    }
  }
  throw new Error("未找到该回复对应的用户消息，无法重新生成。");
}
