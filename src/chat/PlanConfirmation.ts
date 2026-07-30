import type { ChatSession, ConversationMessage } from "../domain/session.js";

export function requireExecutablePlan(
  session: ChatSession | undefined,
  planMessageId: string,
): ConversationMessage {
  const plan = session?.messages.find((message) => message.id === planMessageId);
  if (
    !plan ||
    plan.role !== "assistant" ||
    plan.mode !== "plan" ||
    plan.error === true ||
    plan.text.trim().length === 0
  ) {
    throw new Error("未找到可执行的规划回复，请重新生成计划后再确认。");
  }
  return plan;
}
