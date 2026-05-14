import { initRequestDb, ok, requireAuth, routeParams, serverError } from "@/lib/api";
import { runJobByKey } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const { key } = await routeParams(context);
    const result = await runJobByKey(decodeURIComponent(key));
    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
