"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CpaOption = {
  id: number;
  name: string;
  enabled: boolean;
};

type DataBoardStats = {
  accountCount: number;
  availableAccountCount: number;
  availableRate: number;
  proxyCount: number;
  average5hRemainingPercent: number | null;
  averageWeekRemainingPercent: number | null;
};

type DataBoardSeriesPoint = DataBoardStats & {
  capturedAt: string;
};

type DataBoardResponse = {
  cpaInstances: CpaOption[];
  selectedCpaInstanceIds: number[];
  stats: DataBoardStats;
  series: DataBoardSeriesPoint[];
};

const quickTimeRanges = [
  { id: "10m", label: "10分钟", minutes: 10 },
  { id: "30m", label: "30分钟", minutes: 30 },
  { id: "1h", label: "1小时", minutes: 60 },
  { id: "3h", label: "3小时", minutes: 180 },
  { id: "5h", label: "5小时", minutes: 300 },
  { id: "today", label: "今天" },
] as const;

export function DataBoardSection({ refreshVersion }: { refreshVersion: number }) {
  const [data, setData] = useState<DataBoardResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [timeRange, setTimeRange] = useState(defaultTodayTimeRange);
  const [activeQuickRange, setActiveQuickRange] = useState<string | null>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = dataBoardQueryString(selectedIds, timeRange);

    fetch(`/api/data-board${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? response.statusText);
        }
        setError(null);
        setData(payload as DataBoardResponse);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [refreshVersion, selectedIds, timeRange]);

  const allMode = selectedIds.length === 0;
  const effectiveSelectedIds = data?.selectedCpaInstanceIds ?? [];
  const selectedLabel = useMemo(() => {
    if (!data) {
      return "加载中";
    }
    if (allMode) {
      return `全量启用 CPA（${effectiveSelectedIds.length} 个）`;
    }

    return `已选择 ${effectiveSelectedIds.length} 个 CPA`;
  }, [allMode, data, effectiveSelectedIds.length]);

  function toggleCpa(id: number) {
    setSelectedIds((current) => {
      if (current.length === 0) {
        return [id];
      }

      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      return next;
    });
    setLoading(true);
  }

  function resetCpaScope() {
    setSelectedIds([]);
    setLoading(true);
  }

  function applyQuickTimeRange(range: (typeof quickTimeRanges)[number]) {
    const now = new Date();
    const start = "minutes" in range
      ? new Date(now.getTime() - range.minutes * 60 * 1000)
      : startOfToday(now);

    setTimeRange({
      start: toDateTimeLocalValue(start),
      end: toDateTimeLocalValue(now),
    });
    setActiveQuickRange(range.id);
    setLoading(true);
  }

  function clearTimeRange() {
    setTimeRange({ start: "", end: "" });
    setActiveQuickRange(null);
    setLoading(true);
  }

  function updateTimeRange(key: "start" | "end", value: string) {
    setTimeRange((current) => ({ ...current, [key]: value }));
    setActiveQuickRange(null);
    setLoading(true);
  }

  return (
    <section className="space-y-3">
      <div className="space-y-3 rounded-md border bg-card p-3">
        <div className="flex flex-col gap-1">
          <div className="font-medium">数据范围</div>
          <div className="text-sm text-muted-foreground">{selectedLabel}</div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">CPA</div>
          <div className="flex max-h-28 flex-wrap gap-2 overflow-auto">
            <FilterTag active={allMode} onClick={resetCpaScope}>
              全部
            </FilterTag>
            {(data?.cpaInstances ?? []).map((instance) => (
              <FilterTag
                key={instance.id}
                active={!allMode && selectedIds.includes(instance.id)}
                onClick={() => toggleCpa(instance.id)}
              >
                {instance.name}
              </FilterTag>
            ))}
            {!loading && (data?.cpaInstances.length ?? 0) === 0 ? (
              <span className="px-2 py-1 text-sm text-muted-foreground">暂无启用 CPA</span>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="账号数量" value={data?.stats.accountCount ?? 0} sub={`${data?.stats.availableAccountCount ?? 0} 可用`} />
        <MetricCard label="可用率" value={`${data?.stats.availableRate ?? 0}%`} sub="当前范围" tone="emerald" />
        <MetricCard label="5h剩余" value={formatPercent(data?.stats.average5hRemainingPercent ?? null)} sub="CPA均值" tone="sky" />
        <MetricCard label="周剩余" value={formatPercent(data?.stats.averageWeekRemainingPercent ?? null)} sub="CPA均值" tone="amber" />
        <MetricCard label="代理" value={data?.stats.proxyCount ?? 0} sub="启用且适用" tone="violet" />
      </div>

      <div className="space-y-3 rounded-md border bg-card p-3">
        <div className="flex flex-col gap-1">
          <div className="font-medium">图表时间范围</div>
          <div className="text-sm text-muted-foreground">仅影响下方趋势图，顶部统计仍展示当前数据。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterTag active={!timeRange.start && !timeRange.end} onClick={clearTimeRange}>
            全部时间
          </FilterTag>
          {quickTimeRanges.map((range) => (
            <FilterTag
              key={range.id}
              active={activeQuickRange === range.id}
              onClick={() => applyQuickTimeRange(range)}
            >
              {range.label}
            </FilterTag>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,220px)_minmax(0,220px)]">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">开始时间</span>
            <Input
              type="datetime-local"
              value={timeRange.start}
              onChange={(event) => updateTimeRange("start", event.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">结束时间</span>
            <Input
              type="datetime-local"
              value={timeRange.end}
              onChange={(event) => updateTimeRange("end", event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <TrendChart
          title="5h剩余趋势"
          data={data?.series ?? []}
          dataKey="average5hRemainingPercent"
          stroke="#0284c7"
          percent
          loading={loading}
        />
        <TrendChart
          title="周剩余趋势"
          data={data?.series ?? []}
          dataKey="averageWeekRemainingPercent"
          stroke="#d97706"
          percent
          loading={loading}
        />
        <div className="xl:col-span-2">
          <TrendChart
            title="可用账号数量趋势"
            data={data?.series ?? []}
            dataKey="availableAccountCount"
            stroke="#059669"
            loading={loading}
          />
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  sub: string;
  tone?: "slate" | "emerald" | "amber" | "sky" | "violet";
}) {
  const toneClass = {
    slate: "text-foreground",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    sky: "text-sky-700",
    violet: "text-violet-700",
  }[tone];

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function TrendChart({
  title,
  data,
  dataKey,
  stroke,
  percent = false,
  loading,
}: {
  title: string;
  data: DataBoardSeriesPoint[];
  dataKey: keyof DataBoardSeriesPoint;
  stroke: string;
  percent?: boolean;
  loading: boolean;
}) {
  return (
    <Card size="sm" className="rounded-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[260px]">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              加载中
            </div>
          ) : data.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              暂无历史数据，等待下一次 CPA 同步后生成趋势
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 18, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="capturedAt"
                  minTickGap={28}
                  tickFormatter={formatChartTime}
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  domain={percent ? [0, 100] : [0, "auto"]}
                  tickFormatter={(value) => (percent ? `${value}%` : String(value))}
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  width={42}
                />
                <Tooltip
                  labelFormatter={(value) => formatChartLabel(String(value))}
                  formatter={(value) => [percent ? `${value}%` : value, title]}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey={dataKey}
                  name={title}
                  stroke={stroke}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterTag({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className={cn(
        "h-7 rounded-full px-3 text-xs",
        !active && "bg-background text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function formatPercent(value: number | null) {
  return value === null ? "-" : `${value}%`;
}

function dataBoardQueryString(
  selectedIds: number[],
  timeRange: { start: string; end: string },
) {
  const params = new URLSearchParams();
  if (selectedIds.length > 0) {
    params.set("cpaInstanceIds", selectedIds.join(","));
  }

  const startAt = dateTimeLocalToIso(timeRange.start);
  const endAt = dateTimeLocalToIso(timeRange.end);
  if (startAt) {
    params.set("startAt", startAt);
  }
  if (endAt) {
    params.set("endAt", endAt);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function dateTimeLocalToIso(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function startOfToday(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function defaultTodayTimeRange() {
  const now = new Date();
  return {
    start: toDateTimeLocalValue(startOfToday(now)),
    end: toDateTimeLocalValue(now),
  };
}

function formatChartTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatChartLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
