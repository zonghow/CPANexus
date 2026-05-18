import {
  badRequest,
  initRequestDb,
  ok,
  parseIntegerId,
  requireAuth,
  routeParams,
  serverError,
} from "@/lib/api";
import { sendTestMessagePushPolicy } from "@/lib/message-push";

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
    const { id: rawId } = await routeParams(context);
    const id = parseIntegerId(rawId);
    if (!id) {
      return badRequest("invalid id");
    }

    await sendTestMessagePushPolicy(id);
    return ok({ status: "ok" });
  } catch (error) {
    return serverError(error);
  }
}
