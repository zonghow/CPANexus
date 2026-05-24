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
