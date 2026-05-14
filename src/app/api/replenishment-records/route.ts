import { desc } from "drizzle-orm";

import { db } from "@/db/client";
import { replenishmentRecords } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const records = db
      .select()
      .from(replenishmentRecords)
      .orderBy(desc(replenishmentRecords.createdAt))
      .limit(200)
      .all();

    return ok({ records });
  } catch (error) {
    return serverError(error);
  }
}
