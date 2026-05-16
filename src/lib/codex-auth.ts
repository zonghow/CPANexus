export function buildAutoAuthFileName(email: string) {
  const sanitized = email
    .trim()
    .replace(/^\.+/, "")
    .replace(/[\\/]+/g, "_")
    .replace(/[^A-Za-z0-9@._+-]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");

  return `codex-${sanitized || "unknown"}-auto.json`;
}
