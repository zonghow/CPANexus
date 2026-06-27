"use client";

import { Loader2, RefreshCw, Save, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  configurableSubscriptionLabels,
  configurableSubscriptionTypes,
  type ConfigurableSubscriptionType,
} from "@/lib/subscription";

type SubscriptionQuota = {
  subscriptionType: ConfigurableSubscriptionType;
  usage5hDollars: number | null;
  usageWeekDollars: number | null;
};

type QuotaFormRow = {
  subscriptionType: ConfigurableSubscriptionType;
  usage5hDollars: string;
  usageWeekDollars: string;
};

function toFormRows(quotas: SubscriptionQuota[]): QuotaFormRow[] {
  const byType = new Map(quotas.map((quota) => [quota.subscriptionType, quota]));
  return configurableSubscriptionTypes.map((subscriptionType) => {
    const quota = byType.get(subscriptionType);
    return {
      subscriptionType,
      usage5hDollars:
        quota?.usage5hDollars != null ? String(quota.usage5hDollars) : "",
      usageWeekDollars:
        quota?.usageWeekDollars != null ? String(quota.usageWeekDollars) : "",
    };
  });
}

function parseDollar(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

export function QuotaSettingsSection() {
  const [rows, setRows] = useState<QuotaFormRow[]>(() => toFormRows([]));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/subscription-quotas", {
        cache: "no-store",
      });
      const payload = (await response.json()) as { quotas?: SubscriptionQuota[] };
      if (!response.ok) {
        throw new Error("加载额度设置失败");
      }
      setRows(toFormRows(payload.quotas ?? []));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const hasInvalid = useMemo(
    () =>
      rows.some(
        (row) =>
          (row.usage5hDollars.trim() !== "" &&
            parseDollar(row.usage5hDollars) === null) ||
          (row.usageWeekDollars.trim() !== "" &&
            parseDollar(row.usageWeekDollars) === null),
      ),
    [rows],
  );

  function updateRow(
    subscriptionType: ConfigurableSubscriptionType,
    field: "usage5hDollars" | "usageWeekDollars",
    value: string,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.subscriptionType === subscriptionType
          ? { ...row, [field]: value }
          : row,
      ),
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (hasInvalid) {
      toast.error("请填写有效的非负数金额");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/subscription-quotas", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quotas: rows.map((row) => ({
            subscriptionType: row.subscriptionType,
            usage5hDollars: parseDollar(row.usage5hDollars),
            usageWeekDollars: parseDollar(row.usageWeekDollars),
          })),
        }),
      });
      const payload = (await response.json()) as {
        quotas?: SubscriptionQuota[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "保存额度设置失败");
      }
      setRows(toFormRows(payload.quotas ?? []));
      toast.success("额度设置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Wallet className="h-5 w-5" />
            额度设置
          </h2>
          <p className="text-sm text-muted-foreground">
            为各订阅类型设置 5h 与周的额度（单位：$）。设置后，账号管理页面的 5h
            与周平均剩余会按账号类型对应的额度加权计算，更精准。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading || saving}
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          刷新
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">订阅类型</TableHead>
                <TableHead>5h 额度（$）</TableHead>
                <TableHead>周额度（$）</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.subscriptionType}>
                  <TableCell className="font-medium">
                    {configurableSubscriptionLabels[row.subscriptionType]}
                  </TableCell>
                  <TableCell>
                    <DollarInput
                      value={row.usage5hDollars}
                      disabled={loading || saving}
                      onChange={(value) =>
                        updateRow(row.subscriptionType, "usage5hDollars", value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <DollarInput
                      value={row.usageWeekDollars}
                      disabled={loading || saving}
                      onChange={(value) =>
                        updateRow(
                          row.subscriptionType,
                          "usageWeekDollars",
                          value,
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={loading || saving || hasInvalid}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            保存
          </Button>
          <span className="text-xs text-muted-foreground">
            留空表示该类型未设置额度，平均剩余会回退到默认权重计算。
          </span>
        </div>
      </form>
    </div>
  );
}

function DollarInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-40 max-w-full">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        className="pl-5"
        placeholder="未设置"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
