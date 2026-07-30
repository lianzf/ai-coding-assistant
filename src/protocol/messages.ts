import { z } from "zod";

const chatModeSchema = z.enum(["ask", "explain", "edit", "agent", "review", "test", "document"]);

const readySchema = z
  .object({
    type: z.literal("view/ready"),
    viewKind: z.enum(["chat", "models"]),
  })
  .strict();

const providerSaveSchema = z
  .object({
    type: z.literal("provider/save"),
    displayName: z.string().trim().min(1).max(100),
    baseUrl: z.string().url().max(2048),
    modelId: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(5_000).max(600_000),
    apiKey: z.string().min(1).max(16_384).optional(),
  })
  .strict();

const providerKeySchema = z
  .object({
    type: z.literal("provider/set-key"),
    apiKey: z.string().min(1).max(16_384),
  })
  .strict();

const providerActionSchema = z
  .object({
    type: z.enum(["provider/clear-key", "provider/test"]),
  })
  .strict();

const chatSendSchema = z
  .object({
    type: z.literal("chat/send"),
    requestId: z.string().uuid(),
    text: z.string().trim().min(1).max(100_000),
    mode: chatModeSchema,
    includeActiveEditor: z.boolean(),
  })
  .strict();

const chatCancelSchema = z
  .object({
    type: z.literal("chat/cancel"),
    requestId: z.string().uuid(),
  })
  .strict();

const searchSchema = z
  .object({
    type: z.literal("workspace/search"),
    query: z.string().trim().min(2).max(500),
  })
  .strict();

const changeActionSchema = z
  .object({
    type: z.enum(["change/preview", "change/apply", "change/reject"]),
    changeId: z.string().uuid(),
  })
  .strict();

const runTestsSchema = z
  .object({
    type: z.literal("test/run"),
  })
  .strict();

export const inboundMessageSchema = z.discriminatedUnion("type", [
  readySchema,
  providerSaveSchema,
  providerKeySchema,
  providerActionSchema,
  chatSendSchema,
  chatCancelSchema,
  searchSchema,
  changeActionSchema,
  runTestsSchema,
]);

export type InboundMessage = z.infer<typeof inboundMessageSchema>;
