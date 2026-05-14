import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { backupAccounts, cpaInstances } from "@/db/schema";
import { badRequest, initRequestDb, ok, readJson, requireAuth, serverError } from "@/lib/api";
import { parseBackupAccountLines } from "@/lib/replacement-accounts";

export const runtime = "nodejs";

const importSchema = z.object({
  text: z.string(),
});

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const accounts = db
      .select()
      .from(backupAccounts)
      .orderBy(desc(backupAccounts.importedAt))
      .all();
    const instances = db.select().from(cpaInstances).all();

    return ok({
      accounts: accounts.map((account) => ({
        ...account,
        ownerName:
          instances.find((instance) => instance.id === account.assignedCpaInstanceId)?.name ??
          null,
      })),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const parsed = importSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const result = parseBackupAccountLines(parsed.data.text);
    const now = new Date().toISOString();
    let imported = 0;
    let skipped = 0;

    for (const account of result.valid) {
      const insert = db
        .insert(backupAccounts)
        .values({
          sourceLine: account.sourceLine,
          email: account.email,
          refreshToken: account.refreshToken,
          importedAt: now,
        })
        .onConflictDoNothing()
        .run();
      if (insert.changes > 0) {
        imported += 1;
      } else {
        skipped += 1;
      }
    }

    return ok({
      imported,
      skipped,
      invalid: result.invalid,
    });
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
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return badRequest("id is required");
    }
    db.delete(backupAccounts)
      .where(eq(backupAccounts.id, id))
      .run();
    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const body = await readJson<{ id: number; clearAssignment?: boolean; exception?: string | null }>(request);
    if (!body.id) {
      return badRequest("id is required");
    }
    if (body.clearAssignment) {
      db.update(backupAccounts)
        .set({
          status: "idle",
          assignedCpaInstanceId: null,
          assignedAuthFileName: null,
          assignedAt: null,
          exception: body.exception ?? null,
          lastCheckedAt: new Date().toISOString(),
        })
        .where(eq(backupAccounts.id, body.id))
        .run();
    } else {
      db.update(backupAccounts)
        .set({
          exception: body.exception ?? null,
          status: body.exception ? "error" : sql`status`,
          lastCheckedAt: new Date().toISOString(),
        })
        .where(eq(backupAccounts.id, body.id))
        .run();
    }

    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}
