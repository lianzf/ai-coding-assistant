const sensitiveAssignment =
  /\b(api[_-]?key|token|secret|password|passwd|authorization|private[_-]?key)\b(\s*[:=]\s*)([^\r\n,;]+)/gi;
const bearerToken = /\b(Bearer\s+)[a-z0-9._~+/=-]{8,}/gi;
const providerToken = /\b(sk-[a-z0-9_-]{8,})/gi;

export function redactPotentialSecrets(content: string): string {
  return content
    .replace(sensitiveAssignment, (_match, name: string, separator: string) => {
      return `${name}${separator}<已隐藏>`;
    })
    .replace(bearerToken, "$1<已隐藏>")
    .replace(providerToken, "<已隐藏>");
}

export function sanitizeGitDiff(content: string): string {
  const safeBlocks = content.split(/(?=^diff --git )/m).filter((block) => {
    const firstLine = block.split(/\r?\n/, 1)[0] ?? "";
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(firstLine);
    return !match || (!isSensitivePath(match[1] ?? "") && !isSensitivePath(match[2] ?? ""));
  });
  return redactPotentialSecrets(safeBlocks.join(""));
}
import { isSensitivePath } from "./PathPolicy.js";
