import { ok } from "@/lib/api";
import { clearSessionSetCookieHeader } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  return ok(
    { status: "ok" },
    {
      headers: {
        "set-cookie": clearSessionSetCookieHeader(),
      },
    },
  );
}
