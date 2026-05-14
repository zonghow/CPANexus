import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type AppConfig = {
  auth: {
    adminPassword: string;
    cookieName: string;
    sessionMaxAgeDays: number;
  };
};

const defaultConfig: AppConfig = {
  auth: {
    adminPassword: "admin",
    cookieName: "cpa_nexus_session",
    sessionMaxAgeDays: 7,
  },
};

type TomlValue = string | number | boolean;

export function getAppConfig(): AppConfig {
  const configPath = resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.CPA_NEXUS_CONFIG?.trim() || "config.toml",
  );
  const source = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  return applyEnvOverrides(loadAppConfigFromToml(source), process.env);
}

export function loadAppConfigFromToml(source: string): AppConfig {
  const parsed = parseSimpleToml(source);
  const auth = parsed.auth ?? {};

  return {
    auth: {
      adminPassword: stringValue(auth.admin_password) || defaultConfig.auth.adminPassword,
      cookieName: stringValue(auth.cookie_name) || defaultConfig.auth.cookieName,
      sessionMaxAgeDays:
        positiveIntegerValue(auth.session_max_age_days) ??
        defaultConfig.auth.sessionMaxAgeDays,
    },
  };
}

function applyEnvOverrides(config: AppConfig, env: NodeJS.ProcessEnv): AppConfig {
  return {
    auth: {
      adminPassword:
        env.CPA_NEXUS_ADMIN_PASSWORD?.trim() || config.auth.adminPassword,
      cookieName: env.CPA_NEXUS_COOKIE_NAME?.trim() || config.auth.cookieName,
      sessionMaxAgeDays:
        positiveIntegerValue(env.CPA_NEXUS_SESSION_MAX_AGE_DAYS) ??
        config.auth.sessionMaxAgeDays,
    },
  };
}

function parseSimpleToml(source: string) {
  const tables: Record<string, Record<string, TomlValue>> = {};
  let currentTable: string | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const tableMatch = line.match(/^\[([A-Za-z0-9_-]+)]$/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      tables[currentTable] ??= {};
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1 || !currentTable) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    tables[currentTable][key] = parseTomlValue(rawValue);
  }

  return tables;
}

function stripTomlComment(line: string) {
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = quoted;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "#" && !quoted) {
      return line.slice(0, index);
    }
  }

  return line;
}

function parseTomlValue(rawValue: string): TomlValue {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      return JSON.parse(rawValue) as string;
    } catch {
      return rawValue.slice(1, -1);
    }
  }
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }

  const numberValue = Number(rawValue);
  return Number.isFinite(numberValue) ? numberValue : rawValue;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveIntegerValue(value: unknown) {
  const numberValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}
