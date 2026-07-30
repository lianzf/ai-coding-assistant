import { describe, expect, it } from "vitest";
import { requireRegenerationTarget } from "../../src/chat/RegenerationTarget.js";
import type { ChatSession } from "../../src/domain/session.js";

const session: ChatSession = {
  id: "fa6c3c8f-a76f-4b1a-9d97-2c85266f0b9c",
  title: "解释代码",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:01:00.000Z",
  messages: [
    {
      id: "48eb451d-f03d-41db-9988-a5e325328c33",
      role: "user",
      text: "解释当前文件",
      mode: "ask",
      createdAt: "2026-07-30T00:00:00.000Z",
    },
    {
      id: "5c69fda2-a042-4b42-9e52-c6a49faf1ea8",
      role: "assistant",
      text: "这是解释。",
      mode: "ask",
      createdAt: "2026-07-30T00:01:00.000Z",
    },
  ],
};

describe("requireRegenerationTarget", () => {
  it("returns the preceding user request without the rejected answer in history", () => {
    expect(requireRegenerationTarget(session, "5c69fda2-a042-4b42-9e52-c6a49faf1ea8")).toEqual({
      text: "解释当前文件",
      mode: "ask",
      historyEndIndex: 0,
    });
  });

  it("rejects an old assistant reply to avoid implicit conversation branching", () => {
    const extended: ChatSession = {
      ...session,
      messages: [
        ...session.messages,
        {
          id: "d028f719-25be-4655-ad3d-dfe57cb98ae0",
          role: "user",
          text: "继续",
          mode: "ask",
          createdAt: "2026-07-30T00:02:00.000Z",
        },
      ],
    };
    expect(() =>
      requireRegenerationTarget(extended, "5c69fda2-a042-4b42-9e52-c6a49faf1ea8"),
    ).toThrow("只能重新生成当前对话中最近一条 AI 回复");
  });

  it("rejects a missing target", () => {
    expect(() =>
      requireRegenerationTarget(session, "0cce5692-573a-4c24-88d4-e48be3904b28"),
    ).toThrow("只能重新生成当前对话中最近一条 AI 回复");
  });
});
