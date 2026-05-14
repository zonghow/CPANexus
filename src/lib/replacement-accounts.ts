export type ParsedBackupAccount = {
  email: string;
  refreshToken: string;
  sourceLine: string;
};

export type InvalidBackupAccountLine = {
  lineNumber: number;
  sourceLine: string;
  reason: "missing email" | "missing refresh token";
};

export type BackupAccountParseResult = {
  valid: ParsedBackupAccount[];
  invalid: InvalidBackupAccountLine[];
};

const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const refreshTokenRegex = /\brt_[A-Za-z0-9._-]+/;

export function parseBackupAccountLines(text: string): BackupAccountParseResult {
  const valid: ParsedBackupAccount[] = [];
  const invalid: InvalidBackupAccountLine[] = [];

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line, index) => {
      if (!line) {
        return;
      }

      const segments = line.split("----").map((segment) => segment.trim());
      const email = line.match(emailRegex)?.[0] ?? "";
      const refreshToken =
        segments.find((segment) => refreshTokenRegex.test(segment))?.match(refreshTokenRegex)?.[0] ??
        line.match(refreshTokenRegex)?.[0] ??
        "";

      if (!email) {
        invalid.push({
          lineNumber: index + 1,
          sourceLine: line,
          reason: "missing email",
        });
        return;
      }

      if (!refreshToken) {
        invalid.push({
          lineNumber: index + 1,
          sourceLine: line,
          reason: "missing refresh token",
        });
        return;
      }

      valid.push({
        email,
        refreshToken,
        sourceLine: line,
      });
    });

  return { valid, invalid };
}

export function buildCodexAuthPayload(account: {
  email: string;
  refreshToken: string;
}) {
  return {
    type: "codex",
    refresh_token: account.refreshToken,
    expired: "1970-01-01T00:00:00Z",
    email: account.email,
  };
}

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
