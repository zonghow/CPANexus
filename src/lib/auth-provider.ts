export const authViews = ["codex", "grok"] as const;

export type AuthView = (typeof authViews)[number];

export const defaultAuthView: AuthView = "codex";

export const authViewStorageKey = "cpa-nexus-auth-view";

export const authViewLabels: Record<AuthView, string> = {
  codex: "Codex",
  grok: "Grok",
};

/** Sections that only exist for Codex auth workflows. */
export const codexOnlySections = [
  "candidate-pool",
  "exceptions",
  "dashboard",
  "message-push",
  "quota-settings",
] as const;

export type CodexOnlySection = (typeof codexOnlySections)[number];

/** Shared modules available under every auth view. */
export const sharedSections = ["instances", "proxies", "jobs"] as const;

const codexProviderAliases = new Set(["codex", "openai", "chatgpt"]);
const grokProviderAliases = new Set(["xai", "grok", "x-ai", "x.ai"]);

export function isAuthView(value: unknown): value is AuthView {
  return typeof value === "string" && authViews.includes(value as AuthView);
}

export function normalizeAuthProvider(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function resolveAuthView(provider: unknown): AuthView | null {
  const normalized = normalizeAuthProvider(provider);
  if (!normalized) {
    return null;
  }
  if (codexProviderAliases.has(normalized)) {
    return "codex";
  }
  if (grokProviderAliases.has(normalized)) {
    return "grok";
  }
  return null;
}

/**
 * Match a stored/remote provider against the active auth view.
 * Missing provider is treated as Codex for backward compatibility.
 */
export function matchesAuthView(
  provider: unknown,
  view: AuthView,
  options: { treatMissingAsCodex?: boolean } = {},
): boolean {
  const treatMissingAsCodex = options.treatMissingAsCodex ?? true;
  const resolved = resolveAuthView(provider);
  if (resolved === null) {
    return treatMissingAsCodex ? view === "codex" : false;
  }
  return resolved === view;
}

export function isCodexOnlySection(section: string): section is CodexOnlySection {
  return (codexOnlySections as readonly string[]).includes(section);
}

export function defaultSectionForAuthView(view: AuthView): string {
  return view === "grok" ? "auth" : "auth";
}

export function sectionAllowedForAuthView(
  section: string,
  view: AuthView,
): boolean {
  if (view === "codex") {
    return true;
  }
  if (section === "auth") {
    return true;
  }
  return (sharedSections as readonly string[]).includes(section);
}

export function providerFromAuthPayload(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  return (
    normalizeAuthProvider(payload.provider) ??
    normalizeAuthProvider(payload.type)
  );
}

export function accountTypeFromAuthPayload(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const explicit =
    normalizeAuthProvider(payload.account_type) ??
    normalizeAuthProvider(payload.accountType) ??
    normalizeAuthProvider(payload.auth_kind) ??
    normalizeAuthProvider(payload.authKind);
  if (explicit) {
    return explicit;
  }
  if (
    typeof payload.api_key === "string" ||
    typeof payload.apiKey === "string"
  ) {
    return "api_key";
  }
  if (
    typeof payload.refresh_token === "string" ||
    typeof payload.access_token === "string"
  ) {
    return "oauth";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
