"use client";

import {
  Activity,
  Copy,
  Database,
  ExternalLink,
  FileKey2,
  History,
  KeyRound,
  ListChecks,
  Loader2,
  LogOut,
  LogIn,
  MoreHorizontal,
  Network,
  Play,
  Plus,
  RefreshCw,
  Save,
  Server,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { resolveAccountQuotaStatus, type AccountQuotaState } from "@/lib/account-quota-status";
import { sortAccountRows } from "@/lib/account-sort";
import { onlyEnabledCpaGroups } from "@/lib/cpa-groups";
import { cpaTableUpdatingIdsForJob } from "@/lib/cpa-sync-targets";
import {
  cronToSimpleSchedule,
  describeSimpleSchedule,
  simpleScheduleToCron,
  type CronSimpleMode,
  type CronSimpleSchedule,
} from "@/lib/cron-presets";
import { averageRemainingPercent } from "@/lib/quota-summary";
import { cn } from "@/lib/utils";

type CpaInstance = {
  id: number;
  name: string;
  baseUrl: string;
  password: string;
  quotaRefreshPath: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
};

type AuthFile = {
  id: number;
  cpaInstanceId: number;
  fileName: string;
  email: string | null;
  provider: string | null;
  status: string | null;
  statusMessage: string | null;
  disabled: boolean;
  available: boolean;
  proxyUrl: string | null;
  rawJson: string | null;
  lastSyncedAt: string;
};

type QuotaSnapshot = {
  id: number;
  email: string | null;
  authFileName: string | null;
  subscriptionType: string | null;
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
  available: boolean;
  exception: string | null;
  rawJson: string | null;
  capturedAt: string;
};

type StrategyRow = {
  instance: CpaInstance;
  strategy: {
    cpaInstanceId: number;
    enabled: boolean;
    maintain5hUsagePercent: number;
    maintainWeekUsagePercent: number;
    minAvailableAccounts: number;
    maxBatchSize: number;
  };
};

type ProxyRow = {
  id: number;
  name: string;
  url: string;
  maxAuthFiles: number;
  enabled: boolean;
  notes: string | null;
  cpaInstanceIds: number[];
};

type ProxyCheckResult = {
  proxyId: number;
  ok: boolean;
  latencyMs: number | null;
  message: string;
  checkedAt: string;
};

type BackupAccount = {
  id: number;
  email: string;
  status: string;
  assignedCpaInstanceId: number | null;
  assignedAuthFileName: string | null;
  exception: string | null;
  importedAt: string;
  ownerName: string | null;
};

type CronJob = {
  id: number;
  key: string;
  name: string;
  cron: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  nextRunAt: string | null;
  secondsUntilNextRun: number | null;
};

type JobRun = {
  id: number;
  jobKey: string;
  status: string;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type ReplenishmentRecord = {
  id: number;
  source: "auto" | "manual" | "quick" | string;
  status: "success" | "error" | string;
  cpaInstanceId: number | null;
  cpaInstanceName: string | null;
  backupAccountId: number | null;
  email: string | null;
  authFileName: string | null;
  reasonCodes: string | null;
  error: string | null;
  createdAt: string;
};

type BatchExceptionAction = "delete" | "disable";

type CronJobDraft = CronJob & {
  schedule: CronSimpleSchedule;
};

type CodexOAuthStartResult = {
  authUrl: string;
  state: string | null;
};

type DashboardData = {
  stats: {
    totalInstances: number;
    instances: number;
    enabledInstances: number;
    authFiles: number;
    availableAuthFiles: number;
    idleBackupAccounts: number;
    proxies: number;
    average5hRemainingPercent: number | null;
    averageWeekRemainingPercent: number | null;
  };
};

const navItems = [
  { id: "instances", label: "CPA管理", icon: Server, href: "/instances" },
  { id: "auth", label: "账号管理", icon: FileKey2, href: "/auth" },
  { id: "strategies", label: "自动补号", icon: ListChecks, href: "/strategies" },
  { id: "replenishment-records", label: "补号记录", icon: History, href: "/replenishment-records" },
  { id: "proxies", label: "代理管理", icon: Network, href: "/proxies" },
  { id: "jobs", label: "定时任务", icon: Activity, href: "/jobs" },
  { id: "backups", label: "替补账号", icon: KeyRound, href: "/backups" },
] as const;

export type SectionId = (typeof navItems)[number]["id"];

const cronModeLabels: Record<CronSimpleMode, string> = {
  interval: "每隔 N 分钟",
  hourly: "每小时",
  daily: "每天",
  weekly: "每周",
  advanced: "高级 Cron",
};

const weekdayOptions = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

const intervalPresets = [
  { label: "5分钟", value: { mode: "interval", everyMinutes: 5 } },
  { label: "10分钟", value: { mode: "interval", everyMinutes: 10 } },
  { label: "15分钟", value: { mode: "interval", everyMinutes: 15 } },
  { label: "30分钟", value: { mode: "interval", everyMinutes: 30 } },
  { label: "1小时", value: { mode: "hourly", minute: 0 } },
] satisfies Array<{ label: string; value: CronSimpleSchedule }>;

const compactControlClassName =
  "h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

const emptyInstance = {
  name: "",
  baseUrl: "",
  password: "",
  quotaRefreshPath: "/v0/management/auth-files",
  enabled: true,
};

const emptyProxy = {
  name: "",
  url: "",
  maxAuthFiles: 10,
  enabled: true,
  notes: "",
  cpaInstanceIds: [] as number[],
};

export function CpaDashboard({ section = "instances" }: { section?: SectionId }) {
  const activeSection = section;
  const [dashboard, setDashboard] = useState<DashboardData["stats"] | null>(null);
  const [instances, setInstances] = useState<CpaInstance[]>([]);
  const [authGroups, setAuthGroups] = useState<Array<{ instance: CpaInstance; authFiles: AuthFile[] }>>([]);
  const [quotaGroups, setQuotaGroups] = useState<Array<{ instance: CpaInstance; quotas: QuotaSnapshot[] }>>([]);
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [proxies, setProxies] = useState<ProxyRow[]>([]);
  const [backupAccounts, setBackupAccounts] = useState<BackupAccount[]>([]);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [replenishmentRecords, setReplenishmentRecords] = useState<ReplenishmentRecord[]>([]);
  const [message, setMessage] = useState("");
  const [updatingCpaIds, setUpdatingCpaIds] = useState<Set<number>>(() => new Set());
  const [runningJobKeys, setRunningJobKeys] = useState<Set<string>>(() => new Set());
  const [proxyChecks, setProxyChecks] = useState<Record<number, ProxyCheckResult>>({});
  const [checkingProxies, setCheckingProxies] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [instanceForm, setInstanceForm] = useState(emptyInstance);
  const [editingInstanceId, setEditingInstanceId] = useState<number | null>(null);
  const [instanceDialogOpen, setInstanceDialogOpen] = useState(false);
  const [proxyForm, setProxyForm] = useState(emptyProxy);
  const [editingProxyId, setEditingProxyId] = useState<number | null>(null);
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const [backupText, setBackupText] = useState("");

  const activeLabel = navItems.find((item) => item.id === activeSection)?.label ?? "CPA Nexus";

  async function loadAll() {
    try {
      const [dashboardRes, instanceRes, authRes, quotaRes, strategyRes, recordRes, proxyRes, backupRes, jobRes] =
        await Promise.all([
          fetchJson<{ stats: DashboardData["stats"] }>("/api/dashboard"),
          fetchJson<{ instances: CpaInstance[] }>("/api/cpa-instances"),
          fetchJson<{ groups: Array<{ instance: CpaInstance; authFiles: AuthFile[] }> }>("/api/auth-files"),
          fetchJson<{ groups: Array<{ instance: CpaInstance; quotas: QuotaSnapshot[] }> }>("/api/quotas"),
          fetchJson<{ strategies: StrategyRow[] }>("/api/strategies"),
          fetchJson<{ records: ReplenishmentRecord[] }>("/api/replenishment-records"),
          fetchJson<{ proxies: ProxyRow[]; instances: CpaInstance[] }>("/api/proxies"),
          fetchJson<{ accounts: BackupAccount[] }>("/api/backup-accounts"),
          fetchJson<{ jobs: CronJob[]; runs: JobRun[] }>("/api/jobs"),
        ]);
      setDashboard(dashboardRes.stats);
      setInstances(instanceRes.instances);
      setAuthGroups(authRes.groups);
      setQuotaGroups(quotaRes.groups);
      setStrategies(strategyRes.strategies);
      setReplenishmentRecords(recordRes.records);
      setProxies(proxyRes.proxies);
      setBackupAccounts(backupRes.accounts);
      setJobs(jobRes.jobs);
      setRuns(jobRes.runs);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const availableRate = useMemo(() => {
    if (!dashboard?.authFiles) {
      return 0;
    }
    return Math.round((dashboard.availableAuthFiles / dashboard.authFiles) * 100);
  }, [dashboard]);
  const syncJob = useMemo(
    () => jobs.find((job) => job.key === "sync-cpa-instances") ?? null,
    [jobs],
  );
  const syncCountdownSeconds = useMemo(
    () => secondsUntilJobRun(syncJob, nowMs),
    [syncJob, nowMs],
  );
  const isSyncJobRunning = runningJobKeys.has("sync-cpa-instances");
  const syncButtonLabel = formatSyncButtonLabel(syncJob, syncCountdownSeconds, isSyncJobRunning);
  const syncButtonTitle = formatSyncButtonTitle(syncJob, syncCountdownSeconds, isSyncJobRunning);

  useEffect(() => {
    if (!syncJob?.enabled || !syncJob.nextRunAt) {
      return;
    }

    const delay = Math.max(1000, new Date(syncJob.nextRunAt).getTime() - Date.now() + 1500);
    const timer = window.setTimeout(() => {
      void loadAll();
    }, delay);

    return () => window.clearTimeout(timer);
  }, [syncJob?.enabled, syncJob?.nextRunAt]);

  function findAuthFileCpaInstanceId(authFileId: number) {
    for (const group of authGroups) {
      if (group.authFiles.some((authFile) => authFile.id === authFileId)) {
        return group.instance.id;
      }
    }

    return null;
  }

  async function withUpdatingCpaTables(
    cpaInstanceIds: Array<number | null | undefined>,
    action: () => Promise<void>,
  ) {
    const ids = [...new Set(cpaInstanceIds.filter((id): id is number => typeof id === "number" && id > 0))];
    if (ids.length > 0) {
      setUpdatingCpaIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }

    try {
      await action();
    } finally {
      if (ids.length > 0) {
        setUpdatingCpaIds((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    }
  }

  async function submitInstance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = editingInstanceId ? `/api/cpa-instances/${editingInstanceId}` : "/api/cpa-instances";
    await mutate(url, {
      method: editingInstanceId ? "PUT" : "POST",
      body: JSON.stringify(instanceForm),
    });
    setInstanceForm(emptyInstance);
    setEditingInstanceId(null);
    setInstanceDialogOpen(false);
    setMessage("CPA实例已保存");
    await loadAll();
  }

  async function submitProxy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = editingProxyId ? `/api/proxies/${editingProxyId}` : "/api/proxies";
    await mutate(url, {
      method: editingProxyId ? "PUT" : "POST",
      body: JSON.stringify(proxyForm),
    });
    setProxyForm(emptyProxy);
    setEditingProxyId(null);
    setProxyDialogOpen(false);
    setMessage("");
    toast.success("代理已保存");
    await loadAll();
  }

  async function toggleProxyEnabled(proxy: ProxyRow, enabled: boolean) {
    await mutate(`/api/proxies/${proxy.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: proxy.name,
        url: proxy.url,
        maxAuthFiles: proxy.maxAuthFiles,
        enabled,
        notes: proxy.notes,
        cpaInstanceIds: proxy.cpaInstanceIds,
      }),
    });
    setMessage("");
    toast.success(enabled ? "代理已启用" : "代理已停用");
    await loadAll();
  }

  async function checkAllProxies() {
    setCheckingProxies(true);
    try {
      const result = await mutate<{ results: ProxyCheckResult[] }>("/api/proxies/check", {
        method: "POST",
      });
      setProxyChecks(Object.fromEntries(result.results.map((item) => [item.proxyId, item])));
      const availableCount = result.results.filter((item) => item.ok).length;
      toast.success(`代理检测完成：${availableCount}/${result.results.length} 可用`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingProxies(false);
    }
  }

  async function importBackupAccounts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await mutate<{ imported: number; skipped: number; invalid: unknown[] }>("/api/backup-accounts", {
      method: "POST",
      body: JSON.stringify({ text: backupText }),
    });
    setBackupText("");
    setMessage(`导入 ${result.imported} 个，跳过 ${result.skipped} 个，异常 ${result.invalid.length} 行`);
    await loadAll();
  }

  async function runJob(key: string) {
    const updatingIds = cpaTableUpdatingIdsForJob(key, instances);
    setRunningJobKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    try {
      await withUpdatingCpaTables(updatingIds, async () => {
        const result = await mutate<{ status: string; message: string }>(`/api/jobs/${encodeURIComponent(key)}/run`, {
          method: "POST",
        });
        setMessage(result.message);
        await loadAll();
      });
    } finally {
      setRunningJobKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function toggleInstanceEnabled(id: number, enabled: boolean) {
    setInstances((current) =>
      current.map((instance) =>
        instance.id === id ? { ...instance, enabled } : instance,
      ),
    );

    try {
      await mutate("/api/cpa-instances", {
        method: "PATCH",
        body: JSON.stringify({ id, enabled }),
      });
      setMessage(enabled ? "CPA实例已启用" : "CPA实例已停用");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      await loadAll();
    }
  }

  async function deleteAuthFile(id: number) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables([sourceCpaInstanceId], async () => {
        await mutate(`/api/auth-files/${id}`, { method: "DELETE" });
        setMessage("");
        toast.success("账号已删除");
        await loadAll();
      });
    } catch (error) {
      setMessage("");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function moveAuthFile(id: number, targetCpaInstanceId: number) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables([sourceCpaInstanceId, targetCpaInstanceId], async () => {
        await mutate(`/api/auth-files/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ targetCpaInstanceId }),
        });
        setMessage("");
        toast.success("账号已移动");
        await loadAll();
      });
    } catch (error) {
      setMessage("");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleAuthFileDisabled(id: number, disabled: boolean) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables([sourceCpaInstanceId], async () => {
        await mutate(`/api/auth-files/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ disabled }),
        });
        setMessage("");
        toast.success(disabled ? "账号已停用" : "账号已启用，等待配额刷新");
        await loadAll();
      });
    } catch (error) {
      setMessage("");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function configureAuthFileProxy(id: number, proxyUrl: string | null) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables([sourceCpaInstanceId], async () => {
        await mutate(`/api/auth-files/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ proxyUrl }),
        });
        setMessage("");
        toast.success(proxyUrl ? "账号代理已更新" : "账号代理已清除");
        await loadAll();
      });
    } catch (error) {
      setMessage("");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshAuthFileQuota(id: number) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables([sourceCpaInstanceId], async () => {
        const result = await mutate<{ status: string; message: string; instance: string }>(
          `/api/auth-files/${id}`,
          {
            method: "POST",
            body: JSON.stringify({ action: "refreshQuota" }),
          },
        );
        setMessage("");
        if (result.status === "success") {
          toast.success(`${result.instance}：${result.message}`);
        } else {
          toast.error(`${result.instance}：${result.message}`);
        }
        await loadAll();
      });
    } catch (error) {
      setMessage("");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function replenishCpaAccounts(
    cpaInstanceId: number,
    payload: { count?: number; backupAccountIds?: number[] },
  ) {
    try {
      await withUpdatingCpaTables([cpaInstanceId], async () => {
        const result = await mutate<{ uploaded: number; requested: number }>(
          `/api/cpa-instances/${cpaInstanceId}/replenish`,
          {
            method: "POST",
            body: JSON.stringify(payload),
          },
        );
        setMessage("");
        toast.success(`补号完成：上传 ${result.uploaded}/${result.requested} 个`);
        await loadAll();
      });
    } catch (error) {
      setMessage("");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function batchHandleExceptionAuthFiles(
    cpaInstanceId: number,
    action: BatchExceptionAction,
    authFileIds: number[],
    successVerb: string,
    subject: string,
  ) {
    if (authFileIds.length === 0) {
      setMessage("");
      toast.info(`没有${subject}可处理`);
      return;
    }

    try {
      await withUpdatingCpaTables([cpaInstanceId], async () => {
        const result = await mutate<{ processed: number; action: BatchExceptionAction }>(
          `/api/cpa-instances/${cpaInstanceId}/auth-files/batch`,
          {
            method: "POST",
            body: JSON.stringify({ action, authFileIds }),
          },
        );
        setMessage("");
        toast.success(`${successVerb} ${result.processed} 个${subject}`);
        await loadAll();
      });
    } catch (error) {
      setMessage("");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function autoAssignCpaProxies(cpaInstanceId: number) {
    try {
      await withUpdatingCpaTables([cpaInstanceId], async () => {
        const result = await mutate<{ processed: number; skipped?: number; action: "autoAssignProxy" }>(
          `/api/cpa-instances/${cpaInstanceId}/auth-files/batch`,
          {
            method: "POST",
            body: JSON.stringify({ action: "autoAssignProxy" }),
          },
        );
        setMessage("");
        if (result.processed > 0 && result.skipped) {
          toast.success(`已自动分配代理 ${result.processed} 个，${result.skipped} 个因容量不足跳过`);
        } else if (result.processed > 0) {
          toast.success(`已自动分配代理 ${result.processed} 个`);
        } else if (result.skipped) {
          toast.warning(`没有可用代理容量，${result.skipped} 个账号未分配`);
        } else {
          toast.info("没有需要分配代理的账号");
        }
        await loadAll();
      });
    } catch (error) {
      setMessage("");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshCpaInstance(cpaInstanceId: number) {
    try {
      await withUpdatingCpaTables([cpaInstanceId], async () => {
        const result = await mutate<{ status: string; message: string; instance: string }>(
          `/api/cpa-instances/${cpaInstanceId}/sync`,
          { method: "POST" },
        );
        setMessage("");
        toast.success(`${result.instance}：${result.message}`);
        await loadAll();
      });
    } catch (error) {
      setMessage("");
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function startCodexOAuthLogin(cpaInstanceId: number) {
    return await mutate<CodexOAuthStartResult>(
      `/api/cpa-instances/${cpaInstanceId}/oauth`,
      {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      },
    );
  }

  async function submitCodexOAuthCallback(
    cpaInstanceId: number,
    redirectUrl: string,
  ) {
    await withUpdatingCpaTables([cpaInstanceId], async () => {
      await mutate(`/api/cpa-instances/${cpaInstanceId}/oauth`, {
        method: "POST",
        body: JSON.stringify({ action: "callback", redirectUrl }),
      });
      setMessage("");
      await loadAll();
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-[color-mix(in_oklch,var(--background),var(--muted)_35%)] text-foreground">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[208px_1fr]">
        <aside className="border-b bg-sidebar/90 lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="flex h-16 items-center gap-3 border-b px-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">CPA Nexus</div>
                <div className="text-xs text-muted-foreground">Ops Console</div>
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={cn(
                      "flex h-9 min-w-max items-center gap-2 rounded-md px-2.5 text-sm transition-colors",
                      activeSection === item.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="flex min-h-16 flex-col justify-center gap-3 border-b bg-background/80 px-5 py-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold">{activeLabel}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" title={syncButtonTitle} onClick={() => void runJob("sync-cpa-instances")}>
                <RefreshCw className="h-4 w-4" />
                {syncButtonLabel}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void logout()}>
                <LogOut className="h-4 w-4" />
                退出登录
              </Button>
            </div>
          </header>

          <div className="space-y-5 p-5">
            {message ? (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
                {message}
              </div>
            ) : null}

            {activeSection === "instances" ? (
              <InstancesSection
                stats={dashboard}
                availableRate={availableRate}
                instances={instances}
                form={instanceForm}
                editingId={editingInstanceId}
                open={instanceDialogOpen}
                setForm={setInstanceForm}
                setEditingId={setEditingInstanceId}
                setOpen={(open) => {
                  setInstanceDialogOpen(open);
                  if (!open) {
                    setInstanceForm(emptyInstance);
                    setEditingInstanceId(null);
                  }
                }}
                onSubmit={submitInstance}
                onToggleEnabled={toggleInstanceEnabled}
                onDelete={async (id) => {
                  await mutate(`/api/cpa-instances/${id}`, { method: "DELETE" });
                  await loadAll();
                }}
              />
            ) : null}

            {activeSection === "auth" ? (
              <AuthFilesSection
                groups={authGroups}
                quotaGroups={quotaGroups}
                proxies={proxies}
                backupAccounts={backupAccounts}
                updatingCpaIds={updatingCpaIds}
                nowMs={nowMs}
                onDeleteAuthFile={deleteAuthFile}
                onMoveAuthFile={moveAuthFile}
                onToggleAuthFileDisabled={toggleAuthFileDisabled}
                onConfigureAuthFileProxy={configureAuthFileProxy}
                onRefreshAuthFileQuota={refreshAuthFileQuota}
                onReplenish={replenishCpaAccounts}
                onBatchHandleExceptionAuthFiles={batchHandleExceptionAuthFiles}
                onAutoAssignCpaProxies={autoAssignCpaProxies}
                onRefreshCpa={refreshCpaInstance}
                onStartCodexOAuth={startCodexOAuthLogin}
                onSubmitCodexOAuthCallback={submitCodexOAuthCallback}
              />
            ) : null}

            {activeSection === "strategies" ? (
              <StrategiesSection
                rows={strategies}
                onSave={async (strategy) => {
                  await mutate("/api/strategies", {
                    method: "PUT",
                    body: JSON.stringify(strategy),
                  });
                  setMessage("补号策略已保存");
                  await loadAll();
                }}
              />
            ) : null}

            {activeSection === "replenishment-records" ? (
              <ReplenishmentRecordsSection records={replenishmentRecords} />
            ) : null}

            {activeSection === "proxies" ? (
              <ProxySection
                proxies={proxies}
                instances={instances}
                checks={proxyChecks}
                checking={checkingProxies}
                form={proxyForm}
                editingId={editingProxyId}
                open={proxyDialogOpen}
                setForm={setProxyForm}
                setEditingId={setEditingProxyId}
                setOpen={(open) => {
                  setProxyDialogOpen(open);
                  if (!open) {
                    setProxyForm(emptyProxy);
                    setEditingProxyId(null);
                  }
                }}
                onSubmit={submitProxy}
                onToggleEnabled={toggleProxyEnabled}
                onCheckAll={checkAllProxies}
                onDelete={async (id) => {
                  await mutate(`/api/proxies/${id}`, { method: "DELETE" });
                  setMessage("");
                  toast.success("代理已删除");
                  await loadAll();
                }}
              />
            ) : null}

            {activeSection === "jobs" ? (
              <JobsSection
                jobs={jobs}
                runs={runs}
                onRun={runJob}
                onSave={async (job) => {
                  await mutate(`/api/jobs/${encodeURIComponent(job.key)}`, {
                    method: "PUT",
                    body: JSON.stringify({ cron: job.cron, enabled: job.enabled }),
                  });
                  setMessage("定时任务已保存");
                  await loadAll();
                }}
              />
            ) : null}

            {activeSection === "backups" ? (
              <BackupAccountsSection
                accounts={backupAccounts}
                text={backupText}
                setText={setBackupText}
                onSubmit={importBackupAccounts}
                onDelete={async (id) => {
                  await mutate(`/api/backup-accounts?id=${id}`, { method: "DELETE" });
                  await loadAll();
                }}
                onClear={async (id) => {
                  await mutate("/api/backup-accounts", {
                    method: "PATCH",
                    body: JSON.stringify({ id, clearAssignment: true }),
                  });
                  await loadAll();
                }}
              />
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function formatSyncButtonLabel(
  job: CronJob | null,
  seconds: number | null,
  running: boolean,
) {
  if (running) {
    return "同步中";
  }
  if (!job || !job.enabled || seconds === null) {
    return "立即同步";
  }
  if (seconds <= 0) {
    return "立即同步 即将同步";
  }

  return `立即同步 ${formatCountdown(seconds)}`;
}

function formatSyncButtonTitle(
  job: CronJob | null,
  seconds: number | null,
  running: boolean,
) {
  return job?.name
    ? running
      ? `「${job.name}」正在同步`
      : job.enabled && seconds !== null && seconds > 0
        ? `距离「${job.name}」同步还有 ${formatCountdown(seconds)}`
        : job.enabled
          ? `「${job.name}」即将同步`
          : `「${job.name}」已停用`
    : "等待调度信息";
}

function InstancesSection(props: {
  stats: DashboardData["stats"] | null;
  availableRate: number;
  instances: CpaInstance[];
  form: typeof emptyInstance;
  editingId: number | null;
  open: boolean;
  setForm: (form: typeof emptyInstance) => void;
  setEditingId: (id: number | null) => void;
  setOpen: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleEnabled: (id: number, enabled: boolean) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const stats = props.stats;
  const formId = "cpa-instance-form";
  return (
    <section className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <StatCard label="CPA实例" value={stats?.instances ?? 0} sub={`${stats?.totalInstances ?? 0} 总数`} />
        <StatCard label="账号" value={stats?.authFiles ?? 0} sub={`${stats?.availableAuthFiles ?? 0} 可用`} />
        <StatCard label="可用率" value={`${props.availableRate}%`} sub="auth文件" tone="emerald" />
        <StatCard label="5h剩余" value={formatPercent(stats?.average5hRemainingPercent ?? null)} sub="启用CPA均值" tone="sky" />
        <StatCard label="周剩余" value={formatPercent(stats?.averageWeekRemainingPercent ?? null)} sub="启用CPA均值" tone="emerald" />
        <StatCard label="替补账号" value={stats?.idleBackupAccounts ?? 0} sub="无归属" tone="amber" />
        <StatCard label="代理" value={stats?.proxies ?? 0} sub="已配置" tone="sky" />
      </div>

      <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">CPA 实例</div>
          <div className="text-sm text-muted-foreground">集中管理 CPA 地址、管理密码和配额刷新策略。</div>
        </div>
        <Button
          type="button"
          onClick={() => {
            props.setEditingId(null);
            props.setForm(emptyInstance);
            props.setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          添加CPA
        </Button>
      </div>

      <Dialog open={props.open} onOpenChange={props.setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{props.editingId ? "编辑CPA实例" : "添加CPA实例"}</DialogTitle>
            <DialogDescription>
              配置 CPA 管理地址、密码和配额刷新方式，保存后会出现在 CPA 管理列表中。
            </DialogDescription>
          </DialogHeader>

          <form id={formId} onSubmit={props.onSubmit} className="grid gap-4">
            <Field label="名称">
              <Input value={props.form.name} onChange={(event) => props.setForm({ ...props.form, name: event.target.value })} required />
            </Field>
            <Field label="CPA地址">
              <Input value={props.form.baseUrl} onChange={(event) => props.setForm({ ...props.form, baseUrl: event.target.value })} placeholder="http://127.0.0.1:8317" required />
            </Field>
            <Field label="CPA密码">
              <Input type="password" value={props.form.password} onChange={(event) => props.setForm({ ...props.form, password: event.target.value })} required />
            </Field>
            <Field label="配额刷新路径">
              <Input value={props.form.quotaRefreshPath} onChange={(event) => props.setForm({ ...props.form, quotaRefreshPath: event.target.value })} required />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={props.form.enabled} onCheckedChange={(enabled) => props.setForm({ ...props.form, enabled })} />
              启用
            </label>
          </form>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.setOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" form={formId}>
              <Save className="h-4 w-4" />
              {props.editingId ? "保存" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DataTable
        headers={["名称", "地址", "启用", "状态", "最近同步", "错误", "操作"]}
        rows={props.instances.map((instance) => [
          <div key="name" className="font-medium">{instance.name}</div>,
          <a
            key="url"
            href={buildCpaManagementHref(instance.baseUrl)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs hover:text-primary hover:underline"
          >
            {instance.baseUrl}
          </a>,
          <Switch
            key="enabled"
            checked={instance.enabled}
            aria-label={`${instance.name} 启用状态`}
            onCheckedChange={(enabled) => void props.onToggleEnabled(instance.id, enabled)}
          />,
          <StatusBadge key="status" ok={instance.enabled && instance.lastSyncStatus !== "error"} label={instance.enabled ? instance.lastSyncStatus ?? "启用" : "停用"} />,
          <span key="sync">{formatDate(instance.lastSyncedAt)}</span>,
          <span key="error" className="max-w-[280px] truncate text-rose-700">{instance.lastSyncError ?? "-"}</span>,
          <div key="actions" className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                props.setEditingId(instance.id);
                props.setForm({
                  name: instance.name,
                  baseUrl: instance.baseUrl,
                  password: instance.password,
                  quotaRefreshPath: instance.quotaRefreshPath,
                  enabled: instance.enabled,
                });
                props.setOpen(true);
              }}
            >
              编辑
            </Button>
            <Button size="icon" variant="ghost" onClick={() => void props.onDelete(instance.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>,
        ])}
      />
    </section>
  );
}

function AuthFilesSection({
  groups,
  quotaGroups,
  proxies,
  backupAccounts,
  updatingCpaIds,
  nowMs,
  onDeleteAuthFile,
  onMoveAuthFile,
  onToggleAuthFileDisabled,
  onConfigureAuthFileProxy,
  onRefreshAuthFileQuota,
  onReplenish,
  onBatchHandleExceptionAuthFiles,
  onAutoAssignCpaProxies,
  onRefreshCpa,
  onStartCodexOAuth,
  onSubmitCodexOAuthCallback,
}: {
  groups: Array<{ instance: CpaInstance; authFiles: AuthFile[] }>;
  quotaGroups: Array<{ instance: CpaInstance; quotas: QuotaSnapshot[] }>;
  proxies: ProxyRow[];
  backupAccounts: BackupAccount[];
  updatingCpaIds: Set<number>;
  nowMs: number;
  onDeleteAuthFile: (id: number) => Promise<void>;
  onMoveAuthFile: (id: number, targetCpaInstanceId: number) => Promise<void>;
  onToggleAuthFileDisabled: (id: number, disabled: boolean) => Promise<void>;
  onConfigureAuthFileProxy: (id: number, proxyUrl: string | null) => Promise<void>;
  onRefreshAuthFileQuota: (id: number) => Promise<void>;
  onReplenish: (cpaInstanceId: number, payload: { count?: number; backupAccountIds?: number[] }) => Promise<void>;
  onBatchHandleExceptionAuthFiles: (
    cpaInstanceId: number,
    action: BatchExceptionAction,
    authFileIds: number[],
    successVerb: string,
    subject: string,
  ) => Promise<void>;
  onAutoAssignCpaProxies: (cpaInstanceId: number) => Promise<void>;
  onRefreshCpa: (cpaInstanceId: number) => Promise<void>;
  onStartCodexOAuth: (cpaInstanceId: number) => Promise<CodexOAuthStartResult>;
  onSubmitCodexOAuthCallback: (cpaInstanceId: number, redirectUrl: string) => Promise<void>;
}) {
  const enabledGroups = onlyEnabledCpaGroups(groups);
  const enabledInstances = enabledGroups.map((group) => group.instance);
  const replenishCandidates = backupAccounts.filter(
    (account) => account.assignedCpaInstanceId === null && !account.exception,
  );
  const proxyNameByUrl = useMemo(
    () => new Map(proxies.map((proxy) => [proxy.url, proxy.name])),
    [proxies],
  );
  const [deleteTarget, setDeleteTarget] = useState<AuthFileQuotaRow | null>(null);
  const [moveTarget, setMoveTarget] = useState<AuthFileQuotaRow | null>(null);
  const [moveTargetInstanceId, setMoveTargetInstanceId] = useState("");
  const [proxyTarget, setProxyTarget] = useState<AuthFileQuotaRow | null>(null);
  const [proxyTargetUrl, setProxyTargetUrl] = useState("");
  const [openReplenishMenuInstanceId, setOpenReplenishMenuInstanceId] = useState<number | null>(null);
  const [quickReplenishTarget, setQuickReplenishTarget] = useState<{ instance: CpaInstance; count: number } | null>(null);
  const [manualReplenishInstance, setManualReplenishInstance] = useState<CpaInstance | null>(null);
  const [manualSelectedBackupIds, setManualSelectedBackupIds] = useState<number[]>([]);
  const [oauthLogin, setOauthLogin] = useState<{
    instance: CpaInstance;
    authUrl: string | null;
    state: string | null;
    callbackUrl: string;
    loading: boolean;
    submitting: boolean;
    error: string | null;
  } | null>(null);
  const [openBulkMenuInstanceId, setOpenBulkMenuInstanceId] = useState<number | null>(null);
  const [bulkExceptionTarget, setBulkExceptionTarget] = useState<{
    instance: CpaInstance;
    action: BatchExceptionAction;
    authFileIds: number[];
    title: string;
    subject: string;
    confirmVerb: string;
    successVerb: string;
  } | null>(null);
  const [useDesktopMasonry, setUseDesktopMasonry] = useState(false);
  const replenishMenuRef = useRef<HTMLDivElement | null>(null);
  const bulkMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openReplenishMenuInstanceId === null) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && replenishMenuRef.current?.contains(target)) {
        return;
      }
      setOpenReplenishMenuInstanceId(null);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openReplenishMenuInstanceId]);

  useEffect(() => {
    if (openBulkMenuInstanceId === null) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && bulkMenuRef.current?.contains(target)) {
        return;
      }
      setOpenBulkMenuInstanceId(null);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openBulkMenuInstanceId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    const update = () => setUseDesktopMasonry(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  function openMoveDialog(row: AuthFileQuotaRow) {
    const firstTarget = enabledInstances.find((instance) => instance.id !== row.cpaInstanceId);
    setMoveTarget(row);
    setMoveTargetInstanceId(firstTarget ? String(firstTarget.id) : "");
  }

  function openProxyDialog(row: AuthFileQuotaRow) {
    const proxyOptions = proxiesForCpa(row.cpaInstanceId);
    const currentProxyUrl = row.proxyUrl && proxyOptions.some((proxy) => proxy.url === row.proxyUrl)
      ? row.proxyUrl
      : "";
    setProxyTarget(row);
    setProxyTargetUrl(currentProxyUrl);
  }

  function proxiesForCpa(cpaInstanceId: number) {
    return proxies.filter(
      (proxy) => proxy.enabled && proxy.cpaInstanceIds.includes(cpaInstanceId),
    );
  }

  const moveOptions = moveTarget
    ? enabledInstances.filter((instance) => instance.id !== moveTarget.cpaInstanceId)
    : [];
  const proxyOptions = proxyTarget ? proxiesForCpa(proxyTarget.cpaInstanceId) : [];
  const quickReplenishHasEnough =
    quickReplenishTarget !== null && replenishCandidates.length >= quickReplenishTarget.count;

  function openManualReplenish(instance: CpaInstance) {
    setOpenReplenishMenuInstanceId(null);
    setManualReplenishInstance(instance);
    setManualSelectedBackupIds([]);
  }

  function openOAuthLogin(instance: CpaInstance) {
    setOpenReplenishMenuInstanceId(null);
    setOauthLogin({
      instance,
      authUrl: null,
      state: null,
      callbackUrl: "",
      loading: true,
      submitting: false,
      error: null,
    });

    void onStartCodexOAuth(instance.id)
      .then((result) => {
        setOauthLogin((current) =>
          current?.instance.id === instance.id
            ? {
                ...current,
                authUrl: result.authUrl,
                state: result.state,
                loading: false,
                error: null,
              }
            : current,
        );
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setOauthLogin((current) =>
          current?.instance.id === instance.id
            ? { ...current, loading: false, error: message }
            : current,
        );
        toast.error(message);
      });
  }

  async function copyOAuthUrl() {
    if (!oauthLogin?.authUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(oauthLogin.authUrl);
      toast.success("OAuth 登录链接已复制");
    } catch {
      toast.error("复制失败，请手动复制链接");
    }
  }

  async function submitOAuthCallback() {
    if (!oauthLogin) {
      return;
    }

    const redirectUrl = oauthLogin.callbackUrl.trim();
    if (!redirectUrl) {
      toast.error("请先粘贴回调 URL");
      return;
    }

    setOauthLogin((current) =>
      current ? { ...current, submitting: true, error: null } : current,
    );
    try {
      await onSubmitCodexOAuthCallback(oauthLogin.instance.id, redirectUrl);
      toast.success(`${oauthLogin.instance.name} OAuth 登录已完成`);
      setOauthLogin(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOauthLogin((current) =>
        current ? { ...current, submitting: false, error: message } : current,
      );
      toast.error(message);
    }
  }

  function toggleManualBackupId(id: number, checked: boolean) {
    setManualSelectedBackupIds((current) =>
      checked ? [...current, id] : current.filter((selectedId) => selectedId !== id),
    );
  }

  const groupColumns =
    useDesktopMasonry && enabledGroups.length > 1
      ? distributeCpaGroups(enabledGroups)
      : [enabledGroups];

  function renderGroupCard(group: { instance: CpaInstance; authFiles: AuthFile[] }) {
          const quotaGroup = quotaGroups.find((item) => item.instance.id === group.instance.id);
          const rows = mergeAuthFilesWithQuotas(group.authFiles, quotaGroup?.quotas ?? [], proxyNameByUrl);
          const activeRows = rows.filter((row) => !row.disabled);
          const exceptionRows = activeRows.filter((row) => row.quotaStatus === "exception");
          const limitedRows = activeRows.filter((row) => row.quotaStatus === "limited");
          const exceptionAuthFileIds = exceptionRows.map((row) => row.id);
          const disabledRows = rows.filter((row) => row.disabled);
          const disabledAuthFileIds = disabledRows.map((row) => row.id);
          const disabledCount = disabledRows.length;
          const exceptionCount = exceptionRows.length;
          const availableCount = activeRows.filter((row) => row.quotaStatus === "available").length;
          const hasAssignableProxy = proxiesForCpa(group.instance.id).length > 0;
          const average5hRemaining = averageRemainingPercent(activeRows.map((row) => row.usage5hPercent));
          const averageWeekRemaining = averageRemainingPercent(activeRows.map((row) => row.usageWeekPercent));
          const isUpdating = updatingCpaIds.has(group.instance.id);
          const hasOpenHeaderMenu =
            openReplenishMenuInstanceId === group.instance.id ||
            openBulkMenuInstanceId === group.instance.id;

          return (
            <div
              key={group.instance.id}
              aria-busy={isUpdating}
              className={cn(
                "relative min-w-0 rounded-md border bg-card",
                hasOpenHeaderMenu ? "z-50 overflow-visible" : "overflow-hidden",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/35 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <a
                    href={buildCpaManagementHref(group.instance.baseUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm font-semibold hover:text-primary hover:underline"
                  >
                    {group.instance.name}
                  </a>
                  <Badge variant="secondary">{rows.length}</Badge>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`刷新 ${group.instance.name}`}
                    title="刷新"
                    disabled={isUpdating}
                    onClick={() => void onRefreshCpa(group.instance.id)}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", isUpdating && "animate-spin")} />
                  </Button>
                  <div ref={openReplenishMenuInstanceId === group.instance.id ? replenishMenuRef : null} className="relative">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      aria-expanded={openReplenishMenuInstanceId === group.instance.id}
                      onClick={() =>
                        setOpenReplenishMenuInstanceId(
                          openReplenishMenuInstanceId === group.instance.id ? null : group.instance.id,
                        )
                      }
                    >
                      <Plus className="h-3 w-3" />
                      补号
                    </Button>
                    {openReplenishMenuInstanceId === group.instance.id ? (
                      <div className="absolute left-0 top-8 z-[60] min-w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                        {[1, 5, 10].map((count) => {
                          const disabled = replenishCandidates.length < count;
                          return (
                            <button
                              key={count}
                              type="button"
                              disabled={disabled}
                              title={disabled ? `替补号池可用 ${replenishCandidates.length} 个，不足 ${count} 个` : undefined}
                              className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                              onClick={() => {
                                setOpenReplenishMenuInstanceId(null);
                                setQuickReplenishTarget({ instance: group.instance, count });
                              }}
                            >
                              补 {count} 个
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => openManualReplenish(group.instance)}
                        >
                          手动选择
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => openOAuthLogin(group.instance)}
                        >
                          <LogIn className="h-3 w-3" />
                          OAuth登录
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div ref={openBulkMenuInstanceId === group.instance.id ? bulkMenuRef : null} className="relative">
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${group.instance.name} 批量操作`}
                      aria-expanded={openBulkMenuInstanceId === group.instance.id}
                      onClick={() =>
                        setOpenBulkMenuInstanceId(
                          openBulkMenuInstanceId === group.instance.id ? null : group.instance.id,
                        )
                      }
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                    {openBulkMenuInstanceId === group.instance.id ? (
                      <div className="absolute left-0 top-7 z-[60] min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                        <button
                          type="button"
                          disabled={!hasAssignableProxy || isUpdating}
                          title={!hasAssignableProxy ? "没有启用且允许用于该 CPA 的代理" : undefined}
                          className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                          onClick={() => {
                            setOpenBulkMenuInstanceId(null);
                            void onAutoAssignCpaProxies(group.instance.id);
                          }}
                        >
                          自动分配代理
                        </button>
                        <Separator className="my-1" />
                        <button
                          type="button"
                          disabled={exceptionAuthFileIds.length === 0}
                          title={exceptionAuthFileIds.length === 0 ? "暂无异常账号" : undefined}
                          className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800 disabled:pointer-events-none disabled:opacity-45"
                          onClick={() => {
                            setOpenBulkMenuInstanceId(null);
                            setBulkExceptionTarget({
                              instance: group.instance,
                              action: "delete",
                              authFileIds: exceptionAuthFileIds,
                              title: "批量清理异常账号",
                              subject: "异常账号",
                              confirmVerb: "清理",
                              successVerb: "已清理",
                            });
                          }}
                        >
                          批量清理异常账号
                        </button>
                        <button
                          type="button"
                          disabled={exceptionAuthFileIds.length === 0}
                          title={exceptionAuthFileIds.length === 0 ? "暂无异常账号" : undefined}
                          className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                          onClick={() => {
                            setOpenBulkMenuInstanceId(null);
                            setBulkExceptionTarget({
                              instance: group.instance,
                              action: "disable",
                              authFileIds: exceptionAuthFileIds,
                              title: "批量停用异常账号",
                              subject: "异常账号",
                              confirmVerb: "停用",
                              successVerb: "已停用",
                            });
                          }}
                        >
                          批量停用异常账号
                        </button>
                        <button
                          type="button"
                          disabled={disabledAuthFileIds.length === 0}
                          title={disabledAuthFileIds.length === 0 ? "暂无已停用账号" : undefined}
                          className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800 disabled:pointer-events-none disabled:opacity-45"
                          onClick={() => {
                            setOpenBulkMenuInstanceId(null);
                            setBulkExceptionTarget({
                              instance: group.instance,
                              action: "delete",
                              authFileIds: disabledAuthFileIds,
                              title: "批量删除已停用账号",
                              subject: "已停用账号",
                              confirmVerb: "删除",
                              successVerb: "已删除",
                            });
                          }}
                        >
                          批量删除已停用账号
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <HeaderAverageMeter label="5h均剩余" value={average5hRemaining} tone="sky" />
                  <HeaderAverageMeter label="周均剩余" value={averageWeekRemaining} tone="emerald" />
                  <span className="text-emerald-700">{availableCount} 可用</span>
                  {limitedRows.length > 0 ? <span className="text-amber-700">{limitedRows.length} 限额</span> : null}
                  {disabledCount > 0 ? <span>{disabledCount} 停用</span> : null}
                  <span className="text-rose-700">{exceptionCount} 异常</span>
                </div>
              </div>
              <CompactAuthFileTable
                rows={rows}
                nowMs={nowMs}
                canMove={enabledInstances.length > 1}
                onRequestDelete={setDeleteTarget}
                onRequestMove={openMoveDialog}
                onRequestConfigureProxy={openProxyDialog}
                onToggleDisabled={onToggleAuthFileDisabled}
                onRefreshQuota={onRefreshAuthFileQuota}
              />
              {isUpdating ? (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
                  <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    正在更新
                  </div>
                </div>
              ) : null}
            </div>
          );
  }

  return (
    <>
      <section className={cn(groupColumns.length > 1 ? "grid grid-cols-2 gap-3" : "space-y-3")}>
        {groupColumns.length === 1
          ? groupColumns[0].map(renderGroupCard)
          : groupColumns.map((column, columnIndex) => (
              <div key={columnIndex} className="space-y-3">
                {column.map(renderGroupCard)}
              </div>
            ))}
      </section>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除账号</DialogTitle>
            <DialogDescription>
              确定要从 CPA 中删除 {deleteTarget?.email ?? deleteTarget?.fileName ?? "这个账号"} 吗？这个操作会同时删除本地记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) {
                  return;
                }
                const targetId = deleteTarget.id;
                setDeleteTarget(null);
                void onDeleteAuthFile(targetId);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveTarget !== null} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动账号</DialogTitle>
            <DialogDescription>
              选择目标 CPA。确认后会先上传认证文件到目标 CPA，再从当前 CPA 删除。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="move-target-cpa">目标 CPA</Label>
            <select
              id="move-target-cpa"
              value={moveTargetInstanceId}
              onChange={(event) => setMoveTargetInstanceId(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {moveOptions.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>
            {moveOptions.length === 0 ? (
              <div className="text-sm text-muted-foreground">没有其他已启用 CPA 可移动。</div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMoveTarget(null)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!moveTarget || !moveTargetInstanceId}
              onClick={() => {
                if (!moveTarget || !moveTargetInstanceId) {
                  return;
                }
                const authFileId = moveTarget.id;
                const targetId = Number(moveTargetInstanceId);
                setMoveTarget(null);
                void onMoveAuthFile(authFileId, targetId);
              }}
            >
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={proxyTarget !== null} onOpenChange={(open) => !open && setProxyTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>配置代理</DialogTitle>
            <DialogDescription>
              为 {proxyTarget?.email ?? proxyTarget?.fileName ?? "这个账号"} 选择该 CPA 可用的代理。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="auth-file-proxy">代理</Label>
            <select
              id="auth-file-proxy"
              value={proxyTargetUrl}
              onChange={(event) => setProxyTargetUrl(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">不使用代理</option>
              {proxyOptions.map((proxy) => (
                <option key={proxy.id} value={proxy.url}>
                  {proxy.name}
                </option>
              ))}
            </select>
            {proxyOptions.length === 0 ? (
              <div className="text-sm text-muted-foreground">这个 CPA 暂无可用代理。</div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProxyTarget(null)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!proxyTarget}
              onClick={() => {
                if (!proxyTarget) {
                  return;
                }
                const authFileId = proxyTarget.id;
                const nextProxyUrl = proxyTargetUrl || null;
                setProxyTarget(null);
                void onConfigureAuthFileProxy(authFileId, nextProxyUrl);
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={quickReplenishTarget !== null} onOpenChange={(open) => !open && setQuickReplenishTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认补号</DialogTitle>
            <DialogDescription>
              确认给 {quickReplenishTarget?.instance.name ?? "这个 CPA"} 补入 {quickReplenishTarget?.count ?? 0} 个账号吗？当前替补号池可用 {replenishCandidates.length} 个。
            </DialogDescription>
          </DialogHeader>
          {quickReplenishTarget && !quickReplenishHasEnough ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              替补号池数量不足，无法执行本次快捷补号。
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setQuickReplenishTarget(null)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!quickReplenishTarget || !quickReplenishHasEnough}
              onClick={() => {
                if (!quickReplenishTarget || !quickReplenishHasEnough) {
                  return;
                }
                const { instance, count } = quickReplenishTarget;
                setQuickReplenishTarget(null);
                void onReplenish(instance.id, { count });
              }}
            >
              确认补入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manualReplenishInstance !== null}
        onOpenChange={(open) => {
          if (!open) {
            setManualReplenishInstance(null);
            setManualSelectedBackupIds([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>手动补号</DialogTitle>
            <DialogDescription>
              选择要补进 {manualReplenishInstance?.name ?? "目标 CPA"} 的替补账号。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[58vh] overflow-auto rounded-md border">
            <table className="w-full caption-bottom text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-3 py-2"></TableHead>
                  <TableHead className="px-3 py-2">邮箱</TableHead>
                  <TableHead className="px-3 py-2">状态</TableHead>
                  <TableHead className="px-3 py-2">异常</TableHead>
                  <TableHead className="px-3 py-2 text-right">导入时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replenishCandidates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                      暂无可补的替补账号
                    </TableCell>
                  </TableRow>
                ) : (
                  replenishCandidates.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="px-3 py-2">
                        <Checkbox
                          checked={manualSelectedBackupIds.includes(account.id)}
                          onCheckedChange={(checked) => toggleManualBackupId(account.id, checked === true)}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2 font-medium">{account.email}</TableCell>
                      <TableCell className="px-3 py-2">{account.status}</TableCell>
                      <TableCell className="max-w-[220px] px-3 py-2">
                        <span className="block truncate text-muted-foreground" title={account.exception ?? "无异常"}>
                          {account.exception ?? "无异常"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                        {formatDate(account.importedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setManualReplenishInstance(null);
                setManualSelectedBackupIds([]);
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!manualReplenishInstance || manualSelectedBackupIds.length === 0}
              onClick={() => {
                if (!manualReplenishInstance || manualSelectedBackupIds.length === 0) {
                  return;
                }
                const targetInstanceId = manualReplenishInstance.id;
                const backupAccountIds = manualSelectedBackupIds;
                setManualReplenishInstance(null);
                setManualSelectedBackupIds([]);
                void onReplenish(targetInstanceId, { backupAccountIds });
              }}
            >
              确认补入 {manualSelectedBackupIds.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={oauthLogin !== null}
        onOpenChange={(open) => {
          if (!open && !oauthLogin?.submitting) {
            setOauthLogin(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>OAuth登录</DialogTitle>
            <DialogDescription>
              {oauthLogin?.instance.name ?? "当前 CPA"} 的 Codex OAuth 登录链接。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {oauthLogin?.loading ? (
              <div className="flex h-24 items-center justify-center gap-2 rounded-md border bg-muted/30 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在生成登录链接
              </div>
            ) : null}
            {oauthLogin && !oauthLogin.loading ? (
              <>
                {oauthLogin.error ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                    {oauthLogin.error}
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="codex-oauth-url">登录链接</Label>
                  <div className="flex gap-2">
                    <Input
                      id="codex-oauth-url"
                      value={oauthLogin.authUrl ?? ""}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!oauthLogin.authUrl}
                      onClick={() => {
                        if (oauthLogin.authUrl) {
                          window.open(oauthLogin.authUrl, "_blank", "noopener,noreferrer");
                        }
                      }}
                    >
                      <ExternalLink className="h-4 w-4" />
                      打开
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!oauthLogin.authUrl}
                      onClick={() => void copyOAuthUrl()}
                    >
                      <Copy className="h-4 w-4" />
                      复制
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="codex-oauth-callback-url">回调 URL</Label>
                  <Input
                    id="codex-oauth-callback-url"
                    value={oauthLogin.callbackUrl}
                    placeholder="粘贴登录完成后的回调 URL"
                    disabled={oauthLogin.submitting}
                    onChange={(event) =>
                      setOauthLogin((current) =>
                        current ? { ...current, callbackUrl: event.target.value } : current,
                      )
                    }
                  />
                </div>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={oauthLogin?.submitting}
              onClick={() => setOauthLogin(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={
                !oauthLogin ||
                oauthLogin.loading ||
                oauthLogin.submitting ||
                !oauthLogin.authUrl ||
                !oauthLogin.callbackUrl.trim()
              }
              onClick={() => void submitOAuthCallback()}
            >
              {oauthLogin?.submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkExceptionTarget !== null}
        onOpenChange={(open) => !open && setBulkExceptionTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{bulkExceptionTarget?.title ?? "批量操作"}</DialogTitle>
            <DialogDescription>
              确认对 {bulkExceptionTarget?.instance.name ?? "这个 CPA"} 的 {bulkExceptionTarget?.authFileIds.length ?? 0} 个
              {bulkExceptionTarget?.subject ?? "账号"}执行{bulkExceptionTarget?.confirmVerb ?? "操作"}吗？操作会调用 CPA 接口并在完成后刷新该 CPA。
            </DialogDescription>
          </DialogHeader>
          {bulkExceptionTarget?.action === "delete" ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              删除会从 CPA 中移除认证文件，并清理本地账号和配额记录。
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkExceptionTarget(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant={bulkExceptionTarget?.action === "delete" ? "destructive" : "default"}
              disabled={!bulkExceptionTarget || bulkExceptionTarget.authFileIds.length === 0}
              onClick={() => {
                if (!bulkExceptionTarget || bulkExceptionTarget.authFileIds.length === 0) {
                  return;
                }
                const target = bulkExceptionTarget;
                setBulkExceptionTarget(null);
                void onBatchHandleExceptionAuthFiles(
                  target.instance.id,
                  target.action,
                  target.authFileIds,
                  target.successVerb,
                  target.subject,
                );
              }}
            >
              确认{bulkExceptionTarget?.confirmVerb ?? "操作"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type AuthFileQuotaRow = {
  id: number;
  cpaInstanceId: number;
  fileName: string;
  email: string | null;
  proxyUrl: string | null;
  proxyName: string | null;
  disabled: boolean;
  available: boolean;
  quotaStatus: AccountQuotaState;
  quotaStatusLabel: string;
  subscriptionType: string | null;
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
  exception: string | null;
  refreshedAt: string;
};

function CompactAuthFileTable({
  rows,
  nowMs,
  canMove,
  onRequestDelete,
  onRequestMove,
  onRequestConfigureProxy,
  onToggleDisabled,
  onRefreshQuota,
}: {
  rows: AuthFileQuotaRow[];
  nowMs: number;
  canMove: boolean;
  onRequestDelete: (row: AuthFileQuotaRow) => void;
  onRequestMove: (row: AuthFileQuotaRow) => void;
  onRequestConfigureProxy: (row: AuthFileQuotaRow) => void;
  onToggleDisabled: (id: number, disabled: boolean) => Promise<void>;
  onRefreshQuota: (id: number) => Promise<void>;
}) {
  const [openActionRowId, setOpenActionRowId] = useState<number | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState({ left: 0, top: 0 });
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openActionRowId === null) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && actionMenuRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Node && actionTriggerRef.current?.contains(target)) {
        return;
      }
      setOpenActionRowId(null);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openActionRowId]);

  return (
    <div className="overflow-x-auto">
      <div className="max-h-[calc(100vh-260px)] min-w-[760px] overflow-y-auto">
        <table className="w-full caption-bottom text-sm">
          <TableHeader>
            <TableRow className="h-8">
              <TableHead className="sticky top-0 z-10 bg-card px-3 py-1 text-xs shadow-[0_1px_0_var(--border)]">账号</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">代理</TableHead>
              <TableHead className="sticky top-0 z-10 w-32 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                <CompactPercentHeader windowLabel="5h" />
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-32 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                <CompactPercentHeader windowLabel="周" />
              </TableHead>
              <TableHead className="sticky top-0 z-10 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">状态</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card px-3 py-1 text-right text-xs shadow-[0_1px_0_var(--border)]">刷新</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card px-3 py-1 text-right text-xs shadow-[0_1px_0_var(--border)]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-16 text-center text-sm text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn("h-9", row.disabled && "bg-muted/30 text-muted-foreground")}
                >
                  <TableCell className="max-w-[190px] px-3 py-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          row.quotaStatus === "disabled"
                            ? "bg-muted-foreground/50"
                            : row.quotaStatus === "available"
                              ? "bg-emerald-500"
                              : row.quotaStatus === "limited"
                                ? "bg-amber-500"
                                : "bg-rose-500",
                        )}
                      />
                      <SubscriptionBadge value={row.subscriptionType} />
                      {row.disabled ? (
                        <Badge variant="outline" className="border-muted-foreground/25 text-muted-foreground">
                          停用
                        </Badge>
                      ) : null}
                      <HoverCopyTooltip
                        className="min-w-0 flex-1"
                        items={accountTooltipItems(row)}
                      >
                        <span className="block truncate text-xs font-medium">
                          {row.email ?? "-"}
                        </span>
                      </HoverCopyTooltip>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <HoverCopyTooltip
                      className="block max-w-[140px]"
                      items={proxyTooltipItems(row)}
                    >
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.proxyName ?? row.proxyUrl ?? "-"}
                      </span>
                    </HoverCopyTooltip>
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <CompactPercentBar value={row.usage5hPercent} tone="sky" />
                  </TableCell>
                  <TableCell className="px-2 py-1">
                    <CompactPercentBar value={row.usageWeekPercent} tone="emerald" />
                  </TableCell>
                  <TableCell className="max-w-[260px] px-2 py-1">
                    <span
                      title={row.quotaStatusLabel}
                      className={cn(
                        "block truncate text-xs",
                        row.quotaStatus === "exception"
                          ? "text-rose-700"
                          : row.quotaStatus === "limited"
                            ? "text-amber-700"
                            : "text-muted-foreground",
                      )}
                    >
                      {row.quotaStatusLabel}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-1 text-right text-xs text-muted-foreground">
                    <span title={formatDate(row.refreshedAt)}>
                      {formatRelativeTime(row.refreshedAt, nowMs)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-3 py-1 text-right">
                    <div
                      className="relative flex justify-end"
                    >
                      <Button
                        ref={openActionRowId === row.id ? actionTriggerRef : null}
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`${row.email ?? row.fileName} 操作`}
                        aria-expanded={openActionRowId === row.id}
                        aria-haspopup="menu"
                        onClick={(event) => {
                          if (openActionRowId === row.id) {
                            setOpenActionRowId(null);
                            return;
                          }
                          const rect = event.currentTarget.getBoundingClientRect();
                          const menuWidth = 128;
                          setActionMenuPosition({
                            left: Math.min(Math.max(rect.right - menuWidth, 8), window.innerWidth - menuWidth - 8),
                            top: rect.bottom + 6,
                          });
                          setOpenActionRowId(row.id);
                        }}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                      {openActionRowId === row.id && typeof document !== "undefined"
                        ? createPortal(
                            <div
                              ref={actionMenuRef}
                              role="menu"
                              className="fixed z-[120] min-w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                              style={{ left: actionMenuPosition.left, top: actionMenuPosition.top }}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                                onClick={() => {
                                  setOpenActionRowId(null);
                                  void onRefreshQuota(row.id);
                                }}
                              >
                                刷新配额
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                                onClick={() => {
                                  setOpenActionRowId(null);
                                  void onToggleDisabled(row.id, !row.disabled);
                                }}
                              >
                                {row.disabled ? "启用" : "停用"}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                                onClick={() => {
                                  setOpenActionRowId(null);
                                  onRequestConfigureProxy(row);
                                }}
                              >
                                配置代理
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                disabled={!canMove}
                                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                                onClick={() => {
                                  setOpenActionRowId(null);
                                  onRequestMove(row);
                                }}
                              >
                                移动到
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                                onClick={() => {
                                  setOpenActionRowId(null);
                                  onRequestDelete(row);
                                }}
                              >
                                删除
                              </button>
                            </div>,
                            document.body,
                          )
                        : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </table>
      </div>
    </div>
  );
}

function HoverCopyTooltip({
  items,
  className,
  children,
}: {
  items: Array<{ label: string; value: string }>;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const visibleItems = items.filter((item) => item.value.trim().length > 0);
  const hasValue = visibleItems.length > 0;

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openTooltip() {
    if (!hasValue) {
      return;
    }
    clearCloseTimer();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const maxLeft = Math.max(8, window.innerWidth - 360);
      setPosition({
        left: Math.min(Math.max(rect.left, 8), maxLeft),
        top: rect.top - 6,
      });
    }
    setOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }

  async function copyValue(
    event: React.MouseEvent<HTMLButtonElement>,
    item: { label: string; value: string },
  ) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.value);
      toast.success(`已复制${item.label}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败");
    }
  }

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={hasValue ? 0 : -1}
        className={cn("inline-block min-w-0", hasValue && "cursor-default", className)}
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleClose}
        onFocus={openTooltip}
        onBlur={scheduleClose}
      >
        {children}
      </span>
      {open && hasValue && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[100] max-w-sm rounded-md border bg-popover p-2 text-popover-foreground shadow-lg"
              style={{ left: position.left, top: position.top, transform: "translateY(-100%)" }}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
            >
              <div className="space-y-1">
                {visibleItems.map((item) => (
                  <div
                    key={`${item.label}-${item.value}`}
                    className="grid grid-cols-[3.5rem_minmax(0,1fr)_1.75rem] items-start gap-2"
                  >
                    <span className="pt-1 text-xs text-muted-foreground">
                      {item.label}
                    </span>
                    <div className="max-w-[20rem] break-all font-mono text-xs leading-6">
                      {item.value}
                    </div>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`复制${item.label}`}
                      title={`复制${item.label}`}
                      className="shrink-0"
                      onClick={(event) => void copyValue(event, item)}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function accountTooltipItems(row: AuthFileQuotaRow) {
  return compactTooltipItems([
    { label: "邮箱", value: row.email ?? "" },
    { label: "文件名", value: row.fileName },
  ]);
}

function proxyTooltipItems(row: AuthFileQuotaRow) {
  return compactTooltipItems([
    { label: "名称", value: row.proxyName ?? "" },
    { label: "URL", value: row.proxyUrl ?? "" },
  ]);
}

function compactTooltipItems(items: Array<{ label: string; value: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = item.value.trim();
    if (!value || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function CompactPercentHeader({ windowLabel }: { windowLabel: string }) {
  return (
    <div className="grid min-w-28 grid-cols-[2.75rem_1fr] items-center gap-2">
      <span className="text-right">{windowLabel}</span>
      <span>剩余</span>
    </div>
  );
}

function HeaderAverageMeter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "sky" | "emerald";
}) {
  const width = value ?? 0;
  const bar = tone === "sky" ? "bg-sky-500" : "bg-emerald-500";
  const text = tone === "sky" ? "text-sky-700" : "text-emerald-700";

  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap font-medium", text)}>
      <span>{label}</span>
      <span className="w-8 text-right tabular-nums">{formatPercent(value)}</span>
      <span className="h-1.5 w-12 overflow-hidden rounded bg-background ring-1 ring-border/60">
        <span className={cn("block h-full rounded", bar)} style={{ width: `${width}%` }} />
      </span>
    </span>
  );
}

function mergeAuthFilesWithQuotas(
  authFileRows: AuthFile[],
  quotas: QuotaSnapshot[],
  proxyNameByUrl: Map<string, string>,
): AuthFileQuotaRow[] {
  const quotaByFileName = new Map<string, QuotaSnapshot>();
  const quotaByEmail = new Map<string, QuotaSnapshot>();

  for (const quota of quotas) {
    if (quota.authFileName) {
      quotaByFileName.set(quota.authFileName, quota);
    }
    if (quota.email) {
      quotaByEmail.set(quota.email.toLowerCase(), quota);
    }
  }

  const rows = authFileRows.map((file) => {
    const proxyUrl = file.proxyUrl ?? proxyUrlFromRawAuthJson(file.rawJson);
    const quota =
      quotaByFileName.get(file.fileName) ??
      (file.email ? quotaByEmail.get(file.email.toLowerCase()) : undefined) ??
      null;
    const disabled = Boolean(file.disabled);
    const available = disabled ? false : quota?.available ?? file.available;
    const exception = disabled
      ? null
      : quota
        ? quota.exception
        : file.statusMessage ??
          (available ? null : file.status ?? "异常");
    const quotaStatus = resolveAccountQuotaStatus({
      disabled,
      available,
      exception,
      rawJson: quota?.rawJson ?? null,
    });

    return {
      id: file.id,
      cpaInstanceId: file.cpaInstanceId,
      fileName: file.fileName,
      email: quota?.email ?? file.email,
      proxyUrl,
      proxyName: proxyUrl ? proxyNameByUrl.get(proxyUrl) ?? null : null,
      disabled,
      available,
      quotaStatus: quotaStatus.state,
      quotaStatusLabel: quotaStatus.label,
      subscriptionType: quota?.subscriptionType ?? null,
      usage5hPercent: quota?.usage5hPercent ?? null,
      usageWeekPercent: quota?.usageWeekPercent ?? null,
      exception,
      refreshedAt: quota?.capturedAt ?? file.lastSyncedAt,
    };
  });

  return sortAccountRows(rows);
}

function proxyUrlFromRawAuthJson(rawJson: string | null) {
  if (!rawJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const value = (parsed as { proxy_url?: unknown }).proxy_url;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function distributeCpaGroups<T extends { authFiles: AuthFile[] }>(groups: T[]) {
  const columns: [T[], T[]] = [[], []];
  const heights = [0, 0];

  for (const group of groups) {
    const targetIndex = heights[0] <= heights[1] ? 0 : 1;
    columns[targetIndex].push(group);
    heights[targetIndex] += estimateCpaGroupHeight(group);
  }

  return columns;
}

function estimateCpaGroupHeight(group: { authFiles: AuthFile[] }) {
  return 5 + Math.min(group.authFiles.length, 26);
}

function CompactPercentBar({ value, tone }: { value: number | null; tone: "sky" | "emerald" }) {
  const remaining = value === null ? null : Math.max(0, Math.min(100, 100 - value));
  const width = remaining ?? 0;
  const bar = tone === "sky" ? "bg-sky-500" : "bg-emerald-500";

  return (
    <div className="grid min-w-28 grid-cols-[2.75rem_1fr] items-center gap-2">
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {remaining === null ? "-" : `${remaining}%`}
      </span>
      <div className="h-1.5 rounded bg-muted">
        <div className={cn("h-1.5 rounded", bar)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SubscriptionBadge({ value }: { value: string | null }) {
  if (!value) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "h-4 px-1.5 py-0 text-[10px] leading-none uppercase",
        subscriptionBadgeClass(value),
      )}
    >
      {formatSubscriptionType(value)}
    </Badge>
  );
}

function StrategiesSection({ rows, onSave }: { rows: StrategyRow[]; onSave: (strategy: StrategyRow["strategy"]) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<number, StrategyRow["strategy"]>>({});

  return (
    <section className="space-y-3">
      {rows.map((row) => {
        const draft = drafts[row.instance.id] ?? row.strategy;
        if (!draft) {
          return null;
        }
        return (
          <div key={row.instance.id} className="grid gap-3 rounded-md border bg-card p-4 xl:grid-cols-[1.3fr_repeat(5,1fr)_auto]">
            <div className="flex items-center gap-3">
              <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDrafts({ ...drafts, [row.instance.id]: { ...draft, enabled } })} />
              <div className="font-medium">{row.instance.name}</div>
            </div>
            <NumberField label="5h用量%" value={draft.maintain5hUsagePercent} onChange={(value) => setDrafts({ ...drafts, [row.instance.id]: { ...draft, maintain5hUsagePercent: value } })} />
            <NumberField label="周用量%" value={draft.maintainWeekUsagePercent} onChange={(value) => setDrafts({ ...drafts, [row.instance.id]: { ...draft, maintainWeekUsagePercent: value } })} />
            <NumberField label="可用账号" value={draft.minAvailableAccounts} onChange={(value) => setDrafts({ ...drafts, [row.instance.id]: { ...draft, minAvailableAccounts: value } })} />
            <NumberField label="单次上传" value={draft.maxBatchSize} onChange={(value) => setDrafts({ ...drafts, [row.instance.id]: { ...draft, maxBatchSize: value } })} />
            <div className="flex items-end">
              <Button onClick={() => void onSave(draft)}>
                <Save className="h-4 w-4" />
                保存
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ProxySection(props: {
  proxies: ProxyRow[];
  instances: CpaInstance[];
  checks: Record<number, ProxyCheckResult>;
  checking: boolean;
  form: typeof emptyProxy;
  editingId: number | null;
  open: boolean;
  setForm: (form: typeof emptyProxy) => void;
  setEditingId: (id: number | null) => void;
  setOpen: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleEnabled: (proxy: ProxyRow, enabled: boolean) => Promise<void>;
  onCheckAll: () => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const formId = "proxy-form";

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">代理列表</div>
          <div className="text-sm text-muted-foreground">配置代理名称、URL、允许使用账号数和允许应用的 CPA 实例。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={props.checking || props.proxies.length === 0}
            onClick={() => void props.onCheckAll()}
          >
            {props.checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
            一键检测
          </Button>
          <Button
            type="button"
            onClick={() => {
              props.setEditingId(null);
              props.setForm(emptyProxy);
              props.setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            添加代理
          </Button>
        </div>
      </div>

      <Dialog open={props.open} onOpenChange={props.setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{props.editingId ? "编辑代理" : "添加代理"}</DialogTitle>
            <DialogDescription>
              设置代理名称、地址、允许被多少账号使用，以及这个代理可用于哪些 CPA 实例。
            </DialogDescription>
          </DialogHeader>

          <form id={formId} onSubmit={props.onSubmit} className="grid gap-4">
            <Field label="代理名称">
              <Input value={props.form.name} onChange={(event) => props.setForm({ ...props.form, name: event.target.value })} placeholder="美国出口 01" required />
            </Field>
            <Field label="代理URL">
              <Input value={props.form.url} onChange={(event) => props.setForm({ ...props.form, url: event.target.value })} placeholder="http://user:pass@host:port" required />
            </Field>
            <NumberField label="允许被多少账号使用" value={props.form.maxAuthFiles} onChange={(maxAuthFiles) => props.setForm({ ...props.form, maxAuthFiles })} />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={props.form.enabled} onCheckedChange={(enabled) => props.setForm({ ...props.form, enabled })} />
              启用
            </label>
            <div className="space-y-2">
              <Label>应用CPA</Label>
              <div className="flex max-h-44 flex-wrap gap-3 overflow-auto rounded-md border bg-muted/25 p-3">
                {props.instances.map((instance) => (
                  <label key={instance.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={props.form.cpaInstanceIds.includes(instance.id)}
                      onCheckedChange={(checked) => {
                        const ids = checked
                          ? [...props.form.cpaInstanceIds, instance.id]
                          : props.form.cpaInstanceIds.filter((id) => id !== instance.id);
                        props.setForm({ ...props.form, cpaInstanceIds: ids });
                      }}
                    />
                    {instance.name}
                  </label>
                ))}
              </div>
            </div>
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.setOpen(false)}>
              取消
            </Button>
            <Button type="submit" form={formId}>
              <Plus className="h-4 w-4" />
              {props.editingId ? "保存" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DataTable
        headers={["名称", "代理URL", "允许账号数", "启用", "检测", "应用CPA", "操作"]}
        rows={props.proxies.map((proxy) => [
          <span key="name" className="font-medium">{proxy.name}</span>,
          <code key="url" className="text-xs">{proxy.url}</code>,
          proxy.maxAuthFiles,
          <Switch
            key="enabled"
            checked={proxy.enabled}
            aria-label={`${proxy.name} 启用状态`}
            onCheckedChange={(enabled) => void props.onToggleEnabled(proxy, enabled)}
          />,
          <ProxyCheckBadge
            key="check"
            result={props.checks[proxy.id]}
            checking={props.checking}
          />,
          <AppliedCpaTags
            key="cpa-instances"
            instances={props.instances.filter((instance) => proxy.cpaInstanceIds.includes(instance.id))}
          />,
          <div key="actions" className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { props.setEditingId(proxy.id); props.setForm({ name: proxy.name, url: proxy.url, maxAuthFiles: proxy.maxAuthFiles, enabled: proxy.enabled, notes: proxy.notes ?? "", cpaInstanceIds: proxy.cpaInstanceIds }); props.setOpen(true); }}>
              编辑
            </Button>
            <Button size="icon" variant="ghost" onClick={() => void props.onDelete(proxy.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>,
        ])}
      />
    </section>
  );
}

function JobsSection({ jobs, runs, onRun, onSave }: { jobs: CronJob[]; runs: JobRun[]; onRun: (key: string) => Promise<void>; onSave: (job: CronJob) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, CronJobDraft>>({});

  function updateDraft(job: CronJob, updater: (draft: CronJobDraft) => CronJobDraft) {
    setDrafts((current) => {
      const draft = current[job.key] ?? createJobDraft(job);
      return { ...current, [job.key]: updater(draft) };
    });
  }

  async function saveDraft(job: CronJob, draft: CronJobDraft) {
    await onSave({ ...job, cron: draft.cron, enabled: draft.enabled });
    setDrafts((current) => {
      const next = { ...current };
      delete next[job.key];
      return next;
    });
  }

  return (
    <section className="space-y-5">
      <DataTable
        headers={["任务", "执行频率", "状态", "下次执行", "最近执行", "错误", "操作"]}
        rows={jobs.map((job) => {
          const draft = drafts[job.key] ?? createJobDraft(job);
          return [
            <div key="name" className="font-medium">{job.name}</div>,
            <JobScheduleEditor
              key="schedule"
              schedule={draft.schedule}
              onChange={(schedule) =>
                updateDraft(job, (current) => ({
                  ...current,
                  schedule,
                  cron: simpleScheduleToCron(schedule),
                }))
              }
            />,
            <Switch
              key="enabled"
              checked={draft.enabled}
              onCheckedChange={(enabled) => updateDraft(job, (current) => ({ ...current, enabled }))}
            />,
            formatDate(job.nextRunAt),
            formatDate(job.lastRunAt),
            <span key="error" className="max-w-[280px] truncate text-rose-700">{job.lastError ?? "-"}</span>,
            <div key="actions" className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void saveDraft(job, draft)}>
                <Save className="h-4 w-4" />
                保存
              </Button>
              <Button size="sm" onClick={() => void onRun(job.key)}>
                <Play className="h-4 w-4" />
                执行
              </Button>
            </div>,
          ];
        })}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">执行记录</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            headers={["任务", "状态", "信息", "开始", "结束"]}
            rows={runs.map((run) => [
              run.jobKey,
              <StatusBadge key="status" ok={run.status === "success"} label={run.status} />,
              <span key="message" className="max-w-[420px] truncate">{run.message ?? "-"}</span>,
              formatDate(run.startedAt),
              formatDate(run.finishedAt),
            ])}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function createJobDraft(job: CronJob): CronJobDraft {
  const schedule = cronToSimpleSchedule(job.cron);
  return { ...job, schedule, cron: simpleScheduleToCron(schedule) };
}

function JobScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: CronSimpleSchedule;
  onChange: (schedule: CronSimpleSchedule) => void;
}) {
  return (
    <div className="min-w-[420px] space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={cn(compactControlClassName, "w-32")}
          value={schedule.mode}
          onChange={(event) => onChange(defaultScheduleForMode(event.target.value as CronSimpleMode, schedule))}
        >
          {Object.entries(cronModeLabels).map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>

        {schedule.mode === "interval" ? (
          <>
            <Input
              type="number"
              min={1}
              max={59}
              className="h-8 w-20"
              value={schedule.everyMinutes}
              onChange={(event) =>
                onChange({ ...schedule, everyMinutes: finiteInputNumber(event.currentTarget.valueAsNumber, schedule.everyMinutes) })
              }
            />
            <span className="text-sm text-muted-foreground">分钟</span>
            <div className="flex flex-wrap gap-1">
              {intervalPresets.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => onChange(preset.value)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </>
        ) : null}

        {schedule.mode === "hourly" ? (
          <>
            <span className="text-sm text-muted-foreground">第</span>
            <Input
              type="number"
              min={0}
              max={59}
              className="h-8 w-20"
              value={schedule.minute}
              onChange={(event) =>
                onChange({ ...schedule, minute: finiteInputNumber(event.currentTarget.valueAsNumber, schedule.minute) })
              }
            />
            <span className="text-sm text-muted-foreground">分钟</span>
          </>
        ) : null}

        {schedule.mode === "daily" ? (
          <Input
            type="time"
            className="h-8 w-32"
            value={schedule.time}
            onChange={(event) => onChange({ ...schedule, time: event.target.value })}
          />
        ) : null}

        {schedule.mode === "weekly" ? (
          <>
            <select
              className={cn(compactControlClassName, "w-24")}
              value={schedule.dayOfWeek}
              onChange={(event) => onChange({ ...schedule, dayOfWeek: Number(event.target.value) })}
            >
              {weekdayOptions.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
            <Input
              type="time"
              className="h-8 w-32"
              value={schedule.time}
              onChange={(event) => onChange({ ...schedule, time: event.target.value })}
            />
          </>
        ) : null}

        {schedule.mode === "advanced" ? (
          <Input
            className="h-8 w-60 font-mono text-xs"
            value={schedule.cron}
            onChange={(event) => onChange({ ...schedule, cron: event.target.value })}
            placeholder="*/10 * * * *"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{describeSimpleSchedule(schedule)}</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {simpleScheduleToCron(schedule) || "-"}
        </code>
      </div>
    </div>
  );
}

function defaultScheduleForMode(mode: CronSimpleMode, current: CronSimpleSchedule): CronSimpleSchedule {
  switch (mode) {
    case "interval":
      return current.mode === "interval" ? current : { mode: "interval", everyMinutes: 10 };
    case "hourly":
      return current.mode === "hourly" ? current : { mode: "hourly", minute: 0 };
    case "daily":
      return current.mode === "daily" ? current : { mode: "daily", time: scheduleTimeOrDefault(current) };
    case "weekly":
      return current.mode === "weekly" ? current : { mode: "weekly", dayOfWeek: 1, time: scheduleTimeOrDefault(current) };
    case "advanced":
      return current.mode === "advanced" ? current : { mode: "advanced", cron: simpleScheduleToCron(current) };
    default:
      return { mode: "advanced", cron: simpleScheduleToCron(current) };
  }
}

function scheduleTimeOrDefault(schedule: CronSimpleSchedule) {
  return schedule.mode === "daily" || schedule.mode === "weekly" ? schedule.time : "00:00";
}

function finiteInputNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function ReplenishmentRecordsSection({ records }: { records: ReplenishmentRecord[] }) {
  return (
    <section className="space-y-5">
      <DataTable
        headers={["时间", "来源", "CPA", "邮箱", "文件名", "状态", "原因/错误"]}
        rows={records.map((record) => [
          <span key="time" className="whitespace-nowrap text-muted-foreground">
            {formatDate(record.createdAt)}
          </span>,
          <Badge key="source" variant="outline" className={cn("whitespace-nowrap", replenishmentSourceClass(record.source))}>
            {formatReplenishmentSource(record.source)}
          </Badge>,
          <span key="cpa" className="font-medium">{record.cpaInstanceName ?? "-"}</span>,
          <span key="email" className="whitespace-nowrap">{record.email ?? "-"}</span>,
          <span key="file" className="block max-w-[260px] truncate text-xs text-muted-foreground" title={record.authFileName ?? "-"}>
            {record.authFileName ?? "-"}
          </span>,
          <StatusBadge key="status" ok={record.status === "success"} label={record.status === "success" ? "成功" : "失败"} />,
          <span
            key="detail"
            className={cn(
              "block max-w-[360px] truncate text-xs",
              record.error ? "text-rose-700" : "text-muted-foreground",
            )}
            title={record.error ?? formatReasonCodes(record.reasonCodes)}
          >
            {record.error ?? formatReasonCodes(record.reasonCodes)}
          </span>,
        ])}
      />
    </section>
  );
}

function BackupAccountsSection(props: {
  accounts: BackupAccount[];
  text: string;
  setText: (text: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (id: number) => Promise<void>;
  onClear: (id: number) => Promise<void>;
}) {
  return (
    <section className="space-y-5">
      <form onSubmit={props.onSubmit} className="space-y-3 rounded-md border bg-card p-4">
        <Label>批量上传</Label>
        <Textarea value={props.text} onChange={(event) => props.setText(event.target.value)} className="min-h-36 font-mono text-xs" />
        <Button type="submit">
          <Plus className="h-4 w-4" />
          导入
        </Button>
      </form>
      <DataTable
        headers={["邮箱", "当前归属", "文件名", "状态", "异常", "导入时间", "操作"]}
        rows={props.accounts.map((account) => [
          account.email,
          account.ownerName ?? "无归属",
          account.assignedAuthFileName ?? "-",
          <StatusBadge key="status" ok={!account.exception} label={account.status} />,
          <span key="exception" className="max-w-[320px] truncate text-rose-700">{account.exception ?? "无异常"}</span>,
          formatDate(account.importedAt),
          <div key="actions" className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void props.onClear(account.id)}>
              清归属
            </Button>
            <Button size="icon" variant="ghost" onClick={() => void props.onDelete(account.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>,
        ])}
      />
    </section>
  );
}

function StatCard({ label, value, sub, tone = "slate" }: { label: string; value: string | number; sub: string; tone?: "slate" | "emerald" | "amber" | "sky" }) {
  const toneClass = {
    slate: "bg-slate-100 text-slate-800",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-900",
    sky: "bg-sky-100 text-sky-800",
  }[tone];
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-end justify-between">
        <div className="text-2xl font-semibold">{value}</div>
        <span className={cn("rounded px-2 py-1 text-xs", toneClass)}>{sub}</span>
      </div>
    </div>
  );
}

function ProxyCheckBadge({
  result,
  checking,
}: {
  result: ProxyCheckResult | undefined;
  checking: boolean;
}) {
  if (checking) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        检测中
      </span>
    );
  }

  if (!result) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (result.ok) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-200 bg-emerald-50 text-emerald-700"
        title={result.message}
      >
        可用{typeof result.latencyMs === "number" ? ` ${result.latencyMs}ms` : ""}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="max-w-40 truncate border-rose-200 bg-rose-50 text-rose-700"
      title={result.message}
    >
      失败
    </Badge>
  );
}

function AppliedCpaTags({ instances }: { instances: CpaInstance[] }) {
  if (instances.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="flex max-w-80 flex-wrap gap-1.5">
      {instances.map((instance) => (
        <Badge
          key={instance.id}
          variant="outline"
          className="max-w-36 truncate px-1.5 py-0 text-xs font-normal"
          title={instance.name}
        >
          {instance.name}
        </Badge>
      ))}
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header} className="whitespace-nowrap">{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={headers.length} className="h-24 text-center text-muted-foreground">
                暂无数据
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow key={index}>
                {row.map((cell, cellIndex) => (
                  <TableCell key={cellIndex} className="align-middle">{cell}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge className={cn(ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800", "hover:bg-current/10")}>
      {label}
    </Badge>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Field label={label}>
      <Input type="number" value={value} min={0} onChange={(event) => onChange(Number(event.target.value))} />
    </Field>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? response.statusText);
  }
  return payload as T;
}

async function mutate<T = { status: string }>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? response.statusText);
  }
  return payload as T;
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRelativeTime(value: string | null, nowMs: number) {
  if (!value) {
    return "-";
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "-";
  }

  const seconds = Math.max(0, Math.floor((nowMs - timestamp) / 1000));
  if (seconds < 60) {
    return "刚刚";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}小时前`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}天前`;
  }

  return formatDate(value);
}

function secondsUntilJobRun(job: CronJob | null, nowMs: number) {
  if (!job?.enabled) {
    return null;
  }

  if (job.nextRunAt) {
    const nextRunAt = new Date(job.nextRunAt).getTime();
    if (Number.isFinite(nextRunAt)) {
      return Math.max(0, Math.ceil((nextRunAt - nowMs) / 1000));
    }
  }

  return job.secondsUntilNextRun;
}

function formatCountdown(seconds: number) {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  const remainingSeconds = clamped % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatPercent(value: number | null) {
  return value === null ? "-" : `${value}%`;
}

function buildCpaManagementHref(baseUrl: string) {
  const trimmed = baseUrl.trim();
  try {
    return new URL("/management.html#/", trimmed).toString();
  } catch {
    return `${trimmed.replace(/\/+$/, "")}/management.html#/`;
  }
}

function formatSubscriptionType(value: string) {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    enterprise: "Enterprise",
    team: "Team",
    pro: "Pro 20x",
    pro20x: "Pro 20x",
    "pro-20x": "Pro 20x",
    pro_20x: "Pro 20x",
    prolite: "Pro 5x",
    "pro-lite": "Pro 5x",
    pro_lite: "Pro 5x",
    pro5x: "Pro 5x",
    "pro-5x": "Pro 5x",
    pro_5x: "Pro 5x",
    plus: "Plus",
    free: "Free",
  };

  return labels[normalized] ?? value;
}

function formatReplenishmentSource(value: string) {
  const labels: Record<string, string> = {
    auto: "自动",
    manual: "手动",
    quick: "快捷",
  };

  return labels[value] ?? value;
}

function replenishmentSourceClass(value: string) {
  const classes: Record<string, string> = {
    auto: "border-emerald-300 bg-emerald-50 text-emerald-800",
    manual: "border-blue-300 bg-blue-50 text-blue-800",
    quick: "border-amber-300 bg-amber-50 text-amber-900",
  };

  return classes[value] ?? "border-slate-300 bg-slate-50 text-slate-700";
}

function formatReasonCodes(value: string | null) {
  if (!value) {
    return "-";
  }

  try {
    const codes = JSON.parse(value) as unknown;
    if (!Array.isArray(codes)) {
      return value;
    }

    return codes.map((code) => reasonCodeLabel(String(code))).join("、") || "-";
  } catch {
    return value;
  }
}

function reasonCodeLabel(value: string) {
  const labels: Record<string, string> = {
    available_accounts_below_target: "可用账号不足",
    usage_5h_below_target: "5h用量低于策略",
    usage_week_below_target: "周用量低于策略",
  };

  return labels[value] ?? value;
}

function subscriptionBadgeClass(value: string) {
  const normalized = value.trim().toLowerCase();
  const classes: Record<string, string> = {
    enterprise: "border-emerald-300 bg-emerald-50 text-emerald-800",
    team: "border-cyan-300 bg-cyan-50 text-cyan-800",
    pro: "border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(217,119,6,0.22)]",
    pro20x: "border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(217,119,6,0.22)]",
    "pro-20x": "border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(217,119,6,0.22)]",
    pro_20x: "border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(217,119,6,0.22)]",
    prolite: "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    "pro-lite": "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    pro_lite: "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    pro5x: "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    "pro-5x": "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    pro_5x: "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    plus: "border-blue-300 bg-blue-50 text-blue-800",
    free: "border-slate-300 bg-slate-50 text-slate-700",
  };

  return classes[normalized] ?? "border-slate-300 bg-slate-50 text-slate-700";
}
