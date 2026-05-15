import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionCookieHeader } from "@/lib/auth";

const originalDatabaseUrl = process.env.DATABASE_URL;
let tempDir: string | null = null;

describe("/api/data-board", () => {
  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "cpa-nexus-data-board-route-"));
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

  it("returns data board metrics for all enabled CPA instances by default", async () => {
    await setupSqlite();
    const route = await import("./route");

    const response = await route.GET(
      new Request("http://localhost/api/data-board", {
        headers: authHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cpaInstances: [
        { id: 1, name: "alpha", enabled: true },
        { id: 2, name: "beta", enabled: true },
      ],
      selectedCpaInstanceIds: [1, 2],
      stats: {
        accountCount: 3,
        availableAccountCount: 2,
        availableRate: 67,
        proxyCount: 2,
        average5hRemainingPercent: 45,
        averageWeekRemainingPercent: 30,
      },
      series: [
        {
          capturedAt: "2026-05-15T10:00:00.000Z",
          accountCount: 2,
          availableAccountCount: 1,
          average5hRemainingPercent: 80,
        },
        {
          capturedAt: "2026-05-15T11:00:00.000Z",
          accountCount: 5,
          availableAccountCount: 4,
          average5hRemainingPercent: 70,
        },
      ],
    });
  });

  it("filters data board metrics by any selected CPA instances", async () => {
    await setupSqlite();
    const route = await import("./route");

    const response = await route.GET(
      new Request("http://localhost/api/data-board?cpaInstanceIds=2,999", {
        headers: authHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      selectedCpaInstanceIds: [2],
      stats: {
        accountCount: 1,
        availableAccountCount: 1,
        availableRate: 100,
        proxyCount: 2,
        average5hRemainingPercent: 20,
        averageWeekRemainingPercent: 0,
      },
      series: [
        {
          capturedAt: "2026-05-15T11:00:00.000Z",
          accountCount: 3,
          availableAccountCount: 3,
          average5hRemainingPercent: 60,
        },
      ],
    });
  });

  it("filters only trend series by selected time range", async () => {
    await setupSqlite();
    const route = await import("./route");

    const response = await route.GET(
      new Request(
        "http://localhost/api/data-board?startAt=2026-05-15T10%3A30%3A00.000Z&endAt=2026-05-15T11%3A30%3A00.000Z",
        {
          headers: authHeaders(),
        },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      selectedCpaInstanceIds: [1, 2],
      stats: {
        accountCount: 3,
        availableAccountCount: 2,
        availableRate: 67,
      },
      series: [
        {
          capturedAt: "2026-05-15T11:00:00.000Z",
          accountCount: 3,
          availableAccountCount: 3,
          average5hRemainingPercent: 60,
        },
      ],
    });
  });

  it("limits returned trend series to 5000 aggregated points", async () => {
    const sqlite = await setupSqlite();
    insertLongSnapshotSeries(sqlite, 1, 5002);
    const route = await import("./route");

    const response = await route.GET(
      new Request("http://localhost/api/data-board?cpaInstanceIds=1", {
        headers: authHeaders(),
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { series: unknown[] };
    expect(payload.series).toHaveLength(5000);
  });
});

async function setupSqlite() {
  const { migrate } = await import("@/db/migrate");
  const { getSqlite } = await import("@/db/client");
  migrate();
  const sqlite = getSqlite();
  seedData(sqlite);
  return sqlite;
}

function seedData(sqlite: Database.Database) {
  sqlite.exec(`
    INSERT INTO cpa_instances (id, name, base_url, password, quota_refresh_path, enabled)
    VALUES
      (1, 'alpha', 'https://alpha.example.com', 'secret', '/v0/management/auth-files', 1),
      (2, 'beta', 'https://beta.example.com', 'secret', '/v0/management/auth-files', 1),
      (3, 'disabled', 'https://disabled.example.com', 'secret', '/v0/management/auth-files', 0);

    INSERT INTO auth_files (cpa_instance_id, file_name, email, available)
    VALUES
      (1, 'a.json', 'a@example.com', 1),
      (1, 'b.json', 'b@example.com', 0),
      (2, 'c.json', 'c@example.com', 1),
      (3, 'd.json', 'd@example.com', 1);

    INSERT INTO quota_snapshots (
      cpa_instance_id,
      auth_file_name,
      email,
      usage_5h_percent,
      usage_week_percent,
      available,
      captured_at
    )
    VALUES
      (1, 'a.json', 'a@example.com', 20, 30, 1, '2026-05-15T11:00:00.000Z'),
      (1, 'b.json', 'b@example.com', 40, 50, 0, '2026-05-15T11:00:00.000Z'),
      (2, 'c.json', 'c@example.com', 80, 100, 1, '2026-05-15T11:00:00.000Z'),
      (3, 'd.json', 'd@example.com', 0, 0, 1, '2026-05-15T11:00:00.000Z');

    INSERT INTO proxies (id, name, url, enabled)
    VALUES
      (1, 'proxy-a', 'http://proxy-a.example.com', 1),
      (2, 'proxy-b', 'http://proxy-b.example.com', 1),
      (3, 'proxy-disabled', 'http://proxy-disabled.example.com', 0);

    INSERT INTO proxy_cpa_instances (proxy_id, cpa_instance_id)
    VALUES
      (1, 1),
      (1, 2),
      (2, 2),
      (3, 1);

    INSERT INTO dashboard_metric_snapshots (
      cpa_instance_id,
      account_count,
      available_account_count,
      average_5h_remaining_percent,
      average_week_remaining_percent,
      proxy_count,
      captured_at
    )
    VALUES
      (1, 2, 1, 80, 70, 1, '2026-05-15T10:00:00.000Z'),
      (2, 3, 3, 60, 40, 2, '2026-05-15T11:00:00.000Z');
  `);
}

function authHeaders() {
  return { cookie: createSessionCookieHeader() };
}

function insertLongSnapshotSeries(
  sqlite: Database.Database,
  cpaInstanceId: number,
  count: number,
) {
  const insert = sqlite.prepare(`
    INSERT INTO dashboard_metric_snapshots (
      cpa_instance_id,
      account_count,
      available_account_count,
      average_5h_remaining_percent,
      average_week_remaining_percent,
      proxy_count,
      captured_at
    )
    VALUES (?, 10, 8, 80, 70, 1, ?)
  `);
  const start = Date.parse("2026-05-15T12:00:00.000Z");

  sqlite.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      insert.run(cpaInstanceId, new Date(start + index * 1000).toISOString());
    }
  })();
}

function globalDb() {
  return globalThis as unknown as {
    cpaNexusSqlite?: Database.Database;
  };
}
