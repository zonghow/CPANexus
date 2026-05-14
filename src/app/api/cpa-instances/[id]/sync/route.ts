import {
  badRequest,
  initRequestDb,
  ok,
  parseIntegerId,
  requireAuth,
  routeParams,
  serverError,
} from "@/lib/api";
import { syncCpaInstanceById } from "@/lib/jobs";

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
    const { id } = await routeParams(context);
    const cpaInstanceId = parseIntegerId(id);
    if (!cpaInstanceId) {
      return badRequest("invalid CPA instance id");
    }

    return ok(await syncCpaInstanceById(cpaInstanceId));
  } catch (error) {
    return serverError(error);
  }
}
