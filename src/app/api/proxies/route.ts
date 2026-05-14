import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  cpaInstances,
  proxies,
  proxyCpaInstances,
} from "@/db/schema";
import { badRequest, initRequestDb, ok, readJson, requireAuth, serverError } from "@/lib/api";

export const runtime = "nodejs";

const proxySchema = z.object({
  name: z.string().trim().min(1),
  url: z.string().trim().url(),
  maxAuthFiles: z.number().int().min(1).default(10),
  enabled: z.boolean().default(true),
  notes: z.string().optional().nullable(),
  cpaInstanceIds: z.array(z.number().int().positive()).default([]),
});

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const allProxies = db.select().from(proxies).orderBy(proxies.name).all();
    const allLinks = db.select().from(proxyCpaInstances).all();
    const instances = db.select().from(cpaInstances).orderBy(cpaInstances.name).all();

    return ok({
      proxies: allProxies.map((proxy) => ({
        ...proxy,
        cpaInstanceIds: allLinks
          .filter((link) => link.proxyId === proxy.id)
          .map((link) => link.cpaInstanceId),
      })),
      instances,
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const parsed = proxySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? "invalid request");
    }

    const now = new Date().toISOString();
    const proxy = db
      .insert(proxies)
      .values({
        name: parsed.data.name,
        url: parsed.data.url,
        maxAuthFiles: parsed.data.maxAuthFiles,
        enabled: parsed.data.enabled,
        notes: parsed.data.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    replaceProxyLinks(proxy.id, parsed.data.cpaInstanceIds);
    return ok({ proxy }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

function replaceProxyLinks(proxyId: number, cpaInstanceIds: number[]) {
  db.delete(proxyCpaInstances)
    .where(eq(proxyCpaInstances.proxyId, proxyId))
    .run();
  if (cpaInstanceIds.length === 0) {
    return;
  }
  db.insert(proxyCpaInstances)
    .values(cpaInstanceIds.map((cpaInstanceId) => ({ proxyId, cpaInstanceId })))
    .onConflictDoNothing()
    .run();
}
