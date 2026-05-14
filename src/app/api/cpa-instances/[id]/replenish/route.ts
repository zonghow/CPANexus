import {
  badRequest,
  initRequestDb,
  ok,
  parseIntegerId,
  readJson,
  requireAuth,
  routeParams,
  serverError,
} from "@/lib/api";
import { manualReplenishCpaInstance } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(
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
      return badRequest("CPA instance id is required");
    }

    const body = await readJson<{ count?: number; backupAccountIds?: number[] }>(request);
    const backupAccountIds = Array.isArray(body.backupAccountIds)
      ? body.backupAccountIds.filter((accountId) => Number.isInteger(accountId) && accountId > 0)
      : [];
    const count = Number(body.count);

    if (backupAccountIds.length === 0 && (!Number.isInteger(count) || count <= 0)) {
      return badRequest("count or backupAccountIds is required");
    }

    const result = await manualReplenishCpaInstance(id, {
      backupAccountIds,
      count: backupAccountIds.length > 0 ? backupAccountIds.length : count,
    });

    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
