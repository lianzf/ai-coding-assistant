import { describe, expect, it } from "vitest";
import { requireExecutablePlan } from "../../src/chat/PlanConfirmation.js";
import type { ChatSession, ConversationMessage } from "../../src/domain/session.js";

function sessionWith(message: ConversationMessage): ChatSession {
  return {
    id: "fa6c3c8f-a76f-4b1a-9d97-2c85266f0b9c",
    title: "升级计划",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    messages: [message],
  };
}

const validPlan: ConversationMessage = {
  id: "5c69fda2-a042-4b42-9e52-c6a49faf1ea8",
  role: "assistant",
  text: "1. 分析项目\n2. 生成变更",
  mode: "plan",
  createdAt: "2026-07-30T00:00:00.000Z",
};

describe("requireExecutablePlan", () => {
  it("returns a persisted assistant plan", () => {
    expect(requireExecutablePlan(sessionWith(validPlan), validPlan.id)).toEqual(validPlan);
  });

  it.each([
    { ...validPlan, role: "user" as const },
    { ...validPlan, mode: "ask" as const },
    { ...validPlan, error: true },
    { ...validPlan, text: "   " },
  ])("rejects a non-executable conversation message", (message) => {
    expect(() => requireExecutablePlan(sessionWith(message), message.id)).toThrow(
      "未找到可执行的规划回复",
    );
  });

  it("rejects a plan id that does not exist in the session", () => {
    expect(() => requireExecutablePlan(sessionWith(validPlan), crypto.randomUUID())).toThrow(
      "未找到可执行的规划回复",
    );
  });
});
