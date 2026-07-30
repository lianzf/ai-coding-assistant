const sensitiveExtensions = /\.(?:key|pem|p12|pfx)$/i;

export function isSensitivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const name = normalized.split("/").at(-1) ?? "";
  if (
    name === ".env" ||
    name.startsWith(".env.") ||
    name === "id_rsa" ||
    name === "id_ed25519" ||
    name === "credentials" ||
    name === "secrets"
  ) {
    return true;
  }
  return sensitiveExtensions.test(name) || normalized.includes("/.ssh/");
}
