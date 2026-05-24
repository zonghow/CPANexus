# Exception Auth Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an exception account pool where cleaned abnormal CPA auth files are stored locally, exported, moved back to CPA instances, or deleted.

**Architecture:** Add an `exception_auth_files` table that stores the complete auth JSON independently from live `auth_files`. Centralize portal/move behavior in a small library so single-row and batch API routes share the same safety rules. Extend the existing dashboard shell with an `/exceptions` section and keep all existing direct-delete behavior intact.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client components, Drizzle ORM with better-sqlite3, Vitest, lucide-react, existing shadcn-style UI components.

---

### File Structure

- Modify `src/db/schema.ts`: add `exceptionAuthFiles` table and exported type.
- Modify `src/db/migrate.ts`: create `exception_auth_files` table and unique index.
- Modify `src/db/migrate.test.ts`: verify migration creates the new table and index.
- Create `src/lib/exception-auth-files.ts`: shared server helpers for loading payloads, upserting exception records, deleting source auth files, moving exception records to a CPA, and formatting email CSV.
- Create `src/lib/exception-auth-files.test.ts`: unit tests for CSV formatting and payload parsing edge cases.
- Modify `src/app/api/auth-files/[id]/route.ts`: add `POST action: "portalException"` while keeping `refreshQuota`.
- Modify `src/app/api/auth-files/[id]/route.test.ts`: cover single-account portal behavior and failure without auth JSON.
- Modify `src/app/api/cpa-instances/[id]/auth-files/batch/route.ts`: add `action: "portalExceptions"` for batch abnormal cleanup.
- Modify `src/app/api/cpa-instances/[id]/auth-files/batch/route.test.ts`: cover batch portal behavior and raw JSON fallback.
- Create `src/app/api/exception-auth-files/route.ts`: list and clear exception records.
- Create `src/app/api/exception-auth-files/route.test.ts`: cover list and clear.
- Create `src/app/api/exception-auth-files/[id]/route.ts`: delete one record or move it to a target CPA.
- Create `src/app/api/exception-auth-files/[id]/route.test.ts`: cover delete, move, duplicate target failure, and sync error response.
- Modify `src/components/cpa-dashboard.tsx`: add navigation, state, handlers, exception page, batch portal action, and row `清理` action.
- Modify `src/app/[section]/page.tsx`: allow the `exceptions` section.

---

### Task 1: Schema And Migration

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/migrate.ts`
- Test: `src/db/migrate.test.ts`

- [ ] **Step 1: Write the failing migration test**

Append this test inside `describe("migrate", ...)` in `src/db/migrate.test.ts`:

```ts
  it("creates exception auth file storage", async () => {
    const { migrate } = await import("./migrate");
    const { getSqlite } = await import("./client");

    migrate();
    const sqlite = getSqlite();

    const columns = sqlite
      .prepare("PRAGMA table_info(exception_auth_files)")
      .all() as Array<{ name: string; notnull: number }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "source_cpa_instance_id",
      "source_cpa_instance_name",
      "file_name",
      "email",
      "last_error",
      "raw_json",
      "created_at",
      "updated_at",
    ]);
    expect(columns.find((column) => column.name === "raw_json")?.notnull).toBe(1);

    const indexes = sqlite
      .prepare("PRAGMA index_list(exception_auth_files)")
      .all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(["exception_auth_files_file_unique"]),
    );
  });
```

- [ ] **Step 2: Run the migration test to verify it fails**

Run: `npm test -- src/db/migrate.test.ts`

Expected: FAIL because `exception_auth_files` does not exist and the columns array is empty.

- [ ] **Step 3: Add the Drizzle schema**

In `src/db/schema.ts`, add this table after `authFiles`:

```ts
export const exceptionAuthFiles = sqliteTable(
  "exception_auth_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceCpaInstanceId: integer("source_cpa_instance_id"),
    sourceCpaInstanceName: text("source_cpa_instance_name").notNull(),
    fileName: text("file_name").notNull(),
    email: text("email"),
    lastError: text("last_error"),
    rawJson: text("raw_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("exception_auth_files_file_unique").on(table.fileName),
  ],
);
```

At the bottom of `src/db/schema.ts`, export the inferred type:

```ts
export type ExceptionAuthFile = typeof exceptionAuthFiles.$inferSelect;
```

- [ ] **Step 4: Add the SQL migration**

In `src/db/migrate.ts`, add this to the first `sqlite.exec` block after the `auth_files` table/index:

```sql
    CREATE TABLE IF NOT EXISTS exception_auth_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_cpa_instance_id INTEGER,
      source_cpa_instance_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      email TEXT,
      last_error TEXT,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS exception_auth_files_file_unique
      ON exception_auth_files(file_name);
