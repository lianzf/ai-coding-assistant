import { z } from "zod";
import type { ChangeSpec } from "../domain/change.js";

const changeSetSchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            path: z.string().trim().min(1).max(1000),
            operation: z.enum(["create", "update"]),
            content: z.string().max(2_000_000),
            reason: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export function extractChangeSpecs(answer: string): readonly ChangeSpec[] {
  const candidates: string[] = [];
  const marked = /```(?:ai-change-set|json)\s*\r?\n([\s\S]*?)```/gi;
  for (const match of answer.matchAll(marked)) {
    if (match[1]) {
      candidates.push(match[1]);
    }
  }
  const markerIndex = answer.indexOf("AI_CHANGE_SET:");
  if (markerIndex >= 0) {
    candidates.push(answer.slice(markerIndex + "AI_CHANGE_SET:".length).trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = changeSetSchema.safeParse(JSON.parse(candidate) as unknown);
      if (parsed.success) {
        return parsed.data.changes.map((change) => ({
          path: change.path,
          operation: change.operation,
          content: change.content,
          ...(change.reason !== undefined ? { reason: change.reason } : {}),
        }));
      }
    } catch {
      // Continue: ordinary JSON examples in an answer are not necessarily changes.
    }
  }
  return [];
}
