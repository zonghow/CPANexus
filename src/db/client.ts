import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  cpaNexusSqlite?: Database.Database;
};

export function sqlitePathFromDatabaseUrl(databaseUrl = process.env.DATABASE_URL) {
  const value = databaseUrl?.trim() || "file:./data/cpa-nexus.db";
  if (value.startsWith("file:")) {
    return resolve(/* turbopackIgnore: true */ process.cwd(), value.slice("file:".length));
  }

  return resolve(/* turbopackIgnore: true */ process.cwd(), value);
}

export function getSqlite() {
  if (!globalForDb.cpaNexusSqlite) {
    const dbPath = sqlitePathFromDatabaseUrl();
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    globalForDb.cpaNexusSqlite = sqlite;
  }

  return globalForDb.cpaNexusSqlite;
}

export const db = drizzle(getSqlite(), { schema });