```

- [ ] **Step 5: Run the migration test to verify it passes**

Run: `npm test -- src/db/migrate.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrate.ts src/db/migrate.test.ts
git commit -m "feat: add exception auth file storage"
```

---

### Task 2: Shared Exception Auth Helpers

**Files:**
- Create: `src/lib/exception-auth-files.ts`
- Create: `src/lib/exception-auth-files.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `src/lib/exception-auth-files.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  exceptionAuthFilesToEmailCsv,
  parseStoredAuthPayload,
  stringifyStoredAuthPayload,
} from "./exception-auth-files";

describe("exception auth file helpers", () => {
  it("exports one non-empty email per CSV line", () => {
    expect(
      exceptionAuthFilesToEmailCsv([
        { email: "first@example.com" },
        { email: "" },
        { email: null },
        { email: "second@example.com" },
      ]),
    ).toBe("first@example.com\nsecond@example.com\n");
  });

  it("escapes CSV email values that contain special characters", () => {
    expect(
      exceptionAuthFilesToEmailCsv([
        { email: "plain@example.com" },
        { email: "quoted,\"mail\"@example.com" },
      ]),
    ).toBe("plain@example.com\n\"quoted,\"\"mail\"\"@example.com\"\n");
  });

  it("stringifies and parses stored auth payloads", () => {
    const rawJson = stringifyStoredAuthPayload({ email: "a@example.com", token: "rt_test" });
    expect(parseStoredAuthPayload(rawJson)).toEqual({
      email: "a@example.com",
      token: "rt_test",
    });
  });

  it("rejects invalid stored auth payload json", () => {
    expect(() => parseStoredAuthPayload("{")).toThrow("stored auth payload is invalid");
  });
});
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run: `npm test -- src/lib/exception-auth-files.test.ts`

Expected: FAIL because `src/lib/exception-auth-files.ts` does not exist.

- [ ] **Step 3: Add helper implementation**

Create `src/lib/exception-auth-files.ts`:

```ts
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  authFiles,
  cpaInstances,
  exceptionAuthFiles,
  quotaSnapshots,
  type AuthFile,
  type CpaInstance,
  type ExceptionAuthFile,
} from "@/db/schema";
import {
  deleteRemoteAuthFile,
  downloadRemoteAuthFile,
  uploadRemoteAuthFile,
} from "@/lib/cpa-client";

