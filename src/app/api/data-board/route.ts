import { and, asc, gte, lte } from "drizzle-orm";

import { db } from "@/db/client";
import {
  authFiles,
  cpaInstances,
  dashboardMetricSnapshots,
  proxies,
  proxyCpaInstances,
  quotaSnapshots,
} from "@/db/schema";
import { initRequestDb, ok, requireAuth, serverError } from "@/lib/api";
import { buildDataBoardSeries, limitDataBoardSeries, summarizeDataBoard } from "@/lib/data-board";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const auth = requireAuth(request);
    if (auth) {
      return auth;
    }

    initRequestDb();
    const selectedCpaInstanceIds = parseSelectedCpaInstanceIds(request.url);
    const timeRange = parseTimeRange(request.url);
    const instances = db.select().from(cpaInstances).orderBy(cpaInstances.name).all();
    const stats = summarizeDataBoard(
      {
        cpaInstances: instances,
        authFiles: db.select().from(authFiles).all(),
        quotaSnapshots: db.select().from(quotaSnapshots).all(),
        proxies: db.select().from(proxies).all(),
        proxyCpaInstances: db.select().from(proxyCpaInstances).all(),
      },
      selectedCpaInstanceIds,
    );
    const series = limitDataBoardSeries(buildDataBoardSeries(
      {
        cpaInstances: instances,
        snapshots: loadMetricSnapshots(timeRange),
      },
      selectedCpaInstanceIds,
    ));
    const { selectedCpaInstanceIds: resolvedSelectedIds, ...statValues } = stats;

    return ok({
      cpaInstances: instances.filter((instance) => instance.enabled),
      selectedCpaInstanceIds: resolvedSelectedIds,
      stats: statValues,
      series,
    });
  } catch (error) {
    return serverError(error);
  }
}

function parseSelectedCpaInstanceIds(url: string) {
  const value = new URL(url).searchParams.get("cpaInstanceIds");
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function parseTimeRange(url: string) {
  const searchParams = new URL(url).searchParams;
  return {
    startAt: validIsoOrNull(searchParams.get("startAt")),
    endAt: validIsoOrNull(searchParams.get("endAt")),
  };
}

function validIsoOrNull(value: string | null) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return null;
  }

  return new Date(time).toISOString();
}

function inTimeRange(
  range: { startAt: string | null; endAt: string | null },
) {
  if (range.startAt && range.endAt) {
    return and(
      gte(dashboardMetricSnapshots.capturedAt, range.startAt),
      lte(dashboardMetricSnapshots.capturedAt, range.endAt),
    );
  }
  if (range.startAt) {
    return gte(dashboardMetricSnapshots.capturedAt, range.startAt);
  }
  if (range.endAt) {
    return lte(dashboardMetricSnapshots.capturedAt, range.endAt);
  }

  return null;
}

function loadMetricSnapshots(range: { startAt: string | null; endAt: string | null }) {
  const condition = inTimeRange(range);
  if (!condition) {
    return db
      .select()
      .from(dashboardMetricSnapshots)
      .orderBy(asc(dashboardMetricSnapshots.capturedAt))
      .all();
  }

  return db
    .select()
    .from(dashboardMetricSnapshots)
    .where(condition)
    .orderBy(asc(dashboardMetricSnapshots.capturedAt))
    .all();
}
