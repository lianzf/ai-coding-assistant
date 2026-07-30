import { z } from "zod";

const chatModeSchema = z.enum(["ask", "plan", "agent"]);
const providerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);

const readySchema = z
  .object({
    type: z.literal("view/ready"),
    viewKind: z.enum(["chat", "models"]),
  })
  .strict();

const providerSaveSchema = z
  .object({
    type: z.literal("provider/save"),
    providerId: providerIdSchema,
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
    providerId: providerIdSchema,
    apiKey: z.string().min(1).max(16_384),
  })
  .strict();

const providerActionSchema = z
  .object({
    type: z.enum(["provider/clear-key", "provider/test"]),
    providerId: providerIdSchema,
  })
  .strict();

const providerDeleteSchema = z
  .object({
    type: z.literal("provider/delete"),
    providerId: providerIdSchema,
  })
  .strict();

const providerAssignSchema = z
  .object({
    type: z.literal("provider/assign"),
    mode: chatModeSchema,
    providerId: providerIdSchema,
  })
  .strict();

const permissionUpdateSchema = z
  .object({
    type: z.literal("permission/update"),
    kind: z.enum(["read", "network", "modify", "command"]),
    mode: z.enum(["allow", "ask", "deny"]),
  })
  .strict();

const chatSendSchema = z
  .object({
    type: z.literal("chat/send"),
    requestId: z.string().uuid(),
    sessionId: z.string().uuid(),
    text: z.string().trim().min(1).max(100_000),
    mode: chatModeSchema,
    providerId: providerIdSchema.optional(),
    includeActiveEditor: z.boolean(),
    includeWorkspace: z.boolean(),
    contextIds: z.array(z.string().uuid()).max(12).optional(),
  })
  .strict();

const chatConfirmPlanSchema = z
  .object({
    type: z.literal("chat/confirm-plan"),
    requestId: z.string().uuid(),
    sessionId: z.string().uuid(),
    planMessageId: z.string().uuid(),
    providerId: providerIdSchema.optional(),
  })
  .strict();

const chatRegenerateSchema = z
  .object({
    type: z.literal("chat/regenerate"),
    requestId: z.string().uuid(),
    sessionId: z.string().uuid(),
    assistantMessageId: z.string().uuid(),
    providerId: providerIdSchema.optional(),
    includeActiveEditor: z.boolean(),
    includeWorkspace: z.boolean(),
  })
  .strict();

const codeProposeInsertSchema = z
  .object({
    type: z.literal("code/propose-insert"),
    code: z.string().min(1).max(200_000),
    language: z.string().trim().min(1).max(50).optional(),
  })
  .strict();

const contextAddSchema = z
  .object({
    type: z.literal("context/add"),
    kind: z.enum(["directory", "git-diff", "terminal"]),
  })
  .strict();

const contextRemoveSchema = z
  .object({
    type: z.literal("context/remove"),
    contextId: z.string().uuid(),
  })
  .strict();

const sessionNewSchema = z
  .object({
    type: z.literal("session/new"),
  })
  .strict();

const sessionSelectSchema = z
  .object({
    type: z.literal("session/select"),
    sessionId: z.string().uuid(),
  })
  .strict();

const sessionDeleteSchema = z
  .object({
    type: z.literal("session/delete"),
    sessionId: z.string().uuid(),
  })
  .strict();

const sessionRenameSchema = z
  .object({
    type: z.literal("session/rename"),
    sessionId: z.string().uuid(),
    title: z.string().trim().min(1).max(100),
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
    type: z.enum(["change/preview", "change/apply", "change/reject", "change/rollback"]),
    changeId: z.string().uuid(),
  })
  .strict();

const changeBatchActionSchema = z
  .object({
    type: z.enum(["change/apply-all", "change/reject-all", "change/rollback-latest"]),
  })
  .strict();

const runTestsSchema = z
  .object({
    type: z.literal("test/run"),
  })
  .strict();

const projectAnalyzeSchema = z
  .object({
    type: z.literal("project/analyze"),
    force: z.boolean().optional(),
  })
  .strict();

const openSettingsSchema = z
  .object({
    type: z.literal("ui/open-settings"),
  })
  .strict();

export const inboundMessageSchema = z.discriminatedUnion("type", [
  readySchema,
  providerSaveSchema,
  providerKeySchema,
  providerActionSchema,
  providerDeleteSchema,
  providerAssignSchema,
  permissionUpdateSchema,
  chatSendSchema,
  chatConfirmPlanSchema,
  chatRegenerateSchema,
  codeProposeInsertSchema,
  contextAddSchema,
  contextRemoveSchema,
  chatCancelSchema,
  sessionNewSchema,
  sessionSelectSchema,
  sessionDeleteSchema,
  sessionRenameSchema,
  searchSchema,
  changeActionSchema,
  changeBatchActionSchema,
  runTestsSchema,
  projectAnalyzeSchema,
  openSettingsSchema,
]);

export type InboundMessage = z.infer<typeof inboundMessageSchema>;
