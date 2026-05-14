import { db } from "@/db/client";
import {
  authFiles,
  backupAccounts,
  cpaInstances,
  proxies,
  proxyCpaInstances,
  quotaSnapshots,
} from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";
import { summarizeDashboardStats } from "@/lib/dashboard-summary";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const stats = summarizeDashboardStats({
      cpaInstances: db.select().from(cpaInstances).all(),
      authFiles: db.select().from(authFiles).all(),
      quotaSnapshots: db.select().from(quotaSnapshots).all(),
      backupAccounts: db.select().from(backupAccounts).all(),
      proxies: db.select().from(proxies).all(),
      proxyCpaInstances: db.select().from(proxyCpaInstances).all(),
    });

    return ok({
      stats,
    });
  } catch (error) {
    return serverError(error);
  }
}
