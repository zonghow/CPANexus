import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/proxies", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-proxies-route-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    delete globalDb().cpaNexusSqlite;
  });

  afterEach(() => {
    globalDb().cpaNexusSqlite?.close();
    delete globalDb().cpaNexusSqlite;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("creates named proxies with a default account limit of 10", async () => {
    const { migrate } = await import("@/db/migrate");
    migrate();
    const route = await import("./route");

    const createResponse = await route.POST(
      new Request("http://localhost/api/proxies", {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "美国出口 01",
          url: "http://proxy.example.com:8080",
          enabled: true,
          cpaInstanceIds: [],
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      proxy: { name: string; maxAuthFiles: number };
    };
    expect(created.proxy).toMatchObject({
      name: "美国出口 01",
      maxAuthFiles: 10,
    });

    const listResponse = await route.GET(
      new Request("http://localhost/api/proxies", {
        headers: authHeaders(),
      }),
    );
    const listed = (await listResponse.json()) as {
      proxies: Array<{ name: string; maxAuthFiles: number }>;
    };

    expect(listed.proxies).toMatchObject([
      { name: "美国出口 01", maxAuthFiles: 10 },
    ]);
  });
});

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: {
      close: () => void;
    };
  };
}
