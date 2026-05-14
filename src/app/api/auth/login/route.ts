import { ok, readJson, unauthorized } from "@/lib/api";
import { createSessionSetCookieHeader, verifyAdminPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readJson<{ password?: string }>(request);
  if (!verifyAdminPassword(body.password)) {
    return unauthorized("密码不正确");
  }

  return ok(
    { status: "ok" },
    {
      headers: {
        "set-cookie": createSessionSetCookieHeader(),
      },
    },
  );
}
