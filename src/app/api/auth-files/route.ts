import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { authFiles, cpaInstances } from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const instances = db.select().from(cpaInstances).orderBy(cpaInstances.name).all();
    const groups = instances.map((instance) => ({
      instance,
      authFiles: db
        .select()
        .from(authFiles)
        .where(eq(authFiles.cpaInstanceId, instance.id))
        .orderBy(authFiles.fileName)
        .all(),
    }));

    return ok({ groups });
  } catch (error) {
    return serverError(error);
  }
}
