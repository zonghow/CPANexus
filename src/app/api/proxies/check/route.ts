import { db } from "@/db/client";
import { proxies } from "@/db/schema";
import { checkProxyUrl } from "@/lib/proxy-check";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

const proxyCheckConcurrency = 6;

type ProxyCheckApiResult = {
  proxyId: number;
  ok: boolean;
  latencyMs: number | null;
  message: string;
  checkedAt: string;
};

export async function POST(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const rows = db.select().from(proxies).orderBy(proxies.name).all();
    const results: ProxyCheckApiResult[] = [];

    for (let index = 0; index < rows.length; index += proxyCheckConcurrency) {
      const batch = rows.slice(index, index + proxyCheckConcurrency);
      results.push(
        ...(await Promise.all(
          batch.map(async (proxy) => {
            const result = await checkProxyUrl(proxy.url);
            return {
              proxyId: proxy.id,
              ...result,
              checkedAt: new Date().toISOString(),
            };
          }),
        )),
      );
    }

    return ok({ results });
  } catch (error) {
    return serverError(error);
  }
}