export function exceptionAuthFilesToEmailCsv(rows: Array<{ email: string | null }>) {
  const lines = rows
    .map((row) => row.email?.trim() ?? "")
    .filter((email) => email.length > 0)
    .map(csvCell);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function stringifyStoredAuthPayload(payload: unknown) {
  const text = JSON.stringify(payload);
  if (!text) {
    throw new Error("auth file payload is unavailable");
  }
  return text;
}

export function parseStoredAuthPayload(rawJson: string) {
  try {
    return JSON.parse(rawJson) as unknown;
  } catch {
    throw new Error("stored auth payload is invalid");
  }
}

export async function portalAuthFileToExceptionPool(
  instance: CpaInstance,
  authFile: AuthFile,
) {
  const payload = await loadAuthPayloadForPortal(instance, authFile);
  const now = new Date().toISOString();
  const lastError = authFile.statusMessage ?? authFile.status ?? null;

  db.insert(exceptionAuthFiles)
    .values({
      sourceCpaInstanceId: instance.id,
      sourceCpaInstanceName: instance.name,
      fileName: authFile.fileName,
      email: authFile.email,
      lastError,
      rawJson: stringifyStoredAuthPayload(payload),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: exceptionAuthFiles.fileName,
      set: {
        sourceCpaInstanceId: instance.id,
        sourceCpaInstanceName: instance.name,
        email: authFile.email,
        lastError,
        rawJson: stringifyStoredAuthPayload(payload),
        updatedAt: now,
      },
    })
    .run();

  await deleteRemoteAuthFile(instance, authFile.fileName);
  deleteLocalAuthFile(authFile.cpaInstanceId, authFile.id, authFile.fileName);
}

export async function moveExceptionAuthFileToCpa(
  row: ExceptionAuthFile,
  targetInstance: CpaInstance,
) {
  const duplicate = db
    .select()
    .from(authFiles)
    .where(
      and(
        eq(authFiles.cpaInstanceId, targetInstance.id),
        eq(authFiles.fileName, row.fileName),
      ),
    )
    .get();
  if (duplicate) {
    throw new Error(`target CPA already has auth file ${row.fileName}`);
  }

  await uploadRemoteAuthFile(targetInstance, row.fileName, parseStoredAuthPayload(row.rawJson));
  db.delete(exceptionAuthFiles).where(eq(exceptionAuthFiles.id, row.id)).run();
}

export function deleteLocalAuthFile(
  cpaInstanceId: number,
  authFileId: number,
  fileName: string,
) {
  db.delete(quotaSnapshots)
    .where(
      and(
        eq(quotaSnapshots.cpaInstanceId, cpaInstanceId),
        eq(quotaSnapshots.authFileName, fileName),
      ),
    )
    .run();
  db.delete(authFiles).where(eq(authFiles.id, authFileId)).run();
}

export function loadExceptionAuthFile(id: number) {
  return db.select().from(exceptionAuthFiles).where(eq(exceptionAuthFiles.id, id)).get() ?? null;
}

export function loadTargetCpaInstance(targetCpaInstanceId: number) {
  return db.select().from(cpaInstances).where(eq(cpaInstances.id, targetCpaInstanceId)).get() ?? null;
}

async function loadAuthPayloadForPortal(instance: CpaInstance, authFile: AuthFile) {
  try {
    return await downloadRemoteAuthFile(instance, authFile.fileName);
  } catch {
    if (!authFile.rawJson) {
      throw new Error("auth file payload is unavailable");
    }
    return parseStoredAuthPayload(authFile.rawJson);
  }
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value)
    ? `"${value.replaceAll("\"", "\"\"")}"`
    : value;
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `npm test -- src/lib/exception-auth-files.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/exception-auth-files.ts src/lib/exception-auth-files.test.ts
git commit -m "feat: add exception auth helpers"
```

---

### Task 3: Single Auth File Portal API

**Files:**
- Modify: `src/app/api/auth-files/[id]/route.ts`
- Modify: `src/app/api/auth-files/[id]/route.test.ts`

- [ ] **Step 1: Write failing tests for single portal**

Add these two tests before the existing `refreshes quota for the selected auth file` test in `src/app/api/auth-files/[id]/route.test.ts`:

```ts
  it("portals an auth file into the exception pool and removes it from the source CPA", async () => {
    const sqlite = await setupSqlite();
    const sourceId = insertInstance(sqlite, {
      name: "source",
      baseUrl: "https://source.example.com",
    });
    const authFileId = insertAuthFile(sqlite, sourceId);
    insertQuotaSnapshot(sqlite, sourceId);

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.downloadRemoteAuthFile).mockResolvedValue({
      email: "remote@example.com",
      refresh_token: "rt_remote",
    });
    vi.mocked(cpaClient.deleteRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "source",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/auth-files/1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "portalException" }),
      }),
      { params: Promise.resolve({ id: String(authFileId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    expect(cpaClient.downloadRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceId }),
      "codex-a@example.com-auto.json",
    );
    expect(cpaClient.deleteRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: sourceId }),
      "codex-a@example.com-auto.json",
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(sourceId);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_files").get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM quota_snapshots").get()).toMatchObject({ count: 0 });
    expect(
      sqlite
        .prepare("SELECT source_cpa_instance_name, file_name, email, last_error, raw_json FROM exception_auth_files")
        .get(),
    ).toMatchObject({
      source_cpa_instance_name: "source",
      file_name: "codex-a@example.com-auto.json",
      email: "a@example.com",
      last_error: "available",
      raw_json: JSON.stringify({ email: "remote@example.com", refresh_token: "rt_remote" }),
    });
  });

  it("does not portal an auth file when remote download fails and local raw_json is unavailable", async () => {
    const sqlite = await setupSqlite();
    const sourceId = insertInstance(sqlite, {
      name: "source",
      baseUrl: "https://source.example.com",
    });
    const authFileId = insertAuthFile(sqlite, sourceId);
    sqlite.prepare("UPDATE auth_files SET raw_json = NULL WHERE id = ?").run(authFileId);

    const cpaClient = await import("@/lib/cpa-client");
    vi.mocked(cpaClient.downloadRemoteAuthFile).mockRejectedValue(new Error("download failed"));
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/auth-files/1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "portalException" }),
      }),
      { params: Promise.resolve({ id: String(authFileId) }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "auth file payload is unavailable" });
    expect(cpaClient.deleteRemoteAuthFile).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_files").get()).toMatchObject({ count: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM exception_auth_files").get()).toMatchObject({ count: 0 });
  });
```

- [ ] **Step 2: Run the auth-file route tests to verify they fail**

Run: `npm test -- src/app/api/auth-files/[id]/route.test.ts`

Expected: FAIL because `POST` only accepts `refreshQuota`.

- [ ] **Step 3: Implement `portalException` in the single route**

In `src/app/api/auth-files/[id]/route.ts`, import the helper:

```ts
import { portalAuthFileToExceptionPool } from "@/lib/exception-auth-files";
```

Replace the start of `POST` after body parsing with this branch:

```ts
    if (body.action !== "refreshQuota" && body.action !== "portalException") {
      return badRequest("action must be refreshQuota or portalException");
    }

    const id = parseIntegerId((await routeParams(context)).id);
    if (!id) {
      return badRequest("invalid id");
    }

    if (body.action === "portalException") {
      initRequestDb();
      const authFile = db.select().from(authFiles).where(eq(authFiles.id, id)).get();
      if (!authFile) {
        return notFound("auth file not found");
      }
      const sourceInstance = db
        .select()
        .from(cpaInstances)
        .where(eq(cpaInstances.id, authFile.cpaInstanceId))
        .get();
      if (!sourceInstance) {
        return notFound("CPA instance not found");
      }

      await portalAuthFileToExceptionPool(sourceInstance, authFile);
      return okWithOptionalSync(await syncAffectedCpaInstances([sourceInstance.id]));
    }

    return ok(await refreshAuthFileQuotaById(id));
```

Remove the old duplicated `id` parsing and `refreshQuota` return below this block so `POST` has one path for each action.

- [ ] **Step 4: Run the auth-file route tests to verify they pass**

Run: `npm test -- src/app/api/auth-files/[id]/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/auth-files/[id]/route.ts' 'src/app/api/auth-files/[id]/route.test.ts'
git commit -m "feat: portal single auth file to exception pool"
```

---

### Task 4: Batch Portal API

**Files:**
- Modify: `src/app/api/cpa-instances/[id]/auth-files/batch/route.ts`
- Modify: `src/app/api/cpa-instances/[id]/auth-files/batch/route.test.ts`

- [ ] **Step 1: Write failing tests for batch portal**

Add this test after the existing batch delete test:

```ts
  it("portals selected abnormal auth files into the exception pool", async () => {
    const sqlite = await setupSqlite();
    const cpaInstanceId = insertInstance(sqlite);
    const firstId = insertAuthFile(sqlite, cpaInstanceId, "codex-first@example.com-auto.json");
    const secondId = insertAuthFile(sqlite, cpaInstanceId, "codex-second@example.com-auto.json", {
      rawJson: JSON.stringify({ email: "second@example.com", token: "local-token" }),
    });
    insertQuotaSnapshot(sqlite, cpaInstanceId, "codex-first@example.com-auto.json");
    insertQuotaSnapshot(sqlite, cpaInstanceId, "codex-second@example.com-auto.json");

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.downloadRemoteAuthFile)
      .mockResolvedValueOnce({ email: "first@example.com", token: "remote-token" })
      .mockRejectedValueOnce(new Error("download failed"));
    vi.mocked(cpaClient.deleteRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.POST(
      new Request("http://localhost/api/cpa-instances/1/auth-files/batch", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action: "portalExceptions",
          authFileIds: [firstId, secondId],
        }),
      }),
      { params: Promise.resolve({ id: String(cpaInstanceId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      processed: 2,
      action: "portalExceptions",
    });
    expect(cpaClient.deleteRemoteAuthFile).toHaveBeenCalledTimes(2);
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_files").get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM quota_snapshots").get()).toMatchObject({ count: 0 });
    expect(
      sqlite.prepare("SELECT file_name, raw_json FROM exception_auth_files ORDER BY file_name").all(),
    ).toEqual([
      {
        file_name: "codex-first@example.com-auto.json",
        raw_json: JSON.stringify({ email: "first@example.com", token: "remote-token" }),
      },
      {
        file_name: "codex-second@example.com-auto.json",
        raw_json: JSON.stringify({ email: "second@example.com", token: "local-token" }),
      },
    ]);
  });
```

- [ ] **Step 2: Run the batch route tests to verify they fail**

Run: `npm test -- src/app/api/cpa-instances/[id]/auth-files/batch/route.test.ts`

Expected: FAIL because `portalExceptions` is not accepted.

- [ ] **Step 3: Implement `portalExceptions` in the batch route**

In `src/app/api/cpa-instances/[id]/auth-files/batch/route.ts`, update the action type:

```ts
type BatchAction = "delete" | "disable" | "autoAssignProxy" | "download" | "move" | "portalExceptions";
```

Import the shared helper:

```ts
import { portalAuthFileToExceptionPool } from "@/lib/exception-auth-files";
```

Update the validation condition and error string to include `portalExceptions`.

After the `move` branch and before the existing delete/disable branch, add:

```ts
    if (body.action === "portalExceptions") {
      const rows = loadSelectedAuthFiles(cpaInstanceId, body.authFileIds);
      if (rows instanceof Response) {
        return rows;
      }

      for (const authFile of rows) {
        await portalAuthFileToExceptionPool(instance, authFile);
      }

      return okWithOptionalSync({
        action: body.action,
        processed: rows.length,
        sync: await syncAffectedCpaInstance(cpaInstanceId),
      });
    }
```

- [ ] **Step 4: Run the batch route tests to verify they pass**

Run: `npm test -- src/app/api/cpa-instances/[id]/auth-files/batch/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/cpa-instances/[id]/auth-files/batch/route.ts' 'src/app/api/cpa-instances/[id]/auth-files/batch/route.test.ts'
git commit -m "feat: portal batch auth files to exception pool"
```

---

### Task 5: Exception Pool API Routes

**Files:**
- Create: `src/app/api/exception-auth-files/route.ts`
- Create: `src/app/api/exception-auth-files/route.test.ts`
- Create: `src/app/api/exception-auth-files/[id]/route.ts`
- Create: `src/app/api/exception-auth-files/[id]/route.test.ts`

- [ ] **Step 1: Write failing collection route tests**

Create `src/app/api/exception-auth-files/route.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/exception-auth-files", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-exception-auth-files-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    delete globalDb().cpaNexusSqlite;
  });

  afterEach(() => {
    globalDb().cpaNexusSqlite?.close();
    delete globalDb().cpaNexusSqlite;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("lists exception auth files newest first", async () => {
    const sqlite = await setupSqlite();
    insertExceptionAuthFile(sqlite, "older@example.com", "older.json", "2026-05-20T01:00:00.000Z");
    insertExceptionAuthFile(sqlite, "newer@example.com", "newer.json", "2026-05-21T01:00:00.000Z");
    const route = await import("./route");

    const response = await route.GET(new Request("http://localhost/api/exception-auth-files", {
      headers: authHeaders(),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      exceptionAuthFiles: [
        { email: "newer@example.com", fileName: "newer.json" },
        { email: "older@example.com", fileName: "older.json" },
      ],
    });
  });

  it("clears all exception auth files", async () => {
    const sqlite = await setupSqlite();
    insertExceptionAuthFile(sqlite, "a@example.com", "a.json");
    insertExceptionAuthFile(sqlite, "b@example.com", "b.json");
    const route = await import("./route");

    const response = await route.DELETE(new Request("http://localhost/api/exception-auth-files", {
      method: "DELETE",
      headers: authHeaders(),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", deleted: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM exception_auth_files").get()).toMatchObject({ count: 0 });
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertExceptionAuthFile(
  sqlite: Database.Database,
  email: string,
  fileName: string,
  createdAt = "2026-05-20T01:00:00.000Z",
) {
  sqlite
    .prepare(`
      INSERT INTO exception_auth_files (
        source_cpa_instance_name,
        file_name,
        email,
        last_error,
        raw_json,
        created_at,
        updated_at
      )
      VALUES ('source', @fileName, @email, 'bad token', @rawJson, @createdAt, @createdAt)
    `)
    .run({ email, fileName, rawJson: JSON.stringify({ email }), createdAt });
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
```

- [ ] **Step 2: Write failing item route tests**

Create `src/app/api/exception-auth-files/[id]/route.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

vi.mock("@/lib/cpa-client", () => ({
  uploadRemoteAuthFile: vi.fn(),
}));

vi.mock("@/lib/jobs", () => ({
  syncCpaInstanceById: vi.fn(),
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/exception-auth-files/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-exception-auth-file-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    delete globalDb().cpaNexusSqlite;
  });

  afterEach(() => {
    globalDb().cpaNexusSqlite?.close();
    delete globalDb().cpaNexusSqlite;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("deletes one exception auth file", async () => {
    const sqlite = await setupSqlite();
    const firstId = insertExceptionAuthFile(sqlite, "first@example.com", "first.json");
    insertExceptionAuthFile(sqlite, "second@example.com", "second.json");
    const route = await import("./route");

    const response = await route.DELETE(
      new Request("http://localhost/api/exception-auth-files/1", {
        method: "DELETE",
        headers: authHeaders(),
      }),
      { params: Promise.resolve({ id: String(firstId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(sqlite.prepare("SELECT file_name FROM exception_auth_files").all()).toEqual([
      { file_name: "second.json" },
    ]);
  });

  it("moves an exception auth file to a target CPA", async () => {
    const sqlite = await setupSqlite();
    const targetId = insertInstance(sqlite, "target", "https://target.example.com");
    const exceptionId = insertExceptionAuthFile(
      sqlite,
      "move@example.com",
      "move.json",
      JSON.stringify({ email: "move@example.com", refresh_token: "rt_move" }),
    );

    const cpaClient = await import("@/lib/cpa-client");
    const jobs = await import("@/lib/jobs");
    vi.mocked(cpaClient.uploadRemoteAuthFile).mockResolvedValue(undefined);
    vi.mocked(jobs.syncCpaInstanceById).mockResolvedValue({
      instance: "target",
      status: "success",
      message: "synced",
    });
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/exception-auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ targetCpaInstanceId: targetId }),
      }),
      { params: Promise.resolve({ id: String(exceptionId) }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(cpaClient.uploadRemoteAuthFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: targetId }),
      "move.json",
      { email: "move@example.com", refresh_token: "rt_move" },
    );
    expect(jobs.syncCpaInstanceById).toHaveBeenCalledWith(targetId);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM exception_auth_files").get()).toMatchObject({ count: 0 });
  });

  it("keeps the exception auth file when target CPA already has the same file name", async () => {
    const sqlite = await setupSqlite();
    const targetId = insertInstance(sqlite, "target", "https://target.example.com");
    const exceptionId = insertExceptionAuthFile(sqlite, "move@example.com", "move.json");
    insertAuthFile(sqlite, targetId, "move.json");

    const cpaClient = await import("@/lib/cpa-client");
    const route = await import("./route");

    const response = await route.PATCH(
      new Request("http://localhost/api/exception-auth-files/1", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ targetCpaInstanceId: targetId }),
      }),
      { params: Promise.resolve({ id: String(exceptionId) }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "target CPA already has auth file move.json",
    });
    expect(cpaClient.uploadRemoteAuthFile).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM exception_auth_files").get()).toMatchObject({ count: 1 });
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  return getSqlite();
}

function insertInstance(sqlite: Database.Database, name: string, baseUrl: string) {
  const result = sqlite
    .prepare(`
      INSERT INTO cpa_instances (name, base_url, password, quota_refresh_path, enabled)
      VALUES (@name, @baseUrl, 'secret', '/v0/management/auth-files', 1)
    `)
    .run({ name, baseUrl });
  return Number(result.lastInsertRowid);
}

function insertExceptionAuthFile(
  sqlite: Database.Database,
  email: string,
  fileName: string,
  rawJson = JSON.stringify({ email }),
) {
  const result = sqlite
    .prepare(`
      INSERT INTO exception_auth_files (
        source_cpa_instance_name,
        file_name,
        email,
        last_error,
        raw_json
      )
      VALUES ('source', @fileName, @email, 'bad token', @rawJson)
    `)
    .run({ email, fileName, rawJson });
  return Number(result.lastInsertRowid);
}

function insertAuthFile(sqlite: Database.Database, cpaInstanceId: number, fileName: string) {
  sqlite
    .prepare(`
      INSERT INTO auth_files (
        cpa_instance_id,
        file_name,
        email,
        provider,
        status,
        disabled,
        available,
        raw_json
      )
      VALUES (@cpaInstanceId, @fileName, 'move@example.com', 'codex', 'available', 0, 1, '{}')
    `)
    .run({ cpaInstanceId, fileName });
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
```

- [ ] **Step 3: Run the exception route tests to verify they fail**

Run: `npm test -- src/app/api/exception-auth-files/route.test.ts src/app/api/exception-auth-files/[id]/route.test.ts`

Expected: FAIL because the route files do not exist.

- [ ] **Step 4: Implement the collection route**

Create `src/app/api/exception-auth-files/route.ts`:

```ts
import { desc } from "drizzle-orm";

import { db } from "@/db/client";
import { exceptionAuthFiles } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const rows = db
      .select()
      .from(exceptionAuthFiles)
      .orderBy(desc(exceptionAuthFiles.createdAt), desc(exceptionAuthFiles.id))
      .all();

    return ok({ exceptionAuthFiles: rows });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const result = db.delete(exceptionAuthFiles).run();
    return ok({ status: "ok", deleted: result.changes });
  } catch (error) {
    return serverError(error);
  }
}
```

- [ ] **Step 5: Implement the item route**

Create `src/app/api/exception-auth-files/[id]/route.ts`:

```ts
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { exceptionAuthFiles } from "@/db/schema";
import {
  badRequest,
  initRequestDb,
  notFound,
  ok,
  parseIntegerId,
  readJson,
  requireAuth,
  routeParams,
  serverError,
} from "@/lib/api";
import {
  loadExceptionAuthFile,
  loadTargetCpaInstance,
  moveExceptionAuthFileToCpa,
} from "@/lib/exception-auth-files";
import { syncCpaInstanceById, type CpaInstanceSyncResult } from "@/lib/jobs";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const id = parseIntegerId((await routeParams(context)).id);
    if (!id) {
      return badRequest("invalid id");
    }

    const result = db.delete(exceptionAuthFiles).where(eq(exceptionAuthFiles.id, id)).run();
    if (result.changes === 0) {
      return notFound("exception auth file not found");
    }

    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const id = parseIntegerId((await routeParams(context)).id);
    if (!id) {
      return badRequest("invalid id");
    }

    const body = await readJson<{ targetCpaInstanceId?: number }>(request);
    if (!body.targetCpaInstanceId) {
      return badRequest("target CPA instance is required");
    }

    const row = loadExceptionAuthFile(id);
    if (!row) {
      return notFound("exception auth file not found");
    }

    const targetInstance = loadTargetCpaInstance(body.targetCpaInstanceId);
    if (!targetInstance) {
      return notFound("target CPA instance not found");
    }
    if (!targetInstance.enabled) {
      return badRequest("target CPA instance is disabled");
    }

    try {
      await moveExceptionAuthFileToCpa(row, targetInstance);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }

    return okWithOptionalSync({
      status: "ok",
      sync: await syncAffectedCpaInstance(targetInstance.id),
    });
  } catch (error) {
    return serverError(error);
  }
}

async function syncAffectedCpaInstance(cpaInstanceId: number) {
  try {
    return await syncCpaInstanceById(cpaInstanceId);
  } catch (error) {
    return {
      instance: `CPA #${cpaInstanceId}`,
      status: "error" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function okWithOptionalSync(result: { status: "ok"; sync: CpaInstanceSyncResult }) {
  return ok(
    result.sync.status === "error"
      ? { status: "ok", sync: result.sync }
      : { status: "ok" },
  );
}
```

- [ ] **Step 6: Run the exception route tests to verify they pass**

Run: `npm test -- src/app/api/exception-auth-files/route.test.ts src/app/api/exception-auth-files/[id]/route.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/exception-auth-files src/lib/exception-auth-files.ts src/app/api/exception-auth-files/route.test.ts 'src/app/api/exception-auth-files/[id]/route.test.ts'
git commit -m "feat: add exception auth file APIs"
```

---

### Task 6: Dashboard UI And Client Actions

**Files:**
- Modify: `src/components/cpa-dashboard.tsx`
- Modify: `src/app/[section]/page.tsx`

- [ ] **Step 1: Add client types and navigation**

In `src/components/cpa-dashboard.tsx`, add `ArchiveX` and `Download` to the lucide import list.

Add this type after `AuthFile`:

```ts
type ExceptionAuthFile = {
  id: number;
  sourceCpaInstanceId: number | null;
  sourceCpaInstanceName: string;
  fileName: string;
  email: string | null;
  lastError: string | null;
  rawJson: string;
  createdAt: string;
  updatedAt: string;
};
```

Add the nav item:

```ts
  { id: "exceptions", label: "异常账号", icon: ArchiveX, href: "/exceptions" },
```

Update `src/app/[section]/page.tsx` to include `"exceptions"` in the `sections` set.

- [ ] **Step 2: Add dashboard state and load data**

In `CpaDashboard`, add:

```ts
  const [exceptionAuthFiles, setExceptionAuthFiles] = useState<ExceptionAuthFile[]>([]);
```

In `loadAll`, add the fetch:

```ts
          fetchJson<{ exceptionAuthFiles: ExceptionAuthFile[] }>("/api/exception-auth-files"),
```

Assign it in the Promise result list and set state:

```ts
      setExceptionAuthFiles(exceptionRes.exceptionAuthFiles);
```

- [ ] **Step 3: Add client actions**

Add these functions inside `CpaDashboard` near the existing auth-file actions:

```ts
  async function portalExceptionAuthFile(id: number) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables([sourceCpaInstanceId], async () => {
        await mutate(`/api/auth-files/${id}`, {
          method: "POST",
          body: JSON.stringify({ action: "portalException" }),
        });
        toast.success("账号已清理到异常账号");
        await loadAll();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteExceptionAuthFile(id: number) {
    try {
      await mutate(`/api/exception-auth-files/${id}`, { method: "DELETE" });
      toast.success("异常账号已删除");
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function clearExceptionAuthFiles() {
    try {
      const result = await mutate<{ deleted: number }>("/api/exception-auth-files", { method: "DELETE" });
      toast.success(`已清空 ${result.deleted} 个异常账号`);
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function moveExceptionAuthFile(id: number, targetCpaInstanceId: number) {
    try {
      await withUpdatingCpaTables([targetCpaInstanceId], async () => {
        await mutate(`/api/exception-auth-files/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ targetCpaInstanceId }),
        });
        toast.success("异常账号已移动");
        await loadAll();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  function exportExceptionAuthFileEmails() {
    const csv = exceptionAuthFiles
      .map((row) => row.email?.trim() ?? "")
      .filter((email) => email.length > 0)
      .map(csvCell)
      .join("\n");
    downloadBlob(
      new Blob([csv ? `${csv}\n` : ""], { type: "text/csv;charset=utf-8" }),
      `exception-auth-emails-${formatDownloadTimestamp(new Date())}.csv`,
    );
  }
```

Add a `csvCell` helper near `downloadBlob`:

```ts
function csvCell(value: string) {
  return /[",\n\r]/.test(value)
    ? `"${value.replaceAll("\"", "\"\"")}"`
    : value;
}
```

- [ ] **Step 4: Wire the exception page**

In the main render, add:

```tsx
            {activeSection === "exceptions" ? (
              <ExceptionAuthFilesSection
                rows={exceptionAuthFiles}
                instances={instances.filter((instance) => instance.enabled)}
                onExport={exportExceptionAuthFileEmails}
                onClear={clearExceptionAuthFiles}
                onDelete={deleteExceptionAuthFile}
                onMove={moveExceptionAuthFile}
              />
            ) : null}
```

Create `ExceptionAuthFilesSection` below `AuthFilesSection`:

```tsx
function ExceptionAuthFilesSection({
  rows,
  instances,
  onExport,
  onClear,
  onDelete,
  onMove,
}: {
  rows: ExceptionAuthFile[];
  instances: CpaInstance[];
  onExport: () => void;
  onClear: () => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onMove: (id: number, targetCpaInstanceId: number) => Promise<void>;
}) {
  const [deleteTarget, setDeleteTarget] = useState<ExceptionAuthFile | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<ExceptionAuthFile | null>(null);
  const [moveTargetInstanceId, setMoveTargetInstanceId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function openMoveDialog(row: ExceptionAuthFile) {
    const firstTarget = instances[0];
    setMoveTarget(row);
    setMoveTargetInstanceId(firstTarget ? String(firstTarget.id) : "");
  }

  async function submitMove() {
    if (!moveTarget || !moveTargetInstanceId) {
      return;
    }
    setSubmitting(true);
    try {
      await onMove(moveTarget.id, Number(moveTargetInstanceId));
      setMoveTarget(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">异常账号池</h2>
            <p className="text-sm text-muted-foreground">共 {rows.length} 个异常账号</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={rows.length === 0} onClick={onExport}>
              <Download className="h-4 w-4" />
              导出
            </Button>
            <Button type="button" size="sm" variant="destructive" disabled={rows.length === 0} onClick={() => setClearOpen(true)}>
              <Trash2 className="h-4 w-4" />
              删除全部
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邮箱</TableHead>
                <TableHead>文件名</TableHead>
                <TableHead>添加时间</TableHead>
                <TableHead>上次报错信息</TableHead>
                <TableHead>来源 CPA</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    暂无异常账号
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[16rem] truncate font-medium">{row.email ?? "-"}</TableCell>
                    <TableCell className="max-w-[18rem] truncate">{row.fileName}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(row.createdAt)}</TableCell>
                    <TableCell className="max-w-[20rem] truncate">{row.lastError ?? "-"}</TableCell>
                    <TableCell className="max-w-[14rem] truncate">{row.sourceCpaInstanceName}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={instances.length === 0}
                          onClick={() => openMoveDialog(row)}
                        >
                          移动
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                          onClick={() => setDeleteTarget(row)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除全部异常账号</DialogTitle>
            <DialogDescription>确定要清空异常账号池中的 {rows.length} 条记录吗？</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setClearOpen(false)}>取消</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setClearOpen(false);
                void onClear();
              }}
            >
              删除全部
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除异常账号</DialogTitle>
            <DialogDescription>
              确定要删除 {deleteTarget?.email ?? deleteTarget?.fileName ?? "这条记录"} 吗？这个操作只删除异常账号池记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) {
                  void onDelete(target.id);
                }
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveTarget !== null} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动异常账号</DialogTitle>
            <DialogDescription>选择目标 CPA。确认后会上传认证文件到目标 CPA，并从异常账号池移除。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="exception-auth-target-cpa">目标 CPA</Label>
            <select
              id="exception-auth-target-cpa"
              className={cn(compactControlClassName, "w-full")}
              value={moveTargetInstanceId}
              onChange={(event) => setMoveTargetInstanceId(event.target.value)}
            >
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>{instance.name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMoveTarget(null)}>取消</Button>
            <Button type="button" disabled={!moveTargetInstanceId || submitting} onClick={() => void submitMove()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              移动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 5: Change batch abnormal cleanup to portal**

Update `type BatchExceptionAction`:

```ts
type BatchExceptionAction = "delete" | "disable" | "portalExceptions";
```

In the batch menu item for `批量清理异常账号`, set:

```ts
action: "portalExceptions",
confirmVerb: "清理",
successVerb: "已清理到异常账号",
```

In `batchHandleExceptionAuthFiles`, update the mutate result type and request body to accept the new action. Keep Free号 cleanup and 已停用账号 deletion using `action: "delete"`.

In the batch confirm dialog, use destructive styling for `portalExceptions` and show this helper text:

```tsx
清理会先保存认证文件到异常账号池，再从 CPA 中移除认证文件和本地账号记录。
```

- [ ] **Step 6: Add single-row 清理 and normalize 删除 color**

In `CompactAuthFileTable` props, add:

```ts
  onRequestPortalException: (row: AuthFileQuotaRow) => void;
```

Pass it from `AuthFilesSection`:

```tsx
onRequestPortalException={(row) => void onPortalExceptionAuthFile(row.id)}
```

Add `onPortalExceptionAuthFile` to `AuthFilesSection` props and pass `portalExceptionAuthFile` from `CpaDashboard`.

In the row action menu:

1. Increase `menuHeight` from `166` to `202`.
2. Change the `删除` button class to normal menu colors:

```ts
className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
```

3. Add a red `清理` button after `删除`:

```tsx
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                onClick={() => {
                                  setOpenActionRowId(null);
                                  onRequestPortalException(row);
                                }}
                              >
                                清理
                              </button>
```

- [ ] **Step 7: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/cpa-dashboard.tsx 'src/app/[section]/page.tsx'
git commit -m "feat: add exception auth file dashboard"
```

---

### Task 7: Full Verification

**Files:**
- All changed files

- [ ] **Step 1: Run targeted API and helper tests**

Run:

```bash
npm test -- \
  src/db/migrate.test.ts \
  src/lib/exception-auth-files.test.ts \
  src/app/api/auth-files/[id]/route.test.ts \
  src/app/api/cpa-instances/[id]/auth-files/batch/route.test.ts \
  src/app/api/exception-auth-files/route.test.ts \
  src/app/api/exception-auth-files/[id]/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Run a production build**

Run: `npm run build`

Expected: PASS. This verifies the Next.js 16 App Router route/page typing, including async route params.

- [ ] **Step 5: Start the dev server for manual UI verification**

Run: `npm run dev`

Expected: server prints a local URL, usually `http://localhost:3000`.

Manual checks:

- Open `/exceptions`; confirm left nav has「异常账号」and the page title is「异常账号」.
- In `/auth`, open a CPA row menu; confirm「删除」is normal color and「清理」is red.
- In the CPA batch menu, confirm「批量清理异常账号」still appears and opens a dialog explaining it will save to the exception pool.
- Use one known abnormal row to click「清理」; confirm it disappears from `/auth` and appears in `/exceptions`.
- In `/exceptions`, click「导出」; confirm the CSV contains one email per line.
- In `/exceptions`, move a row to a target CPA; confirm it disappears from `/exceptions` and the target CPA refreshes.

- [ ] **Step 6: Stop the dev server**

Stop the `npm run dev` session with Ctrl-C after manual verification.

- [ ] **Step 7: Final commit if verification fixes were needed**

If Task 7 required fixes, commit them:

```bash
git add .
git commit -m "fix: polish exception auth file flow"
```

If no fixes were needed, do not create an empty commit.
