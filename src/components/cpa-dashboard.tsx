"use client";

import {
  Activity,
  ArrowLeftRight,
  ArchiveX,
  BarChart3,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileKey2,
  Info,
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
  Wallet,
} from "lucide-react";
import {
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { DataBoardSection } from "@/components/data-board-section";
import { MessagePushSection } from "@/components/message-push-section";
import { QuotaSettingsSection } from "@/components/quota-settings-section";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarModeMenu } from "@/components/sidebar-mode-menu";
import { useSidebar } from "@/components/use-sidebar";
import { SIDEBAR_COLLAPSED_WIDTH } from "@/lib/sidebar";
import { accountTagMaxLength } from "@/lib/account-tags";
import {
  resolveAccountQuotaStatus,
  type AccountQuotaState,
} from "@/lib/account-quota-status";
import { selectAvailableAuthFileIds } from "@/lib/auth-exchange-selection";
import { sortAccountRows } from "@/lib/account-sort";
import { buildAutoAuthFileName } from "@/lib/codex-auth";
import { onlyEnabledCpaGroups } from "@/lib/cpa-groups";
import {
  cpaTableUpdatingIdsForJob,
  jobFinishedAtOrAfter,
} from "@/lib/cpa-sync-targets";
import { getFloatingMenuPosition } from "@/lib/floating-menu";
import {
  cronToSimpleSchedule,
  describeSimpleSchedule,
  simpleScheduleToCron,
  type CronSimpleMode,
  type CronSimpleSchedule,
} from "@/lib/cron-presets";
import {
  averageAccountRemainingPercent,
  buildSubscriptionWeightMap,
  accountQuotaDollars,
  subscriptionRemainingDollars,
  type SubscriptionWeightMap,
} from "@/lib/quota-summary";
import {
  defaultRtLoginProxyMode,
  type RtLoginProxyMode,
} from "@/lib/rt-login-ui";
import { isFreeSubscriptionType, extractSubscriptionType } from "@/lib/subscription";
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
  accountTag: string | null;
  proxyUrl: string | null;
  rawJson: string | null;
  createdAt: string;
  lastSyncedAt: string;
};

type ExceptionAuthFile = {
  id: number;
  sourceCpaInstanceId: number | null;
  sourceCpaInstanceName: string;
  fileName: string;
  email: string | null;
  lastError: string | null;
  rawJson: string;
  createdAt: string;
  updatedAt: string;
};

type QuotaSnapshot = {
  id: number;
  email: string | null;
  authFileName: string | null;
  subscriptionType: string | null;
  quotaStatus: AccountQuotaState | null;
  quotaStatusLabel: string | null;
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
  usage5hResetAt: string | null;
  usageWeekResetAt: string | null;
  available: boolean;
  exception: string | null;
  rawJson: string | null;
  capturedAt: string;
  usage5hStale?: boolean;
  usageWeekStale?: boolean;
};

type SubscriptionQuotaSetting = {
  subscriptionType: string;
  usage5hDollars: number | null;
  usageWeekDollars: number | null;
};

type CandidateAuthFile = {
  id: number;
  fileName: string;
  email: string | null;
  provider: string | null;
  available: boolean;
  status: string | null;
  statusMessage: string | null;
  rawJson: string | null;
  quotaRawJson: string | null;
  quotaStatus: AccountQuotaState | null;
  quotaStatusLabel: string | null;
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
  usage5hResetAt: string | null;
  usageWeekResetAt: string | null;
  subscriptionType: string | null;
  lastRefresh: string | null;
  expired: string | null;
  refreshToken: string | null;
  lastQuotaRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

type CronJob = {
  id: number;
  key: string;
  name: string;
  cron: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  running: boolean;
  runningStartedAt: string | null;
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

type JobRunsPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type CpaSyncPhase = "auth_files" | "auth_payloads" | "quotas";
type CpaBusyPhase = CpaSyncPhase | "updating";

type JobsApiResponse = {
  jobs: CronJob[];
  runs: JobRun[];
  cpaSyncs: Array<{
    cpaInstanceId: number;
    phase: CpaSyncPhase;
    startedAt: string;
  }>;
  runsPagination: JobRunsPagination;
};

type BatchExceptionAction =
  | "delete"
  | "disable"
  | "portalExceptions"
  | "portalCandidates";
type BatchAuthFileTarget = "selected" | "free";
type AuthExchangeMode = "download" | "move";

type CronJobDraft = CronJob & {
  schedule: CronSimpleSchedule;
};

type CodexOAuthStartResult = {
  authUrl: string;
  state: string | null;
};

type RtLoginMode = "rt" | "mobile_rt";
type RtLoginAccountOptions = {
  proxyId?: number | null;
};

type RtLoginAuthResult = {
  email: string;
  fileName: string;
  planType: string;
  payload: Record<string, unknown>;
  refreshToken: string;
  sourceLine: string;
};

type RtLoginUploadResult = {
  uploaded: number;
  failed: number;
  results: Array<{
    email: string | null;
    fileName: string | null;
    status: "success" | "error" | string;
    error?: string;
  }>;
};

type CpaJsonUploadFile = {
  fileName: string;
  payload: unknown;
};

type CpaJsonUploadResult = {
  uploaded: number;
  failed: number;
  results: Array<{
    email: string | null;
    fileName: string | null;
    status: "success" | "error" | string;
    error?: string;
  }>;
};

type CpaJsonUploadSource = "session-json";
type CandidateQuotaRefreshMode = "withRt" | "withoutRt";

const navItems = [
  { id: "auth", label: "账号管理", icon: FileKey2, href: "/auth" },
  {
    id: "candidate-pool",
    label: "候补号池",
    icon: Database,
    href: "/candidate-pool",
  },
  { id: "exceptions", label: "异常账号", icon: ArchiveX, href: "/exceptions" },
  { id: "dashboard", label: "数据看板", icon: BarChart3, href: "/dashboard" },
  { id: "instances", label: "CPA管理", icon: Server, href: "/instances" },
  { id: "proxies", label: "代理管理", icon: Network, href: "/proxies" },
  { id: "message-push", label: "消息推送", icon: Bell, href: "/message-push" },
  { id: "quota-settings", label: "额度设置", icon: Wallet, href: "/quota-settings" },
  { id: "jobs", label: "定时任务", icon: Activity, href: "/jobs" },
] as const;

export type SectionId = (typeof navItems)[number]["id"];

function sectionFromPathname(pathname: string): SectionId | null {
  const segment = pathname.split("/").filter(Boolean)[0];
  if (segment === "quotas") {
    return "auth";
  }
  return navItems.find((item) => item.id === segment)?.id ?? null;
}

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

const defaultJobRunsPagination: JobRunsPagination = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};
const syncJobKey = "sync-cpa-instances";
const scheduledSyncPollIntervalMs = 2000;
const scheduledSyncTimeoutMs = 10 * 60 * 1000;
const authExchangeQuickSelectCounts = [10, 20, 50, 100] as const;

export function CpaDashboard({
  section = "instances",
}: {
  section?: SectionId;
}) {
  const [clientSection, setClientSection] = useState<SectionId>(section);
  const activeSection = clientSection;
  const [instances, setInstances] = useState<CpaInstance[]>([]);
  const [authGroups, setAuthGroups] = useState<
    Array<{ instance: CpaInstance; authFiles: AuthFile[] }>
  >([]);
  const [candidateAuthFiles, setCandidateAuthFiles] = useState<
    CandidateAuthFile[]
  >([]);
  const [exceptionAuthFiles, setExceptionAuthFiles] = useState<
    ExceptionAuthFile[]
  >([]);
  const [quotaGroups, setQuotaGroups] = useState<
    Array<{ instance: CpaInstance; quotas: QuotaSnapshot[] }>
  >([]);
  const [subscriptionQuotas, setSubscriptionQuotas] = useState<
    SubscriptionQuotaSetting[]
  >([]);
  const [proxies, setProxies] = useState<ProxyRow[]>([]);
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [runsPagination, setRunsPagination] = useState<JobRunsPagination>(
    defaultJobRunsPagination,
  );
  const runsPaginationRef = useRef<JobRunsPagination>(defaultJobRunsPagination);
  const scheduledSyncRunRef = useRef<string | null>(null);
  const remoteSyncRunningRef = useRef(false);
  const remoteCpaSyncingIdsRef = useRef<Set<number>>(new Set());
  const remoteCpaAccountUpdatingIdsRef = useRef<Set<number>>(new Set());
  const [updatingCpaIds, setUpdatingCpaIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [remoteUpdatingCpaIds, setRemoteUpdatingCpaIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [syncingCpaIds, setSyncingCpaIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [remoteSyncingCpaIds, setRemoteSyncingCpaIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [syncingCpaPhases, setSyncingCpaPhases] = useState<
    Map<number, CpaBusyPhase>
  >(() => new Map());
  const [remoteSyncingCpaPhases, setRemoteSyncingCpaPhases] = useState<
    Map<number, CpaSyncPhase>
  >(() => new Map());
  const [runningJobKeys, setRunningJobKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [proxyChecks, setProxyChecks] = useState<
    Record<number, ProxyCheckResult>
  >({});
  const [checkingProxies, setCheckingProxies] = useState(false);
  const [refreshingCandidatePool, setRefreshingCandidatePool] =
    useState<CandidateQuotaRefreshMode | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dataRefreshVersion, setDataRefreshVersion] = useState(0);
  const [instanceForm, setInstanceForm] = useState(emptyInstance);
  const [editingInstanceId, setEditingInstanceId] = useState<number | null>(
    null,
  );
  const [instanceDialogOpen, setInstanceDialogOpen] = useState(false);
  const [proxyForm, setProxyForm] = useState(emptyProxy);
  const [editingProxyId, setEditingProxyId] = useState<number | null>(null);
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);

  const activeLabel =
    navItems.find((item) => item.id === activeSection)?.label ?? "CPA Nexus";

  const sidebar = useSidebar();
  const sidebarCollapsed = sidebar.mode === "collapsed";
  const sidebarColumns =
    sidebar.mode === "collapsed"
      ? `${SIDEBAR_COLLAPSED_WIDTH}px 1fr`
      : "var(--sidebar-w) 1fr";

  const renderSidebarResizeHandle = () => (
    <div
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度"
      onMouseDown={sidebar.startResize}
      className="group/resize absolute right-0 top-0 hidden h-full w-1.5 cursor-col-resize lg:block"
    >
      <span
        className={cn(
          "absolute right-0 top-0 h-full w-px transition-colors",
          sidebar.resizing
            ? "w-0.5 bg-primary"
            : "bg-transparent group-hover/resize:w-0.5 group-hover/resize:bg-primary",
        )}
      />
    </div>
  );

  const renderSidebarInner = (collapsed: boolean) => (
    <div className="flex h-full flex-col">
      <div className="flex min-h-14 items-center gap-2 border-b px-2 py-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Network className="h-3.5 w-3.5" />
        </div>
        <div
          className={cn(
            "truncate text-[13px] font-semibold",
            collapsed && "lg:hidden",
          )}
        >
          CPA Nexus
        </div>
        <div
          className={cn(
            "ml-auto shrink-0",
            collapsed && "lg:ml-0 lg:w-full lg:justify-items-center",
          )}
        >
          <SidebarModeMenu mode={sidebar.mode} onSelect={sidebar.setMode} />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto p-1 lg:flex-col lg:overflow-visible">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.id}
              href={item.href}
              title={collapsed ? item.label : undefined}
              onClick={(event) => navigateSection(event, item.id, item.href)}
              className={cn(
                "flex h-8 min-w-max items-center gap-1.5 rounded-md px-1.5 text-[12.5px] transition-colors",
                collapsed && "lg:min-w-0 lg:justify-center lg:px-0",
                activeSection === item.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className={cn(collapsed && "lg:hidden")}>{item.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );

  useEffect(() => {
    function handlePopState() {
      setClientSection(sectionFromPathname(window.location.pathname) ?? section);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [section]);

  function navigateSection(
    event: MouseEvent<HTMLAnchorElement>,
    targetSection: SectionId,
    href: string,
  ) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();
    if (targetSection !== activeSection) {
      setClientSection(targetSection);
      window.scrollTo({ top: 0 });
    }
    if (window.location.pathname !== href) {
      window.history.pushState({ section: targetSection }, "", href);
    }
  }

  const markCpaTablesUpdating = useCallback(
    (cpaInstanceIds: number[], updating: boolean) => {
      if (cpaInstanceIds.length === 0) {
        return;
      }

      setUpdatingCpaIds((current) => {
        const next = new Set(current);
        cpaInstanceIds.forEach((id) => {
          if (updating) {
            next.add(id);
          } else {
            next.delete(id);
          }
        });
        return next;
      });
    },
    [],
  );

  const markCpaTablesSyncing = useCallback(
    (
      cpaInstanceIds: number[],
      syncing: boolean,
      phase: CpaBusyPhase = "updating",
    ) => {
      if (cpaInstanceIds.length === 0) {
        return;
      }

      setSyncingCpaIds((current) => {
        const next = new Set(current);
        cpaInstanceIds.forEach((id) => {
          if (syncing) {
            next.add(id);
          } else {
            next.delete(id);
          }
        });
        return next;
      });
      setSyncingCpaPhases((current) => {
        const next = new Map(current);
        cpaInstanceIds.forEach((id) => {
          if (syncing) {
            next.set(id, phase);
          } else {
            next.delete(id);
          }
        });
        return next;
      });
    },
    [],
  );

  const markJobRunning = useCallback((key: string, running: boolean) => {
    setRunningJobKeys((current) => {
      const next = new Set(current);
      if (running) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const applyJobsResponse = useCallback((jobRes: JobsApiResponse) => {
    const cpaSyncs = jobRes.cpaSyncs ?? [];
    const backgroundSyncingIds = cpaSyncs
      .filter((sync) => sync.phase !== "auth_files")
      .map((sync) => sync.cpaInstanceId);

    setJobs(jobRes.jobs);
    setRuns(jobRes.runs);
    setRemoteUpdatingCpaIds(
      new Set(
        cpaSyncs
          .filter((sync) => sync.phase === "auth_files")
          .map((sync) => sync.cpaInstanceId),
      ),
    );
    setRemoteSyncingCpaIds(
      new Set(cpaSyncs.map((sync) => sync.cpaInstanceId)),
    );
    setRemoteSyncingCpaPhases(
      new Map(cpaSyncs.map((sync) => [sync.cpaInstanceId, sync.phase])),
    );
    if (backgroundSyncingIds.length > 0) {
      setUpdatingCpaIds((current) => {
        const next = new Set(current);
        backgroundSyncingIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    const nextRunsPagination =
      jobRes.runsPagination ?? defaultJobRunsPagination;
    runsPaginationRef.current = nextRunsPagination;
    setRunsPagination(nextRunsPagination);
  }, []);

  const fetchJobs = useCallback(
    async (options: { runsPage?: number; runsPageSize?: number } = {}) => {
      const requestedRunsPage =
        options.runsPage ?? runsPaginationRef.current.page;
      const requestedRunsPageSize =
        options.runsPageSize ?? runsPaginationRef.current.pageSize;
      const jobsSearchParams = new URLSearchParams({
        runsPage: String(requestedRunsPage),
        runsPageSize: String(requestedRunsPageSize),
      });
      const jobRes = await fetchJson<JobsApiResponse>(
        `/api/jobs?${jobsSearchParams.toString()}`,
      );
      applyJobsResponse(jobRes);
      return jobRes;
    },
    [applyJobsResponse],
  );

  const loadAll = useCallback(
    async (
      options: {
        runsPage?: number;
        runsPageSize?: number;
        section?: SectionId;
      } = {},
    ) => {
      try {
        const targetSection = options.section ?? activeSection;
        const needsAuthFiles = targetSection === "auth";
        const needsCandidatePool = targetSection === "candidate-pool";
        const needsExceptions = targetSection === "exceptions";
        const needsProxies =
          targetSection === "auth" || targetSection === "proxies";
        const requestedRunsPage =
          options.runsPage ?? runsPaginationRef.current.page;
        const requestedRunsPageSize =
          options.runsPageSize ?? runsPaginationRef.current.pageSize;
        const jobsSearchParams = new URLSearchParams({
          runsPage: String(requestedRunsPage),
          runsPageSize: String(requestedRunsPageSize),
        });
        const [
          instanceRes,
          authRes,
          candidateRes,
          exceptionRes,
          quotaRes,
          proxyRes,
          subscriptionQuotaRes,
          jobRes,
        ] = await Promise.all([
          fetchJson<{ instances: CpaInstance[] }>("/api/cpa-instances"),
          needsAuthFiles
            ? fetchJson<{
                groups: Array<{
                  instance: CpaInstance;
                  authFiles: AuthFile[];
                }>;
              }>("/api/auth-files")
            : Promise.resolve(null),
          needsCandidatePool
            ? fetchJson<{ authFiles: CandidateAuthFile[] }>(
                "/api/candidate-auth-files",
              )
            : Promise.resolve(null),
          needsExceptions
            ? fetchJson<{ exceptionAuthFiles: ExceptionAuthFile[] }>(
                "/api/exception-auth-files",
              )
            : Promise.resolve(null),
          needsAuthFiles
            ? fetchJson<{
                groups: Array<{
                  instance: CpaInstance;
                  quotas: QuotaSnapshot[];
                }>;
              }>("/api/quotas")
            : Promise.resolve(null),
          needsProxies
            ? fetchJson<{ proxies: ProxyRow[]; instances: CpaInstance[] }>(
                "/api/proxies",
              )
            : Promise.resolve(null),
          needsAuthFiles
            ? fetchJson<{ quotas: SubscriptionQuotaSetting[] }>(
                "/api/subscription-quotas",
              )
            : Promise.resolve(null),
          fetchJson<JobsApiResponse>(
            `/api/jobs?${jobsSearchParams.toString()}`,
          ),
        ]);
        setInstances(instanceRes.instances);
        if (authRes) {
          setAuthGroups(authRes.groups);
        }
        if (candidateRes) {
          setCandidateAuthFiles(candidateRes.authFiles);
        }
        if (exceptionRes) {
          setExceptionAuthFiles(exceptionRes.exceptionAuthFiles);
        }
        if (quotaRes) {
          setQuotaGroups(quotaRes.groups);
        }
        if (proxyRes) {
          setProxies(proxyRes.proxies);
        }
        if (subscriptionQuotaRes) {
          setSubscriptionQuotas(subscriptionQuotaRes.quotas);
        }
        applyJobsResponse(jobRes);
        setDataRefreshVersion((version) => version + 1);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [activeSection, applyJobsResponse],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadAll]);

  useEffect(() => {
    let stopped = false;
    const pollJobs = async () => {
      try {
        const jobRes = await fetchJobs();
        if (stopped) {
          return;
        }

        const syncRunning = Boolean(
          jobRes.jobs.find((job) => job.key === syncJobKey)?.running,
        );
        const wasSyncRunning = remoteSyncRunningRef.current;
        const cpaSyncingIds = new Set(
          (jobRes.cpaSyncs ?? []).map((sync) => sync.cpaInstanceId),
        );
        const cpaAccountUpdatingIds = new Set(
          (jobRes.cpaSyncs ?? [])
            .filter((sync) => sync.phase === "auth_files")
            .map((sync) => sync.cpaInstanceId),
        );
        const hadCpaSyncing = remoteCpaSyncingIdsRef.current.size > 0;
        const finishedAccountUpdating = [...remoteCpaAccountUpdatingIdsRef.current]
          .some((id) => !cpaAccountUpdatingIds.has(id));
        remoteSyncRunningRef.current = syncRunning;
        remoteCpaSyncingIdsRef.current = cpaSyncingIds;
        remoteCpaAccountUpdatingIdsRef.current = cpaAccountUpdatingIds;
        if (
          (wasSyncRunning && !syncRunning) ||
          (hadCpaSyncing && cpaSyncingIds.size === 0) ||
          finishedAccountUpdating
        ) {
          await loadAll({ runsPage: 1 });
        }
      } catch {
        // Keep the global polling quiet; visible actions still surface errors directly.
      }
    };

    const timer = window.setInterval(() => {
      void pollJobs();
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [fetchJobs, loadAll]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const syncJob = useMemo(
    () => jobs.find((job) => job.key === syncJobKey) ?? null,
    [jobs],
  );
  const syncCountdownSeconds = useMemo(
    () => secondsUntilJobRun(syncJob, nowMs),
    [syncJob, nowMs],
  );
  const isSyncJobRunning =
    runningJobKeys.has(syncJobKey) || Boolean(syncJob?.running);
  const effectiveUpdatingCpaIds = useMemo(
    () => new Set([...updatingCpaIds, ...remoteUpdatingCpaIds]),
    [remoteUpdatingCpaIds, updatingCpaIds],
  );
  const effectiveSyncingCpaIds = useMemo(
    () =>
      new Set([
        ...syncingCpaIds,
        ...remoteSyncingCpaIds,
        ...effectiveUpdatingCpaIds,
      ]),
    [effectiveUpdatingCpaIds, remoteSyncingCpaIds, syncingCpaIds],
  );
  const effectiveSyncingCpaPhases = useMemo(() => {
    const next = new Map<number, CpaBusyPhase>();
    effectiveUpdatingCpaIds.forEach((id) => next.set(id, "updating"));
    syncingCpaPhases.forEach((phase, id) => next.set(id, phase));
    remoteSyncingCpaPhases.forEach((phase, id) => next.set(id, phase));
    return next;
  }, [effectiveUpdatingCpaIds, remoteSyncingCpaPhases, syncingCpaPhases]);
  const syncButtonLabel = formatSyncButtonLabel(
    syncJob,
    syncCountdownSeconds,
    isSyncJobRunning,
  );
  const syncButtonTitle = formatSyncButtonTitle(
    syncJob,
    syncCountdownSeconds,
    isSyncJobRunning,
  );

  const waitForScheduledSyncCompletion = useCallback(
    async (scheduledRunAt: string) => {
      const deadline = Date.now() + scheduledSyncTimeoutMs;

      while (Date.now() < deadline) {
        await sleep(scheduledSyncPollIntervalMs);
        const jobRes = await fetchJobs({ runsPage: 1 });
        const latestSyncJob = jobRes.jobs.find((job) => job.key === syncJobKey);
        if (
          latestSyncJob &&
          jobFinishedAtOrAfter(latestSyncJob, scheduledRunAt)
        ) {
          return true;
        }
      }

      return false;
    },
    [fetchJobs],
  );

  const handleScheduledSyncStart = useCallback(
    async (scheduledRunAt: string) => {
      if (scheduledSyncRunRef.current === scheduledRunAt) {
        return;
      }

      scheduledSyncRunRef.current = scheduledRunAt;
      const updatingIds = cpaTableUpdatingIdsForJob(syncJobKey, instances);
      markJobRunning(syncJobKey, true);
      markCpaTablesUpdating(updatingIds, true);
      markCpaTablesSyncing(updatingIds, true, "auth_files");

      try {
        await waitForScheduledSyncCompletion(scheduledRunAt);
        await loadAll({ runsPage: 1 });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        markCpaTablesUpdating(updatingIds, false);
        markCpaTablesSyncing(updatingIds, false);
        markJobRunning(syncJobKey, false);
        scheduledSyncRunRef.current = null;
      }
    },
    [
      instances,
      loadAll,
      markCpaTablesUpdating,
      markCpaTablesSyncing,
      markJobRunning,
      waitForScheduledSyncCompletion,
    ],
  );

  useEffect(() => {
    if (!syncJob?.enabled || !syncJob.nextRunAt) {
      return;
    }

    const nextRunAt = syncJob.nextRunAt;
    const nextRunAtMs = new Date(nextRunAt).getTime();
    if (!Number.isFinite(nextRunAtMs)) {
      return;
    }

    const delay = Math.max(0, nextRunAtMs - Date.now());
    const timer = window.setTimeout(() => {
      void handleScheduledSyncStart(nextRunAt);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [handleScheduledSyncStart, syncJob?.enabled, syncJob?.nextRunAt]);

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
    options: {
      phase?: CpaBusyPhase;
      showUpdatingOverlay?: boolean;
    } = {},
  ) {
    const phase = options.phase ?? "updating";
    const showUpdatingOverlay = options.showUpdatingOverlay ?? true;
    const ids = [
      ...new Set(
        cpaInstanceIds.filter(
          (id): id is number => typeof id === "number" && id > 0,
        ),
      ),
    ];
    if (ids.length > 0) {
      setSyncingCpaIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.add(id));
        return next;
      });
      setSyncingCpaPhases((current) => {
        const next = new Map(current);
        ids.forEach((id) => next.set(id, phase));
        return next;
      });
    }
    if (ids.length > 0 && showUpdatingOverlay) {
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
        setSyncingCpaIds((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        setSyncingCpaPhases((current) => {
          const next = new Map(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
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
    const url = editingInstanceId
      ? `/api/cpa-instances/${editingInstanceId}`
      : "/api/cpa-instances";
    await mutate(url, {
      method: editingInstanceId ? "PUT" : "POST",
      body: JSON.stringify(instanceForm),
    });
    setInstanceForm(emptyInstance);
    setEditingInstanceId(null);
    setInstanceDialogOpen(false);
    toast.success("CPA实例已保存");
    await loadAll();
  }

  async function submitProxy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = editingProxyId
      ? `/api/proxies/${editingProxyId}`
      : "/api/proxies";
    await mutate(url, {
      method: editingProxyId ? "PUT" : "POST",
      body: JSON.stringify(proxyForm),
    });
    setProxyForm(emptyProxy);
    setEditingProxyId(null);
    setProxyDialogOpen(false);
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
    toast.success(enabled ? "代理已启用" : "代理已停用");
    await loadAll();
  }

  async function checkAllProxies() {
    setCheckingProxies(true);
    try {
      const result = await mutate<{ results: ProxyCheckResult[] }>(
        "/api/proxies/check",
        {
          method: "POST",
        },
      );
      setProxyChecks(
        Object.fromEntries(result.results.map((item) => [item.proxyId, item])),
      );
      const availableCount = result.results.filter((item) => item.ok).length;
      toast.success(
        `代理检测完成：${availableCount}/${result.results.length} 可用`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingProxies(false);
    }
  }

  async function runJob(key: string) {
    const updatingIds = cpaTableUpdatingIdsForJob(key, instances);
    setRunningJobKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    try {
      await withUpdatingCpaTables(
        updatingIds,
        async () => {
          const result = await mutate<{ status: string; message: string }>(
            `/api/jobs/${encodeURIComponent(key)}/run`,
            {
              method: "POST",
            },
          );
          toast.success(result.message);
          await loadAll({ runsPage: 1 });
        },
        { phase: key === syncJobKey ? "auth_files" : "updating" },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(errorMessage);
      await fetchJobs({ runsPage: 1 });
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
      toast.success(enabled ? "CPA实例已启用" : "CPA实例已停用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      await loadAll();
    }
  }

  async function deleteAuthFile(id: number) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables([sourceCpaInstanceId], async () => {
        await mutate(`/api/auth-files/${id}`, { method: "DELETE" });
        toast.success("账号已删除");
        await loadAll();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function moveAuthFile(id: number, targetCpaInstanceId: number) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables(
        [sourceCpaInstanceId, targetCpaInstanceId],
        async () => {
          await mutate(`/api/auth-files/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ targetCpaInstanceId }),
          });
          toast.success("账号已移动");
          await loadAll();
        },
      );
    } catch (error) {
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
        toast.success(disabled ? "账号已停用" : "账号已启用，等待配额刷新");
        await loadAll();
      });
    } catch (error) {
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
        toast.success(proxyUrl ? "账号代理已更新" : "账号代理已清除");
        await loadAll();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function tagAuthFiles(
    cpaInstanceId: number,
    authFileIds: number[],
    tag: string,
  ) {
    if (authFileIds.length === 0) {
      throw new Error("请先选择账号");
    }

    const result = await mutate<{ processed: number; action: "tag" }>(
      `/api/cpa-instances/${cpaInstanceId}/auth-files/batch`,
      {
        method: "POST",
        body: JSON.stringify({ action: "tag", authFileIds, tag }),
      },
    );
    toast.success(`已给 ${result.processed} 个账号打 Tag`);
    await loadAll();
  }

  async function refreshAuthFileQuota(id: number) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables(
        [sourceCpaInstanceId],
        async () => {
          const result = await mutate<{
            status: string;
            message: string;
            instance: string;
          }>(`/api/auth-files/${id}`, {
            method: "POST",
            body: JSON.stringify({ action: "refreshQuota" }),
          });
          if (result.status === "success") {
            toast.success(`${result.instance}：${result.message}`);
          } else {
            toast.error(`${result.instance}：${result.message}`);
          }
          await loadAll();
        },
        { phase: "quotas", showUpdatingOverlay: false },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function rtLoginCpaAccount(
    cpaInstanceId: number,
    mode: RtLoginMode,
    line: string,
    options: RtLoginAccountOptions = {},
  ) {
    return await mutate<RtLoginAuthResult>(
      `/api/cpa-instances/${cpaInstanceId}/rt-login`,
      {
        method: "POST",
        body: JSON.stringify({
          action: "login",
          mode,
          line,
          proxyId: options.proxyId ?? null,
        }),
      },
    );
  }

  async function uploadRtLoginCpaAccounts(
    cpaInstanceId: number,
    mode: RtLoginMode,
    entries: RtLoginAuthResult[],
  ) {
    let result: RtLoginUploadResult | null = null;
    await withUpdatingCpaTables([cpaInstanceId], async () => {
      result = await mutate<RtLoginUploadResult>(
        `/api/cpa-instances/${cpaInstanceId}/rt-login`,
        {
          method: "POST",
          body: JSON.stringify({ action: "upload", mode, entries }),
        },
      );
      await loadAll();
    });
    return result;
  }

  async function uploadCpaJsonFiles(
    cpaInstanceId: number,
    files: CpaJsonUploadFile[],
    source?: CpaJsonUploadSource,
  ) {
    let result: CpaJsonUploadResult | null = null;
    await withUpdatingCpaTables([cpaInstanceId], async () => {
      result = await mutate<CpaJsonUploadResult>(
        `/api/cpa-instances/${cpaInstanceId}/auth-json`,
        {
          method: "POST",
          body: JSON.stringify({ files, source }),
        },
      );
      await loadAll();
    });
    return result;
  }

  async function uploadCandidateJsonFiles(files: CpaJsonUploadFile[]) {
    const result = await mutate<CpaJsonUploadResult>(
      "/api/candidate-auth-files",
      {
        method: "POST",
        body: JSON.stringify({ files }),
      },
    );
    await loadAll();
    return result;
  }

  async function refreshCandidatePoolQuotas(refreshToken: boolean) {
    setRefreshingCandidatePool(refreshToken ? "withRt" : "withoutRt");
    try {
      const result = await mutate<{ refreshed: number; failed: number }>(
        "/api/candidate-auth-files/refresh-quotas",
        {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        },
      );
      if (result.failed > 0) {
        toast.warning(
          `候补号池配额已刷新：${result.refreshed} 个成功，${result.failed} 个异常`,
        );
      } else {
        toast.success(`候补号池配额已刷新 ${result.refreshed} 个`);
      }
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingCandidatePool(null);
    }
  }

  async function exportCandidateJsonFiles(
    authFileIds: number[],
    deleteAfterExport: boolean,
  ) {
    if (authFileIds.length === 0) {
      throw new Error("请先选择候补账号");
    }

    const response = await fetch("/api/candidate-auth-files/batch", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: deleteAfterExport ? "exportAndDelete" : "export",
        authFileIds,
      }),
    });
    if (!response.ok) {
      throw new Error(await readFetchError(response));
    }

    const blob = await response.blob();
    downloadBlob(
      blob,
      fileNameFromContentDisposition(response.headers.get("content-disposition")) ??
        `candidate-auths-${formatDownloadTimestamp(new Date())}.zip`,
    );
    if (deleteAfterExport) {
      await loadAll();
    }
  }

  async function moveCandidateJsonFiles(
    authFileIds: number[],
    targetCpaInstanceId: number,
  ) {
    if (authFileIds.length === 0) {
      throw new Error("请先选择候补账号");
    }

    const result = await mutate<{ processed: number; action: "move" }>(
      "/api/candidate-auth-files/batch",
      {
        method: "POST",
        body: JSON.stringify({
          action: "move",
          authFileIds,
          targetCpaInstanceId,
        }),
      },
    );
    toast.success(`已移动 ${result.processed} 个候补账号`);
    await loadAll();
  }

  async function refreshCandidateJsonFileTokens(authFileIds: number[]) {
    if (authFileIds.length === 0) {
      throw new Error("请先选择候补账号");
    }

    const result = await mutate<{
      processed: number;
      failed: number;
      rotated: number;
      action: "refreshToken";
    }>("/api/candidate-auth-files/batch", {
      method: "POST",
      body: JSON.stringify({
        action: "refreshToken",
        authFileIds,
      }),
    });
    await loadAll();
    return result;
  }

  async function refreshCandidateSelectedQuotas(
    authFileIds: number[],
    refreshToken: boolean,
  ) {
    if (authFileIds.length === 0) {
      throw new Error("请先选择候补账号");
    }

    const result = await mutate<{
      processed: number;
      failed: number;
      action: "refreshQuota";
    }>("/api/candidate-auth-files/batch", {
      method: "POST",
      body: JSON.stringify({
        action: "refreshQuota",
        authFileIds,
        refreshToken,
      }),
    });
    await loadAll();
    return result;
  }

  async function portalExceptionAuthFile(id: number) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables([sourceCpaInstanceId], async () => {
        await mutate(`/api/auth-files/${id}`, {
          method: "POST",
          body: JSON.stringify({ action: "portalException" }),
        });
        toast.success("账号已清理到异常账号");
        await loadAll();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function portalCandidateAuthFile(id: number) {
    const sourceCpaInstanceId = findAuthFileCpaInstanceId(id);
    try {
      await withUpdatingCpaTables([sourceCpaInstanceId], async () => {
        await mutate(`/api/auth-files/${id}`, {
          method: "POST",
          body: JSON.stringify({ action: "portalCandidate" }),
        });
        toast.success("账号已移动到候补号池");
        await loadAll();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteExceptionAuthFile(id: number) {
    try {
      await mutate(`/api/exception-auth-files/${id}`, { method: "DELETE" });
      toast.success("异常账号已删除");
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function clearExceptionAuthFiles() {
    try {
      const result = await mutate<{ deleted: number }>(
        "/api/exception-auth-files",
        { method: "DELETE" },
      );
      toast.success(`已清空 ${result.deleted} 个异常账号`);
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function moveExceptionAuthFile(
    id: number,
    targetCpaInstanceId: number,
  ) {
    try {
      await withUpdatingCpaTables([targetCpaInstanceId], async () => {
        await mutate(`/api/exception-auth-files/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ targetCpaInstanceId }),
        });
        toast.success("异常账号已移动");
        await loadAll();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  function exportExceptionAuthFileEmails() {
    const csv = exceptionAuthFiles
      .map((row) => row.email?.trim() ?? "")
      .filter((email) => email.length > 0)
      .map(csvCell)
      .join("\n");
    downloadBlob(
      new Blob([csv ? `${csv}\n` : ""], { type: "text/csv;charset=utf-8" }),
      `exception-auth-emails-${formatDownloadTimestamp(new Date())}.csv`,
    );
  }

  async function batchHandleExceptionAuthFiles(
    cpaInstanceId: number,
    action: BatchExceptionAction,
    authFileIds: number[],
    successVerb: string,
    subject: string,
    target: BatchAuthFileTarget = "selected",
  ) {
    if (authFileIds.length === 0) {
      toast.info(`没有${subject}可处理`);
      return;
    }

    try {
      await withUpdatingCpaTables([cpaInstanceId], async () => {
        const result = await mutate<{
          processed: number;
          action: BatchExceptionAction;
        }>(`/api/cpa-instances/${cpaInstanceId}/auth-files/batch`, {
          method: "POST",
          body: JSON.stringify(
            target === "free" ? { action, target } : { action, authFileIds },
          ),
        });
        toast.success(`${successVerb} ${result.processed} 个${subject}`);
        await loadAll();
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function downloadAuthFiles(
    cpaInstanceId: number,
    authFileIds: number[],
  ) {
    if (authFileIds.length === 0) {
      throw new Error("请先选择账号");
    }

    await withUpdatingCpaTables([cpaInstanceId], async () => {
      const response = await fetch(
        `/api/cpa-instances/${cpaInstanceId}/auth-files/batch`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ action: "download", authFileIds }),
        },
      );
      if (!response.ok) {
        throw new Error(await readFetchError(response));
      }

      const blob = await response.blob();
      downloadBlob(
        blob,
        fileNameFromContentDisposition(
          response.headers.get("content-disposition"),
        ) ?? `auths-${formatDownloadTimestamp(new Date())}.zip`,
      );
      toast.success(`已取号 ${authFileIds.length} 个`);
      await loadAll();
    });
  }

  async function moveAuthFiles(
    cpaInstanceId: number,
    authFileIds: number[],
    targetCpaInstanceId: number,
  ) {
    if (authFileIds.length === 0) {
      throw new Error("请先选择账号");
    }

    await withUpdatingCpaTables(
      [cpaInstanceId, targetCpaInstanceId],
      async () => {
        const result = await mutate<{ processed: number; action: "move" }>(
          `/api/cpa-instances/${cpaInstanceId}/auth-files/batch`,
          {
            method: "POST",
            body: JSON.stringify({
              action: "move",
              authFileIds,
              targetCpaInstanceId,
            }),
          },
        );
        toast.success(`已移动 ${result.processed} 个账号`);
        await loadAll();
      },
    );
  }

  async function autoAssignCpaProxies(cpaInstanceId: number) {
    try {
      await withUpdatingCpaTables([cpaInstanceId], async () => {
        const result = await mutate<{
          processed: number;
          skipped?: number;
          action: "autoAssignProxy";
        }>(`/api/cpa-instances/${cpaInstanceId}/auth-files/batch`, {
          method: "POST",
          body: JSON.stringify({ action: "autoAssignProxy" }),
        });
        if (result.processed > 0 && result.skipped) {
          toast.success(
            `已自动分配代理 ${result.processed} 个，${result.skipped} 个因容量不足跳过`,
          );
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
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshCpaInstance(cpaInstanceId: number) {
    try {
      await withUpdatingCpaTables(
        [cpaInstanceId],
        async () => {
          const result = await mutate<{
            status: string;
            message: string;
            instance: string;
          }>(`/api/cpa-instances/${cpaInstanceId}/sync`, { method: "POST" });
          toast.success(`${result.instance}：${result.message}`);
          await loadAll();
        },
        { phase: "auth_files" },
      );
    } catch (error) {
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
      await loadAll();
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-[color-mix(in_oklch,var(--background),var(--muted)_35%)] text-foreground">
      {sidebar.mode === "auto" ? (
        <>
          <div
            aria-hidden
            className="fixed left-0 top-0 z-30 hidden h-screen w-2 lg:block"
            onMouseEnter={() => sidebar.setAutoOpen(true)}
          />
          <aside
            onMouseEnter={() => sidebar.setAutoOpen(true)}
            onMouseLeave={() => {
              if (!sidebar.resizing) {
                sidebar.setAutoOpen(false);
              }
            }}
            style={{ "--sidebar-w": `${sidebar.width}px` } as CSSProperties}
            className={cn(
              "fixed left-0 top-0 z-40 hidden h-screen w-[var(--sidebar-w)] overflow-y-auto border-r bg-sidebar shadow-xl transition-transform duration-200 lg:block",
              sidebar.autoOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            {renderSidebarInner(false)}
            {renderSidebarResizeHandle()}
          </aside>
        </>
      ) : null}

      <div
        className={cn(
          "grid min-h-screen grid-cols-1",
          sidebar.mode !== "auto" &&
            "lg:[grid-template-columns:var(--sidebar-cols)]",
        )}
        style={
          {
            "--sidebar-w": `${sidebar.width}px`,
            "--sidebar-cols": sidebarColumns,
          } as CSSProperties
        }
      >
        <aside
          className={cn(
            "relative border-b bg-sidebar/90",
            sidebar.mode === "auto"
              ? "lg:hidden"
              : "lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r",
          )}
        >
          {renderSidebarInner(sidebarCollapsed)}
          {sidebar.mode === "expanded" ? renderSidebarResizeHandle() : null}
        </aside>

        <main className="min-w-0">
          <header className="flex min-h-14 flex-col justify-center gap-2 border-b bg-background/80 px-3 py-2.5 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold">{activeLabel}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle />
              <Button
                size="sm"
                title={syncButtonTitle}
                onClick={() => void runJob(syncJobKey)}
              >
                <RefreshCw className="h-4 w-4" />
                {syncButtonLabel}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void logout()}>
                <LogOut className="h-4 w-4" />
                退出登录
              </Button>
            </div>
          </header>

          <div className="space-y-3 p-3">
            {activeSection === "dashboard" ? (
              <DataBoardSection refreshVersion={dataRefreshVersion} />
            ) : null}

            {activeSection === "instances" ? (
              <InstancesSection
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
                  await mutate(`/api/cpa-instances/${id}`, {
                    method: "DELETE",
                  });
                  await loadAll();
                }}
              />
            ) : null}

            {activeSection === "auth" ? (
              <AuthFilesSection
                groups={authGroups}
                quotaGroups={quotaGroups}
                subscriptionQuotas={subscriptionQuotas}
                proxies={proxies}
                updatingCpaIds={effectiveUpdatingCpaIds}
                syncingCpaIds={effectiveSyncingCpaIds}
                syncingCpaPhases={effectiveSyncingCpaPhases}
                nowMs={nowMs}
                onDeleteAuthFile={deleteAuthFile}
                onPortalExceptionAuthFile={portalExceptionAuthFile}
                onPortalCandidateAuthFile={portalCandidateAuthFile}
                onMoveAuthFile={moveAuthFile}
                onToggleAuthFileDisabled={toggleAuthFileDisabled}
                onConfigureAuthFileProxy={configureAuthFileProxy}
                onTagAuthFiles={tagAuthFiles}
                onRefreshAuthFileQuota={refreshAuthFileQuota}
                onRtLoginAccount={rtLoginCpaAccount}
                onUploadRtLoginAccounts={uploadRtLoginCpaAccounts}
                onUploadCpaJsonFiles={uploadCpaJsonFiles}
                onBatchHandleExceptionAuthFiles={batchHandleExceptionAuthFiles}
                onDownloadAuthFiles={downloadAuthFiles}
                onMoveAuthFiles={moveAuthFiles}
                onAutoAssignCpaProxies={autoAssignCpaProxies}
                onRefreshCpa={refreshCpaInstance}
                onStartCodexOAuth={startCodexOAuthLogin}
                onSubmitCodexOAuthCallback={submitCodexOAuthCallback}
              />
            ) : null}

            {activeSection === "candidate-pool" ? (
              <CandidatePoolSection
                rows={candidateAuthFiles}
                instances={instances.filter((instance) => instance.enabled)}
                nowMs={nowMs}
                refreshing={refreshingCandidatePool !== null}
                refreshingMode={refreshingCandidatePool}
                onUploadJsonFiles={uploadCandidateJsonFiles}
                onRefreshQuotas={refreshCandidatePoolQuotas}
                onExportJsonFiles={exportCandidateJsonFiles}
                onMoveToCpa={moveCandidateJsonFiles}
                onRefreshTokens={refreshCandidateJsonFileTokens}
                onRefreshSelectedQuotas={refreshCandidateSelectedQuotas}
              />
            ) : null}

            {activeSection === "exceptions" ? (
              <ExceptionAuthFilesSection
                rows={exceptionAuthFiles}
                instances={instances.filter((instance) => instance.enabled)}
                onExport={exportExceptionAuthFileEmails}
                onClear={clearExceptionAuthFiles}
                onDelete={deleteExceptionAuthFile}
                onMove={moveExceptionAuthFile}
              />
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
                  toast.success("代理已删除");
                  await loadAll();
                }}
              />
            ) : null}

            {activeSection === "message-push" ? <MessagePushSection /> : null}

            {activeSection === "quota-settings" ? <QuotaSettingsSection /> : null}

            {activeSection === "jobs" ? (
              <JobsSection
                jobs={jobs}
                runs={runs}
                runsPagination={runsPagination}
                onRunsPageChange={(page) => loadAll({ runsPage: page })}
                onRun={runJob}
                onSave={async (job) => {
                  await mutate(`/api/jobs/${encodeURIComponent(job.key)}`, {
                    method: "PUT",
                    body: JSON.stringify({
                      cron: job.cron,
                      enabled: job.enabled,
                    }),
                  });
                  toast.success("定时任务已保存");
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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function InstancesSection(props: {
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
  const formId = "cpa-instance-form";
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2.5 rounded-md border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">CPA 实例</div>
          <div className="text-sm text-muted-foreground">
            集中管理 CPA 地址、管理密码和配额刷新配置。
          </div>
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
            <DialogTitle>
              {props.editingId ? "编辑CPA实例" : "添加CPA实例"}
            </DialogTitle>
            <DialogDescription>
              配置 CPA 管理地址、密码和配额刷新方式，保存后会出现在 CPA
              管理列表中。
            </DialogDescription>
          </DialogHeader>

          <form id={formId} onSubmit={props.onSubmit} className="grid gap-4">
            <Field label="名称">
              <Input
                value={props.form.name}
                onChange={(event) =>
                  props.setForm({ ...props.form, name: event.target.value })
                }
                required
              />
            </Field>
            <Field label="CPA地址">
              <Input
                value={props.form.baseUrl}
                onChange={(event) =>
                  props.setForm({ ...props.form, baseUrl: event.target.value })
                }
                placeholder="http://127.0.0.1:8317"
                required
              />
            </Field>
            <Field label="CPA密码">
              <Input
                type="password"
                value={props.form.password}
                onChange={(event) =>
                  props.setForm({ ...props.form, password: event.target.value })
                }
                required
              />
            </Field>
            <Field label="配额刷新路径">
              <Input
                value={props.form.quotaRefreshPath}
                onChange={(event) =>
                  props.setForm({
                    ...props.form,
                    quotaRefreshPath: event.target.value,
                  })
                }
                required
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={props.form.enabled}
                onCheckedChange={(enabled) =>
                  props.setForm({ ...props.form, enabled })
                }
              />
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
          <div key="name" className="font-medium">
            {instance.name}
          </div>,
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
            onCheckedChange={(enabled) =>
              void props.onToggleEnabled(instance.id, enabled)
            }
          />,
          <StatusBadge
            key="status"
            ok={instance.enabled && instance.lastSyncStatus !== "error"}
            label={
              instance.enabled ? (instance.lastSyncStatus ?? "启用") : "停用"
            }
          />,
          <span key="sync">{formatDate(instance.lastSyncedAt)}</span>,
          <span key="error" className="max-w-[280px] truncate text-rose-700">
            {instance.lastSyncError ?? "-"}
          </span>,
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
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void props.onDelete(instance.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>,
        ])}
      />
    </section>
  );
}

type RtLoginRowStatus = "waiting" | "logging-in" | "success" | "failed";

type RtLoginUiRow = {
  id: string;
  lineNumber: number;
  sourceLine: string;
  email: string | null;
  refreshToken: string;
  proxyId: number | null;
  proxyName: string | null;
  status: RtLoginRowStatus;
  error: string | null;
  result: RtLoginAuthResult | null;
};

type RtLoginDialogState = {
  instance: CpaInstance;
  mode: RtLoginMode;
  proxyMode: RtLoginProxyMode;
  text: string;
  stage: "input" | "processing" | "review" | "uploading";
  error: string | null;
  rows: RtLoginUiRow[];
};

type SessionJsonDialogState = {
  instance: CpaInstance;
  text: string;
  stage: "input" | "uploading";
  error: string | null;
};

function AuthFilesSection({
  groups,
  quotaGroups,
  subscriptionQuotas,
  proxies,
  updatingCpaIds,
  syncingCpaIds,
  syncingCpaPhases,
  nowMs,
  onDeleteAuthFile,
  onPortalExceptionAuthFile,
  onPortalCandidateAuthFile,
  onMoveAuthFile,
  onToggleAuthFileDisabled,
  onConfigureAuthFileProxy,
  onTagAuthFiles,
  onRefreshAuthFileQuota,
  onRtLoginAccount,
  onUploadRtLoginAccounts,
  onUploadCpaJsonFiles,
  onBatchHandleExceptionAuthFiles,
  onDownloadAuthFiles,
  onMoveAuthFiles,
  onAutoAssignCpaProxies,
  onRefreshCpa,
  onStartCodexOAuth,
  onSubmitCodexOAuthCallback,
}: {
  groups: Array<{ instance: CpaInstance; authFiles: AuthFile[] }>;
  quotaGroups: Array<{ instance: CpaInstance; quotas: QuotaSnapshot[] }>;
  subscriptionQuotas: SubscriptionQuotaSetting[];
  proxies: ProxyRow[];
  updatingCpaIds: Set<number>;
  syncingCpaIds: Set<number>;
  syncingCpaPhases: Map<number, CpaBusyPhase>;
  nowMs: number;
  onDeleteAuthFile: (id: number) => Promise<void>;
  onPortalExceptionAuthFile: (id: number) => Promise<void>;
  onPortalCandidateAuthFile: (id: number) => Promise<void>;
  onMoveAuthFile: (id: number, targetCpaInstanceId: number) => Promise<void>;
  onToggleAuthFileDisabled: (id: number, disabled: boolean) => Promise<void>;
  onConfigureAuthFileProxy: (
    id: number,
    proxyUrl: string | null,
  ) => Promise<void>;
  onTagAuthFiles: (
    cpaInstanceId: number,
    authFileIds: number[],
    tag: string,
  ) => Promise<void>;
  onRefreshAuthFileQuota: (id: number) => Promise<void>;
  onRtLoginAccount: (
    cpaInstanceId: number,
    mode: RtLoginMode,
    line: string,
    options?: RtLoginAccountOptions,
  ) => Promise<RtLoginAuthResult>;
  onUploadRtLoginAccounts: (
    cpaInstanceId: number,
    mode: RtLoginMode,
    entries: RtLoginAuthResult[],
  ) => Promise<RtLoginUploadResult | null>;
  onUploadCpaJsonFiles: (
    cpaInstanceId: number,
    files: CpaJsonUploadFile[],
    source?: CpaJsonUploadSource,
  ) => Promise<CpaJsonUploadResult | null>;
  onBatchHandleExceptionAuthFiles: (
    cpaInstanceId: number,
    action: BatchExceptionAction,
    authFileIds: number[],
    successVerb: string,
    subject: string,
    target?: BatchAuthFileTarget,
  ) => Promise<void>;
  onDownloadAuthFiles: (
    cpaInstanceId: number,
    authFileIds: number[],
  ) => Promise<void>;
  onMoveAuthFiles: (
    cpaInstanceId: number,
    authFileIds: number[],
    targetCpaInstanceId: number,
  ) => Promise<void>;
  onAutoAssignCpaProxies: (cpaInstanceId: number) => Promise<void>;
  onRefreshCpa: (cpaInstanceId: number) => Promise<void>;
  onStartCodexOAuth: (cpaInstanceId: number) => Promise<CodexOAuthStartResult>;
  onSubmitCodexOAuthCallback: (
    cpaInstanceId: number,
    redirectUrl: string,
  ) => Promise<void>;
}) {
  const enabledGroups = onlyEnabledCpaGroups(groups);
  const enabledInstances = enabledGroups.map((group) => group.instance);
  const proxyNameByUrl = useMemo(
    () => new Map(proxies.map((proxy) => [proxy.url, proxy.name])),
    [proxies],
  );
  const enabledLoginProxies = useMemo(
    () => proxies.filter((proxy) => proxy.enabled),
    [proxies],
  );
  const subscriptionWeights5h = useMemo<SubscriptionWeightMap>(
    () => buildSubscriptionWeightMap(subscriptionQuotas, "usage5hPercent"),
    [subscriptionQuotas],
  );
  const subscriptionWeightsWeek = useMemo<SubscriptionWeightMap>(
    () => buildSubscriptionWeightMap(subscriptionQuotas, "usageWeekPercent"),
    [subscriptionQuotas],
  );
  const [deleteTarget, setDeleteTarget] = useState<AuthFileQuotaRow | null>(
    null,
  );
  const [moveTarget, setMoveTarget] = useState<AuthFileQuotaRow | null>(null);
  const [moveTargetInstanceId, setMoveTargetInstanceId] = useState("");
  const [moveBatchIds, setMoveBatchIds] = useState<number[] | null>(null);
  const [moveBatchCpaInstanceId, setMoveBatchCpaInstanceId] = useState<number | null>(null);
  const [proxyTarget, setProxyTarget] = useState<AuthFileQuotaRow | null>(null);
  const [proxyTargetUrl, setProxyTargetUrl] = useState("");
  const [tagTarget, setTagTarget] = useState<{
    instance: CpaInstance;
    authFileIds: number[];
    value: string;
    submitting: boolean;
  } | null>(null);
  const [openLoginMenuInstanceId, setOpenLoginMenuInstanceId] = useState<
    number | null
  >(null);
  const [rtLogin, setRtLogin] = useState<RtLoginDialogState | null>(null);
  const [sessionJson, setSessionJson] = useState<SessionJsonDialogState | null>(
    null,
  );
  const [oauthLogin, setOauthLogin] = useState<{
    instance: CpaInstance;
    authUrl: string | null;
    state: string | null;
    callbackUrl: string;
    loading: boolean;
    submitting: boolean;
    error: string | null;
  } | null>(null);
  const [openBulkMenuInstanceId, setOpenBulkMenuInstanceId] = useState<
    number | null
  >(null);
  const [openExchangeMenuInstanceId, setOpenExchangeMenuInstanceId] = useState<
    number | null
  >(null);
  const [exchangeMenuPosition, setExchangeMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  const [exchangeDialog, setExchangeDialog] = useState<{
    mode: AuthExchangeMode;
    instance: CpaInstance;
    rows: AuthFileQuotaRow[];
    selectedIds: number[];
    targetCpaInstanceId: string;
    submitting: boolean;
  } | null>(null);
  const [bulkExceptionTarget, setBulkExceptionTarget] = useState<{
    instance: CpaInstance;
    action: BatchExceptionAction;
    authFileIds: number[];
    title: string;
    subject: string;
    confirmVerb: string;
    successVerb: string;
    target?: BatchAuthFileTarget;
  } | null>(null);
  const [dragTargetCpaId, setDragTargetCpaId] = useState<number | null>(null);
  const [useDesktopMasonry, setUseDesktopMasonry] = useState(false);
  const [selectedAuthFileIds, setSelectedAuthFileIds] = useState<Set<number>>(
    new Set(),
  );
  const loginMenuRef = useRef<HTMLDivElement | null>(null);
  const bulkMenuRef = useRef<HTMLDivElement | null>(null);
  const exchangeMenuRef = useRef<HTMLDivElement | null>(null);
  const exchangeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cpaJsonInputRef = useRef<HTMLInputElement | null>(null);
  const cpaJsonUploadTargetRef = useRef<CpaInstance | null>(null);

  useEffect(() => {
    if (openLoginMenuInstanceId === null) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && loginMenuRef.current?.contains(target)) {
        return;
      }
      setOpenLoginMenuInstanceId(null);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openLoginMenuInstanceId]);

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
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openBulkMenuInstanceId]);

  useEffect(() => {
    if (openExchangeMenuInstanceId === null) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && exchangeMenuRef.current?.contains(target)) {
        return;
      }
      if (
        target instanceof Node &&
        exchangeTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setOpenExchangeMenuInstanceId(null);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openExchangeMenuInstanceId]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    const update = () => setUseDesktopMasonry(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  function openMoveDialog(
    rowOrBatch: AuthFileQuotaRow | { ids: number[]; cpaInstanceId: number },
  ) {
    if ("ids" in rowOrBatch) {
      const firstTarget = enabledInstances.find(
        (instance) => instance.id !== rowOrBatch.cpaInstanceId,
      );
      setMoveTarget(null);
      setMoveBatchIds(rowOrBatch.ids);
      setMoveBatchCpaInstanceId(rowOrBatch.cpaInstanceId);
      setMoveTargetInstanceId(firstTarget ? String(firstTarget.id) : "");
    } else {
      const firstTarget = enabledInstances.find(
        (instance) => instance.id !== rowOrBatch.cpaInstanceId,
      );
      setMoveTarget(rowOrBatch);
      setMoveBatchIds(null);
      setMoveBatchCpaInstanceId(null);
      setMoveTargetInstanceId(firstTarget ? String(firstTarget.id) : "");
    }
  }

  function openProxyDialog(row: AuthFileQuotaRow) {
    const proxyOptions = proxiesForCpa(row.cpaInstanceId);
    const currentProxyUrl =
      row.proxyUrl && proxyOptions.some((proxy) => proxy.url === row.proxyUrl)
        ? row.proxyUrl
        : "";
    setProxyTarget(row);
    setProxyTargetUrl(currentProxyUrl);
  }

  async function submitTagDialog() {
    if (!tagTarget) {
      return;
    }

    const tag = tagTarget.value.trim();
    if (!tag) {
      toast.info("请输入 Tag 内容");
      return;
    }

    setTagTarget((current) =>
      current ? { ...current, submitting: true } : current,
    );
    try {
      await onTagAuthFiles(tagTarget.instance.id, tagTarget.authFileIds, tag);
      setSelectedAuthFileIds((current) => {
        const next = new Set(current);
        tagTarget.authFileIds.forEach((id) => next.delete(id));
        return next;
      });
      setTagTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setTagTarget((current) =>
        current ? { ...current, submitting: false } : current,
      );
    }
  }

  function toggleExchangeMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    instanceId: number,
  ) {
    if (openExchangeMenuInstanceId === instanceId) {
      setOpenExchangeMenuInstanceId(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setExchangeMenuPosition(
      getFloatingMenuPosition(rect, {
        menuWidth: 112,
        menuHeight: 76,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
    setOpenLoginMenuInstanceId(null);
    setOpenBulkMenuInstanceId(null);
    setOpenExchangeMenuInstanceId(instanceId);
  }

  function openExchangeDialog(
    mode: AuthExchangeMode,
    instance: CpaInstance,
    rows: AuthFileQuotaRow[],
  ) {
    const firstTarget = enabledInstances.find(
      (target) => target.id !== instance.id,
    );
    setOpenExchangeMenuInstanceId(null);
    setExchangeDialog({
      mode,
      instance,
      rows,
      selectedIds: [],
      targetCpaInstanceId: firstTarget ? String(firstTarget.id) : "",
      submitting: false,
    });
  }

  function updateExchangeSelection(authFileId: number, selected: boolean) {
    setExchangeDialog((current) => {
      if (!current) {
        return current;
      }
      const next = selected
        ? [...new Set([...current.selectedIds, authFileId])]
        : current.selectedIds.filter((id) => id !== authFileId);
      return { ...current, selectedIds: next };
    });
  }

  function setAllExchangeRowsSelected(selected: boolean) {
    setExchangeDialog((current) =>
      current
        ? {
            ...current,
            selectedIds: selected ? current.rows.map((row) => row.id) : [],
          }
        : current,
    );
  }

  function quickSelectExchangeRows(count: number) {
    setExchangeDialog((current) =>
      current
        ? {
            ...current,
            selectedIds: selectAvailableAuthFileIds(current.rows, count),
          }
        : current,
    );
  }

  async function submitExchangeDialog() {
    if (!exchangeDialog || exchangeDialog.selectedIds.length === 0) {
      return;
    }

    const selectedIds = exchangeDialog.selectedIds;
    const targetCpaInstanceId = Number(exchangeDialog.targetCpaInstanceId);
    setExchangeDialog((current) =>
      current ? { ...current, submitting: true } : current,
    );
    try {
      if (exchangeDialog.mode === "download") {
        await onDownloadAuthFiles(exchangeDialog.instance.id, selectedIds);
      } else {
        await onMoveAuthFiles(
          exchangeDialog.instance.id,
          selectedIds,
          targetCpaInstanceId,
        );
      }
      setExchangeDialog(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setExchangeDialog((current) =>
        current ? { ...current, submitting: false } : current,
      );
    }
  }

  function proxiesForCpa(cpaInstanceId: number) {
    return proxies.filter(
      (proxy) => proxy.enabled && proxy.cpaInstanceIds.includes(cpaInstanceId),
    );
  }

  const moveOptions = (
    moveTarget
      ? [moveTarget.cpaInstanceId]
      : moveBatchCpaInstanceId
        ? [moveBatchCpaInstanceId]
        : []
  )
    .flatMap((cpaInstanceId) =>
      enabledInstances.filter((instance) => instance.id !== cpaInstanceId),
    )
    .filter(
      (instance, index, list) =>
        list.findIndex((item) => item.id === instance.id) === index,
    );
  const proxyOptions = proxyTarget
    ? proxiesForCpa(proxyTarget.cpaInstanceId)
    : [];

  function openRtLogin(instance: CpaInstance, mode: RtLoginMode = "rt") {
    setOpenLoginMenuInstanceId(null);
    setRtLogin({
      instance,
      mode,
      proxyMode: defaultRtLoginProxyMode(enabledLoginProxies.length),
      text: "",
      stage: "input",
      error: null,
      rows: [],
    });
  }

  function openCpaJsonPicker(instance: CpaInstance) {
    setOpenLoginMenuInstanceId(null);
    cpaJsonUploadTargetRef.current = instance;
    cpaJsonInputRef.current?.click();
  }

  function openSessionJsonDialog(instance: CpaInstance) {
    setOpenLoginMenuInstanceId(null);
    setSessionJson({
      instance,
      text: "",
      stage: "input",
      error: null,
    });
  }

  async function handleCpaJsonInputChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";

    const instance = cpaJsonUploadTargetRef.current;
    cpaJsonUploadTargetRef.current = null;
    if (!instance || files.length === 0) {
      return;
    }

    await uploadJsonFilesToCpa(instance, files);
  }

  async function uploadJsonFilesToCpa(instance: CpaInstance, files: File[]) {
    if (files.length === 0) {
      return;
    }

    const uploadFiles: CpaJsonUploadFile[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".json")) {
        toast.error(`${file.name} 不是 JSON 文件`);
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(await file.text()) as unknown;
      } catch {
        toast.error(`${file.name} 解析失败，请确认文件内容是合法 JSON`);
        return;
      }

      if (!isJsonObject(payload)) {
        toast.error(`${file.name} 必须是 JSON 对象`);
        return;
      }

      uploadFiles.push({
        fileName: file.name,
        payload,
      });
    }

    try {
      const result = await onUploadCpaJsonFiles(instance.id, uploadFiles);
      const uploaded = result?.uploaded ?? uploadFiles.length;
      const failed = result?.failed ?? 0;
      if (failed > 0) {
        toast.warning(`已上传 ${uploaded} 个 JSON 文件，${failed} 个失败`);
      } else {
        toast.success(`已上传 ${uploaded} 个 JSON 文件`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function submitSessionJson() {
    if (!sessionJson) {
      return;
    }

    const text = sessionJson.text.trim();
    if (!text) {
      const message = "请先粘贴 Session JSON";
      setSessionJson((current) =>
        current ? { ...current, error: message } : current,
      );
      toast.error(message);
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      const message = "Session JSON 解析失败，请确认内容是合法 JSON";
      setSessionJson((current) =>
        current ? { ...current, error: message } : current,
      );
      toast.error(message);
      return;
    }

    if (!isJsonObject(payload) && !Array.isArray(payload)) {
      const message = "Session JSON 必须是 JSON 对象或数组";
      setSessionJson((current) =>
        current ? { ...current, error: message } : current,
      );
      toast.error(message);
      return;
    }

    setSessionJson((current) =>
      current ? { ...current, stage: "uploading", error: null } : current,
    );
    try {
      const result = await onUploadCpaJsonFiles(
        sessionJson.instance.id,
        [{ fileName: "session-json.json", payload }],
        "session-json",
      );
      const uploaded = result?.uploaded ?? 0;
      const failed = result?.failed ?? 0;
      if (uploaded === 0 && failed > 0) {
        const firstError = result?.results.find(
          (item) => item.status === "error",
        )?.error;
        throw new Error(firstError ?? "Session JSON 转换失败");
      }
      if (failed > 0) {
        toast.warning(`已添加 ${uploaded} 个 Session 账号，${failed} 个失败`);
      } else {
        toast.success(`已添加 ${uploaded} 个 Session 账号`);
      }
      setSessionJson(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionJson((current) =>
        current ? { ...current, stage: "input", error: message } : current,
      );
      toast.error(message);
    }
  }

  function handleCpaJsonDragEnter(
    event: DragEvent<HTMLElement>,
    instance: CpaInstance,
  ) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragTargetCpaId(instance.id);
  }

  function handleCpaJsonDragOver(
    event: DragEvent<HTMLElement>,
    instance: CpaInstance,
  ) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (dragTargetCpaId !== instance.id) {
      setDragTargetCpaId(instance.id);
    }
  }

  function handleCpaJsonDragLeave(
    event: DragEvent<HTMLElement>,
    instance: CpaInstance,
  ) {
    if (dragTargetCpaId !== instance.id) {
      return;
    }
    const relatedTarget = event.relatedTarget;
    if (
      relatedTarget instanceof Node &&
      event.currentTarget.contains(relatedTarget)
    ) {
      return;
    }
    setDragTargetCpaId(null);
  }

  function handleCpaJsonDrop(
    event: DragEvent<HTMLElement>,
    instance: CpaInstance,
  ) {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragTargetCpaId(null);
    void uploadJsonFilesToCpa(instance, Array.from(event.dataTransfer.files));
  }

  function openOAuthLogin(instance: CpaInstance) {
    setOpenLoginMenuInstanceId(null);
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

  function updateRtLoginRow(rowId: string, patch: Partial<RtLoginUiRow>) {
    setRtLogin((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.id === rowId ? { ...row, ...patch } : row,
            ),
          }
        : current,
    );
  }

  async function loginRtRow(
    instance: CpaInstance,
    mode: RtLoginMode,
    row: RtLoginUiRow,
  ) {
    updateRtLoginRow(row.id, { status: "logging-in", error: null });
    try {
      const result = await onRtLoginAccount(instance.id, mode, row.sourceLine, {
        proxyId: row.proxyId,
      });
      updateRtLoginRow(row.id, {
        status: "success",
        email: result.email,
        refreshToken: result.refreshToken,
        result,
        error: null,
      });
    } catch (error) {
      updateRtLoginRow(row.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function runRtLoginRows(
    instance: CpaInstance,
    mode: RtLoginMode,
    rows: RtLoginUiRow[],
  ) {
    const proxyIds = [
      ...new Set(
        rows
          .map((row) => row.proxyId)
          .filter((id): id is number => id !== null),
      ),
    ];
    if (proxyIds.length > 0) {
      await Promise.all(
        proxyIds.map(async (proxyId) => {
          for (const row of rows.filter((item) => item.proxyId === proxyId)) {
            await loginRtRow(instance, mode, row);
          }
        }),
      );
    } else {
      for (const row of rows) {
        await loginRtRow(instance, mode, row);
      }
    }

    setRtLogin((current) =>
      current?.instance.id === instance.id && current.mode === mode
        ? { ...current, stage: "review" }
        : current,
    );
  }

  function startRtLoginFlow() {
    if (!rtLogin) {
      return;
    }

    const parsed = parseRtLoginInput(rtLogin.text);
    if (rtLogin.proxyMode === "pool" && enabledLoginProxies.length === 0) {
      const message = "没有启用的代理可用于代理池登录";
      setRtLogin((current) =>
        current ? { ...current, error: message } : current,
      );
      toast.error(message);
      return;
    }

    if (parsed.valid.length === 0 || parsed.invalid.length > 0) {
      const invalidLines = parsed.invalid
        .map((item) => `第 ${item.lineNumber} 行`)
        .join("、");
      const message =
        parsed.valid.length === 0
          ? "请输入至少一条有效 RT"
          : `${invalidLines} 格式不正确，请确认每行是一条 RT，或使用邮箱----密码----x----RT`;
      setRtLogin((current) =>
        current ? { ...current, error: message } : current,
      );
      toast.error(message);
      return;
    }

    const rows: RtLoginUiRow[] = parsed.valid.map((row, index) => {
      const proxy =
        rtLogin.proxyMode === "pool"
          ? enabledLoginProxies[index % enabledLoginProxies.length]
          : null;
      return {
        id: `${row.lineNumber}-${row.refreshToken}`,
        lineNumber: row.lineNumber,
        sourceLine: row.sourceLine,
        email: row.email,
        refreshToken: row.refreshToken,
        proxyId: proxy?.id ?? null,
        proxyName: proxy ? rtLoginProxyLabel(proxy) : null,
        status: "waiting",
        error: null,
        result: null,
      };
    });
    setRtLogin({
      ...rtLogin,
      stage: "processing",
      error: null,
      rows,
    });
    void runRtLoginRows(rtLogin.instance, rtLogin.mode, rows);
  }

  async function retryRtLoginRow(row: RtLoginUiRow) {
    if (!rtLogin) {
      return;
    }

    const { instance, mode } = rtLogin;
    setRtLogin((current) =>
      current ? { ...current, stage: "processing" } : current,
    );
    await loginRtRow(instance, mode, row);
    setRtLogin((current) => {
      if (!current) {
        return current;
      }

      const finished = current.rows.every(
        (item) => item.status === "success" || item.status === "failed",
      );
      return finished ? { ...current, stage: "review" } : current;
    });
  }

  async function uploadRtLoginSuccessRows() {
    if (!rtLogin) {
      return;
    }

    const entries = rtLogin.rows
      .map((row) => row.result)
      .filter((row): row is RtLoginAuthResult => row !== null);
    if (entries.length === 0) {
      toast.error("没有登录成功的账号可添加");
      return;
    }

    setRtLogin((current) =>
      current ? { ...current, stage: "uploading", error: null } : current,
    );
    try {
      const result = await onUploadRtLoginAccounts(
        rtLogin.instance.id,
        rtLogin.mode,
        entries,
      );
      const uploaded = result?.uploaded ?? entries.length;
      const failed = result?.failed ?? 0;
      if (failed > 0) {
        toast.warning(`已添加 ${uploaded} 个账号，${failed} 个上传失败`);
      } else {
        toast.success(`已添加 ${uploaded} 个账号`);
      }
      setRtLogin(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRtLogin((current) =>
        current ? { ...current, stage: "review", error: message } : current,
      );
      toast.error(message);
    }
  }

  const groupColumns =
    useDesktopMasonry && enabledGroups.length > 1
      ? distributeCpaGroups(enabledGroups)
      : [enabledGroups];
  const exchangeMoveOptions = exchangeDialog
    ? enabledInstances.filter(
        (instance) => instance.id !== exchangeDialog.instance.id,
      )
    : [];
  const exchangeSelectedCount = exchangeDialog?.selectedIds.length ?? 0;
  const exchangeAvailableCount = exchangeDialog
    ? selectAvailableAuthFileIds(
        exchangeDialog.rows,
        exchangeDialog.rows.length,
      ).length
    : 0;
  const exchangeAllSelected = Boolean(
    exchangeDialog &&
    exchangeDialog.rows.length > 0 &&
    exchangeDialog.selectedIds.length === exchangeDialog.rows.length,
  );

  function renderGroupCard(group: {
    instance: CpaInstance;
    authFiles: AuthFile[];
  }) {
    const quotaGroup = quotaGroups.find(
      (item) => item.instance.id === group.instance.id,
    );
    const rows = mergeAuthFilesWithQuotas(
      group.authFiles,
      quotaGroup?.quotas ?? [],
      proxyNameByUrl,
    );
    const activeRows = rows.filter((row) => !row.disabled);
    const exceptionRows = activeRows.filter(
      (row) => row.quotaStatus === "exception",
    );
    const limitedRows = activeRows.filter(
      (row) => row.quotaStatus === "limited",
    );
    const exceptionAuthFileIds = exceptionRows.map((row) => row.id);
    const disabledRows = rows.filter((row) => row.disabled);
    const disabledAuthFileIds = disabledRows.map((row) => row.id);
    const freeRows = rows.filter((row) =>
      isFreeSubscriptionType(row.subscriptionType),
    );
    const activeFreeRows = activeRows.filter((row) =>
      isFreeSubscriptionType(row.subscriptionType),
    );
    const freeAuthFileIds = freeRows.map((row) => row.id);
    const activeFreeAuthFileIds = activeFreeRows.map((row) => row.id);
    const hasSelection = rows.some((r) => selectedAuthFileIds.has(r.id));
    const selectedInGroupIds = rows
      .filter((r) => selectedAuthFileIds.has(r.id))
      .map((r) => r.id);
    const multiSelectExceptionIds = hasSelection
      ? [...selectedAuthFileIds].filter((id) =>
          exceptionAuthFileIds.includes(id),
        )
      : exceptionAuthFileIds;
    const multiSelectFreeIds = hasSelection
      ? [...selectedAuthFileIds].filter((id) => freeAuthFileIds.includes(id))
      : freeAuthFileIds;
    const multiSelectActiveFreeIds = hasSelection
      ? [...selectedAuthFileIds].filter((id) =>
          activeFreeAuthFileIds.includes(id),
        )
      : activeFreeAuthFileIds;
    const multiSelectDisabledIds = hasSelection
      ? [...selectedAuthFileIds].filter((id) =>
          disabledAuthFileIds.includes(id),
        )
      : disabledAuthFileIds;
    const disabledCount = disabledRows.length;
    const exceptionCount = exceptionRows.length;
    const availableCount = activeRows.filter(
      (row) => row.quotaStatus === "available",
    ).length;
    const hasAssignableProxy = proxiesForCpa(group.instance.id).length > 0;
    const average5hRemaining = averageAccountRemainingPercent(
      activeRows,
      "usage5hPercent",
      subscriptionWeights5h,
    );
    const averageWeekRemaining = averageAccountRemainingPercent(
      activeRows,
      "usageWeekPercent",
      subscriptionWeightsWeek,
    );
    const average5hDollars = subscriptionRemainingDollars(
      activeRows,
      "usage5hPercent",
      subscriptionWeights5h,
    );
    const averageWeekDollars = subscriptionRemainingDollars(
      activeRows,
      "usageWeekPercent",
      subscriptionWeightsWeek,
    );
    const isUpdating = updatingCpaIds.has(group.instance.id);
    const isSyncing = syncingCpaIds.has(group.instance.id) || isUpdating;
    const syncingLabel = isSyncing
      ? cpaBusyPhaseLabel(syncingCpaPhases.get(group.instance.id))
      : null;
    const isDragTarget = dragTargetCpaId === group.instance.id;
    const hasOpenHeaderMenu =
      openLoginMenuInstanceId === group.instance.id ||
      openBulkMenuInstanceId === group.instance.id ||
      openExchangeMenuInstanceId === group.instance.id;

    return (
      <div
        key={group.instance.id}
        aria-busy={isUpdating}
        className={cn(
          "relative min-w-0 rounded-md border bg-card [contain-intrinsic-size:360px] [content-visibility:auto]",
          isDragTarget && "border-primary/60 ring-2 ring-primary/30",
          hasOpenHeaderMenu ? "z-50 overflow-visible" : "overflow-hidden",
        )}
        onDragEnter={(event) => handleCpaJsonDragEnter(event, group.instance)}
        onDragOver={(event) => handleCpaJsonDragOver(event, group.instance)}
        onDragLeave={(event) => handleCpaJsonDragLeave(event, group.instance)}
        onDrop={(event) => handleCpaJsonDrop(event, group.instance)}
      >
        <div className="space-y-2 border-b bg-muted/35 px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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
              disabled={isSyncing}
              onClick={() => void onRefreshCpa(group.instance.id)}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")}
              />
            </Button>
            {syncingLabel ? (
              <span className="text-[11px] text-muted-foreground">
                {syncingLabel}
              </span>
            ) : null}
            <div
              ref={
                openLoginMenuInstanceId === group.instance.id
                  ? loginMenuRef
                  : null
              }
              className="relative"
            >
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-expanded={openLoginMenuInstanceId === group.instance.id}
                onClick={() => {
                  setOpenBulkMenuInstanceId(null);
                  setOpenExchangeMenuInstanceId(null);
                  setOpenLoginMenuInstanceId(
                    openLoginMenuInstanceId === group.instance.id
                      ? null
                      : group.instance.id,
                  );
                }}
              >
                <Plus className="h-3 w-3" />
                补号
              </Button>
              {openLoginMenuInstanceId === group.instance.id ? (
                <div className="absolute left-0 top-8 z-[60] min-w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                    onClick={() => openRtLogin(group.instance)}
                  >
                    <LogIn className="h-3 w-3" />
                    RT 登录
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                    onClick={() => openCpaJsonPicker(group.instance)}
                  >
                    <FileKey2 className="h-3 w-3" />
                    JSON 文件
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                    onClick={() => openSessionJsonDialog(group.instance)}
                  >
                    <FileKey2 className="h-3 w-3" />
                    Session JSON
                  </button>
                  <Separator className="my-1" />
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
            <div className="relative">
              <Button
                ref={
                  openExchangeMenuInstanceId === group.instance.id
                    ? exchangeTriggerRef
                    : null
                }
                type="button"
                size="xs"
                variant="outline"
                aria-label={`${group.instance.name} 交换`}
                aria-expanded={openExchangeMenuInstanceId === group.instance.id}
                aria-haspopup="menu"
                disabled={rows.length === 0 || isSyncing}
                title={rows.length === 0 ? "暂无账号" : undefined}
                onClick={(event) =>
                  toggleExchangeMenu(event, group.instance.id)
                }
              >
                <ArrowLeftRight className="h-3 w-3" />
                交换
              </Button>
              {openExchangeMenuInstanceId === group.instance.id &&
              typeof document !== "undefined"
                ? createPortal(
                    <div
                      ref={exchangeMenuRef}
                      role="menu"
                      className="fixed z-[120] min-w-28 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                      style={{
                        left: exchangeMenuPosition.left,
                        top: exchangeMenuPosition.top,
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                        onClick={() =>
                          openExchangeDialog("download", group.instance, rows)
                        }
                      >
                        取号
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={enabledInstances.length <= 1}
                        className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        onClick={() =>
                          openExchangeDialog("move", group.instance, rows)
                        }
                      >
                        移动
                      </button>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
            <div
              ref={
                openBulkMenuInstanceId === group.instance.id
                  ? bulkMenuRef
                  : null
              }
              className="relative"
            >
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={`${group.instance.name} 批量操作`}
                aria-expanded={openBulkMenuInstanceId === group.instance.id}
                onClick={() => {
                  setOpenLoginMenuInstanceId(null);
                  setOpenExchangeMenuInstanceId(null);
                  setOpenBulkMenuInstanceId(
                    openBulkMenuInstanceId === group.instance.id
                      ? null
                      : group.instance.id,
                  );
                }}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
              {openBulkMenuInstanceId === group.instance.id ? (
                <div className="absolute left-0 top-7 z-[60] min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                  <button
                    type="button"
                    disabled={!hasAssignableProxy || isSyncing}
                    title={
                      !hasAssignableProxy
                        ? "没有启用且允许用于该 CPA 的代理"
                        : undefined
                    }
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                    onClick={() => {
                      setOpenBulkMenuInstanceId(null);
                      void onAutoAssignCpaProxies(group.instance.id);
                    }}
                  >
                    自动分配代理
                    {hasSelection ? "(已选)" : ""}
                  </button>
                  <Separator className="my-1" />
                  <button
                    type="button"
                    disabled={multiSelectExceptionIds.length === 0}
                    title={
                      multiSelectExceptionIds.length === 0
                        ? hasSelection
                          ? "所选账号中无异常账号"
                          : "暂无异常账号"
                        : undefined
                    }
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800 disabled:pointer-events-none disabled:opacity-45"
                    onClick={() => {
                      setOpenBulkMenuInstanceId(null);
                      setBulkExceptionTarget({
                        instance: group.instance,
                        action: "portalExceptions",
                        authFileIds: multiSelectExceptionIds,
                        title: hasSelection
                          ? `批量清理 ${multiSelectExceptionIds.length} 个选中账号`
                          : "批量清理异常账号",
                        subject: hasSelection ? "选中账号" : "异常账号",
                        confirmVerb: "清理",
                        successVerb: "已清理到异常账号",
                      });

                    }}
                  >
                    批量清理异常账号
                    {hasSelection ? "(已选)" : ""}
                  </button>
                  <button
                    type="button"
                    disabled={multiSelectExceptionIds.length === 0}
                    title={
                      multiSelectExceptionIds.length === 0
                        ? hasSelection
                          ? "所选账号中无异常账号"
                          : "暂无异常账号"
                        : undefined
                    }
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                    onClick={() => {
                      setOpenBulkMenuInstanceId(null);
                      setBulkExceptionTarget({
                        instance: group.instance,
                        action: "disable",
                        authFileIds: multiSelectExceptionIds,
                        title: hasSelection
                          ? `批量停用 ${multiSelectExceptionIds.length} 个选中账号`
                          : "批量停用异常账号",
                        subject: hasSelection ? "选中账号" : "异常账号",
                        confirmVerb: "停用",
                        successVerb: "已停用",
                      });

                    }}
                  >
                    批量停用异常账号
                    {hasSelection ? "(已选)" : ""}
                  </button>
                  <Separator className="my-1" />
                  <button
                    type="button"
                    disabled={multiSelectFreeIds.length === 0}
                    title={
                      multiSelectFreeIds.length === 0
                        ? hasSelection
                          ? "所选账号中无 Free 号"
                          : "暂无 Free 号"
                        : undefined
                    }
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800 disabled:pointer-events-none disabled:opacity-45"
                    onClick={() => {
                      setOpenBulkMenuInstanceId(null);
                      setBulkExceptionTarget({
                        instance: group.instance,
                        action: "delete",
                        authFileIds: multiSelectFreeIds,
                        title: hasSelection
                          ? `批量清理 ${multiSelectFreeIds.length} 个选中账号`
                          : "批量清理Free号",
                        subject: hasSelection ? "选中账号" : "Free号",
                        confirmVerb: "清理",
                        successVerb: "已清理",
                        target: hasSelection ? "selected" : "free",
                      });

                    }}
                  >
                    批量清理Free号
                    {hasSelection ? "(已选)" : ""}
                  </button>
                  <button
                    type="button"
                    disabled={multiSelectActiveFreeIds.length === 0}
                    title={
                      multiSelectActiveFreeIds.length === 0
                        ? hasSelection
                          ? "所选账号中无可用 Free 号"
                          : "暂无可停用 Free 号"
                        : undefined
                    }
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                    onClick={() => {
                      setOpenBulkMenuInstanceId(null);
                      setBulkExceptionTarget({
                        instance: group.instance,
                        action: "disable",
                        authFileIds: multiSelectActiveFreeIds,
                        title: hasSelection
                          ? `批量停用 ${multiSelectActiveFreeIds.length} 个选中账号`
                          : "批量停用Free号",
                        subject: hasSelection ? "选中账号" : "Free号",
                        confirmVerb: "停用",
                        successVerb: "已停用",
                        target: hasSelection ? "selected" : "free",
                      });

                    }}
                  >
                    批量停用Free号
                    {hasSelection ? "(已选)" : ""}
                  </button>
                  <Separator className="my-1" />
                  <button
                    type="button"
                    disabled={multiSelectDisabledIds.length === 0}
                    title={
                      multiSelectDisabledIds.length === 0
                        ? hasSelection
                          ? "所选账号中无已停用账号"
                          : "暂无已停用账号"
                        : undefined
                    }
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800 disabled:pointer-events-none disabled:opacity-45"
                    onClick={() => {
                      setOpenBulkMenuInstanceId(null);
                      setBulkExceptionTarget({
                        instance: group.instance,
                        action: "delete",
                        authFileIds: multiSelectDisabledIds,
                        title: hasSelection
                          ? `批量删除 ${multiSelectDisabledIds.length} 个选中账号`
                          : "批量删除已停用账号",
                        subject: hasSelection ? "选中账号" : "已停用账号",
                        confirmVerb: "删除",
                        successVerb: "已删除",
                      });

                    }}
                  >
                    批量删除已停用账号
                    {hasSelection ? "(已选)" : ""}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/50 pt-1.5 text-xs text-muted-foreground">
            <HeaderAverageMeter
              label="5h"
              value={average5hRemaining}
              dollars={average5hDollars}
            />
            <HeaderAverageMeter
              label="周"
              value={averageWeekRemaining}
              dollars={averageWeekDollars}
            />
            <span className="text-emerald-700">{availableCount} 可用</span>
            {limitedRows.length > 0 ? (
              <span className="text-amber-700">{limitedRows.length} 限额</span>
            ) : null}
            {disabledCount > 0 ? <span>{disabledCount} 停用</span> : null}
            <span className="text-rose-700">{exceptionCount} 异常</span>
          </div>
        </div>
        <CompactAuthFileTable
          rows={rows}
          nowMs={nowMs}
          weights5h={subscriptionWeights5h}
          weightsWeek={subscriptionWeightsWeek}
          selectedIds={selectedAuthFileIds}
          onToggleSelect={(id) => {
            const next = new Set(selectedAuthFileIds);
            if (next.has(id)) {
              next.delete(id);
            } else {
              next.add(id);
            }
            setSelectedAuthFileIds(next);
          }}
          onToggleSelectAll={() => {
            if (selectedAuthFileIds.size === rows.length) {
              setSelectedAuthFileIds(new Set());
            } else {
              setSelectedAuthFileIds(new Set(rows.map((r) => r.id)));
            }
          }}
        />
        {isDragTarget ? (
          <div className="pointer-events-none absolute inset-0 z-[55] flex items-center justify-center bg-background/75 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-card px-3 py-2 text-sm font-medium text-primary shadow-sm">
              <FileKey2 className="h-4 w-4" />
              松开上传 JSON 文件到 {group.instance.name}
            </div>
          </div>
        ) : null}
        {isUpdating ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
               正在更新
            </div>
          </div>
        ) : null}
        {hasSelection ? (
          <div className="border-t border-border/50 px-3 py-2">
          {hasSelection ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setSelectedAuthFileIds(new Set())}
              >
                取消选择
              </Button>
              <span className="mr-1 text-xs text-muted-foreground">
                已选 {selectedInGroupIds.length} 个
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  selectedInGroupIds.forEach((id) =>
                    void onRefreshAuthFileQuota(id),
                  );
                }}
              >
                <RefreshCw className="h-3 w-3" />
                刷新配额
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  const selectedRows = rows.filter((r) =>
                    selectedAuthFileIds.has(r.id),
                  );
                  if (selectedRows.length > 0) {
                    const next = !selectedRows[0].disabled;
                    selectedInGroupIds.forEach((id) =>
                      void onToggleAuthFileDisabled(id, next),
                    );
                  }
                }}
              >
                {rows.some(
                  (r) => selectedAuthFileIds.has(r.id) && r.disabled,
                )
                  ? "启用"
                  : "停用"}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  const selectedRows = rows.filter((r) =>
                    selectedAuthFileIds.has(r.id),
                  );
                  if (selectedRows.length > 0) {
                    openProxyDialog(selectedRows[0]);
                  }
                }}
              >
                配置代理
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  if (selectedInGroupIds.length > 0) {
                    setTagTarget({
                      instance: group.instance,
                      authFileIds: selectedInGroupIds,
                      value: "",
                      submitting: false,
                    });
                  }
                }}
              >
                打Tag
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={enabledInstances.length <= 1}
                onClick={() => {
                  if (selectedInGroupIds.length > 0) {
                    openMoveDialog({
                      ids: selectedInGroupIds,
                      cpaInstanceId: group.instance.id,
                    });
                  }
                }}
              >
                移动到
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setBulkExceptionTarget({
                    instance: group.instance,
                    action: "portalCandidates",
                    authFileIds: selectedInGroupIds,
                    title: `批量去候补 ${selectedInGroupIds.length} 个账号`,
                    subject: "选中账号",
                    confirmVerb: "去候补",
                    successVerb: "已设为候补",
                  });
                }}
              >
                去候补
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setBulkExceptionTarget({
                    instance: group.instance,
                    action: "portalExceptions",
                    authFileIds: selectedInGroupIds,
                    title: `批量清理 ${selectedInGroupIds.length} 个选中账号`,
                    subject: "选中账号",
                    confirmVerb: "清理",
                    successVerb: "已清理到异常账号",
                  });
                }}
              >
                清理
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                onClick={() => {
                  setBulkExceptionTarget({
                    instance: group.instance,
                    action: "delete",
                    authFileIds: selectedInGroupIds,
                    title: `批量删除 ${selectedInGroupIds.length} 个选中账号`,
                    subject: "选中账号",
                    confirmVerb: "删除",
                    successVerb: "已删除",
                    target: "selected",
                  });
                }}
              >
                删除
              </Button>
            </div>
          ) : null}
        </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <input
        ref={cpaJsonInputRef}
        type="file"
        accept="application/json,.json"
        multiple
        className="hidden"
        onChange={(event) => void handleCpaJsonInputChange(event)}
      />
      <section
        className={cn(
          groupColumns.length > 1 ? "grid grid-cols-2 gap-3" : "space-y-3",
        )}
      >
        {groupColumns.length === 1
          ? groupColumns[0].map(renderGroupCard)
          : groupColumns.map((column, columnIndex) => (
              <div key={columnIndex} className="space-y-3">
                {column.map(renderGroupCard)}
              </div>
            ))}
      </section>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除账号</DialogTitle>
            <DialogDescription>
              确定要从 CPA 中删除{" "}
              {deleteTarget?.email ?? deleteTarget?.fileName ?? "这个账号"}{" "}
              吗？这个操作会同时删除本地记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
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

      <Dialog
        open={moveTarget !== null || moveBatchIds !== null}
        onOpenChange={(open) =>
          !open && (setMoveTarget(null), setMoveBatchIds(null), setMoveBatchCpaInstanceId(null))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动账号</DialogTitle>
            <DialogDescription>
              {moveBatchIds && moveBatchIds.length > 0
                ? `移动 ${moveBatchIds.length} 个选中账号到目标 CPA。确认后会先上传认证文件到目标 CPA，再从当前 CPA 删除。`
                : "选择目标 CPA。确认后会先上传认证文件到目标 CPA，再从当前 CPA 删除。"}
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
              <div className="text-sm text-muted-foreground">
                没有其他已启用 CPA 可移动。
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMoveTarget(null);
                setMoveBatchIds(null);
                setMoveBatchCpaInstanceId(null);
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={
                (moveTarget === null && moveBatchIds === null) ||
                !moveTargetInstanceId
              }
              onClick={() => {
                if (!moveTargetInstanceId) {
                  return;
                }
                const targetId = Number(moveTargetInstanceId);
                if (moveBatchIds && moveBatchIds.length > 0) {
                  const batchIds = moveBatchIds;
                  const batchCpaId = moveBatchCpaInstanceId;
                  setMoveBatchIds(null);
                  setMoveBatchCpaInstanceId(null);
                  if (batchCpaId) {
                    void onMoveAuthFiles(batchCpaId, batchIds, targetId);
                  }
                } else if (moveTarget) {
                  const authFileId = moveTarget.id;
                  setMoveTarget(null);
                  void onMoveAuthFile(authFileId, targetId);
                }
              }}
            >
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={proxyTarget !== null}
        onOpenChange={(open) => !open && setProxyTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>配置代理</DialogTitle>
            <DialogDescription>
              为 {proxyTarget?.email ?? proxyTarget?.fileName ?? "这个账号"}{" "}
              选择该 CPA 可用的代理。
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
              <div className="text-sm text-muted-foreground">
                这个 CPA 暂无可用代理。
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setProxyTarget(null)}
            >
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

      <Dialog
        open={tagTarget !== null}
        onOpenChange={(open) => {
          if (!open && !tagTarget?.submitting) {
            setTagTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>打Tag</DialogTitle>
            <DialogDescription>
              给 {tagTarget?.authFileIds.length ?? 0} 个选中账号设置同一个
              Tag。再次打 Tag 会覆盖原有内容。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="auth-file-tag">Tag 内容</Label>
            <Input
              id="auth-file-tag"
              value={tagTarget?.value ?? ""}
              maxLength={accountTagMaxLength}
              disabled={tagTarget?.submitting}
              autoFocus
              onChange={(event) =>
                setTagTarget((current) =>
                  current ? { ...current, value: event.target.value } : current,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitTagDialog();
                }
              }}
            />
            <div className="text-xs text-muted-foreground">
              最多 {accountTagMaxLength} 个字符。
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={tagTarget?.submitting}
              onClick={() => setTagTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!tagTarget || tagTarget.submitting || !tagTarget.value.trim()}
              onClick={() => void submitTagDialog()}
            >
              {tagTarget?.submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rtLogin !== null}
        onOpenChange={(open) => {
          if (
            !open &&
            rtLogin?.stage !== "processing" &&
            rtLogin?.stage !== "uploading"
          ) {
            setRtLogin(null);
          }
        }}
      >
        <DialogContent
          className={cn(
            rtLogin?.stage === "input" ? "sm:max-w-2xl" : "sm:max-w-3xl",
          )}
        >
          <DialogHeader>
            <DialogTitle>RT 登录</DialogTitle>
            <DialogDescription>
              {rtLogin?.instance.name ?? "当前 CPA"} 的 RT 登录。
            </DialogDescription>
          </DialogHeader>
          {rtLogin?.stage === "input" ? (
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>登录类型</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className={cn(
                      "h-9 rounded-full border px-4 text-sm font-semibold shadow-none",
                      rtLogin.mode === "rt"
                        ? "border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-900 hover:text-white"
                        : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    onClick={() =>
                      setRtLogin((current) =>
                        current
                          ? { ...current, mode: "rt", error: null }
                          : current,
                      )
                    }
                  >
                    RT
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className={cn(
                      "h-9 rounded-full border px-4 text-sm font-semibold shadow-none",
                      rtLogin.mode === "mobile_rt"
                        ? "border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-900 hover:text-white"
                        : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    onClick={() =>
                      setRtLogin((current) =>
                        current
                          ? { ...current, mode: "mobile_rt", error: null }
                          : current,
                      )
                    }
                  >
                    Mobile RT
                  </Button>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>登录方式</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className={cn(
                      "h-9 rounded-full border px-4 text-sm font-semibold shadow-none",
                      rtLogin.proxyMode === "none"
                        ? "border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-900 hover:text-white"
                        : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    onClick={() =>
                      setRtLogin((current) =>
                        current
                          ? { ...current, proxyMode: "none", error: null }
                          : current,
                      )
                    }
                  >
                    不使用代理池
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={enabledLoginProxies.length === 0}
                    title={
                      enabledLoginProxies.length === 0
                        ? "暂无启用代理"
                        : undefined
                    }
                    className={cn(
                      "h-9 rounded-full border px-4 text-sm font-semibold shadow-none disabled:opacity-45",
                      rtLogin.proxyMode === "pool"
                        ? "border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-900 hover:text-white"
                        : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    onClick={() =>
                      setRtLogin((current) =>
                        current
                          ? { ...current, proxyMode: "pool", error: null }
                          : current,
                      )
                    }
                  >
                    <Network className="h-3.5 w-3.5" />
                    用代理池登录
                  </Button>
                  {rtLogin.proxyMode === "pool" ? (
                    <Badge variant="outline">
                      {enabledLoginProxies.length} 个代理
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="grid w-full gap-2">
                <Label htmlFor="rt-login-input">RT 列表</Label>
                <Textarea
                  id="rt-login-input"
                  value={rtLogin.text}
                  placeholder="一行一条，可以是邮箱----密码----x----RT，也可以只有 RT"
                  className={cn(
                    "min-h-44 w-full resize-y font-mono text-xs focus-visible:ring-1",
                    rtLogin.error &&
                      "border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-200",
                  )}
                  onChange={(event) =>
                    setRtLogin((current) =>
                      current
                        ? { ...current, text: event.target.value, error: null }
                        : current,
                    )
                  }
                />
              </div>
            </div>
          ) : null}
          {rtLogin && rtLogin.stage !== "input" ? (
            <div className="max-h-[58vh] overflow-auto rounded-md border">
              <table className="w-full caption-bottom text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14 px-3 py-2">行</TableHead>
                    <TableHead className="px-3 py-2">账号</TableHead>
                    {rtLogin.rows.some((row) => row.proxyId !== null) ? (
                      <TableHead className="px-3 py-2">代理</TableHead>
                    ) : null}
                    <TableHead className="px-3 py-2">状态</TableHead>
                    <TableHead className="px-3 py-2">订阅</TableHead>
                    <TableHead className="px-3 py-2 text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rtLogin.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="px-3 py-2 text-muted-foreground">
                        #{row.lineNumber}
                      </TableCell>
                      <TableCell className="max-w-[280px] px-3 py-2">
                        <div
                          className="truncate font-medium"
                          title={
                            row.result?.email ?? row.email ?? row.sourceLine
                          }
                        >
                          {row.result?.email ??
                            row.email ??
                            maskRefreshToken(row.refreshToken)}
                        </div>
                        <div
                          className="truncate text-xs text-muted-foreground"
                          title={row.result?.fileName ?? row.sourceLine}
                        >
                          {row.result?.fileName ?? row.sourceLine}
                        </div>
                      </TableCell>
                      {rtLogin.rows.some((item) => item.proxyId !== null) ? (
                        <TableCell className="max-w-[160px] px-3 py-2">
                          <div
                            className="truncate text-xs text-muted-foreground"
                            title={row.proxyName ?? undefined}
                          >
                            {row.proxyName ?? "-"}
                          </div>
                        </TableCell>
                      ) : null}
                      <TableCell className="max-w-[240px] px-3 py-2">
                        <span
                          title={row.error ?? undefined}
                          className={cn(
                            "inline-flex items-center gap-1.5 text-xs font-medium",
                            rtLoginStatusClass(row.status),
                          )}
                        >
                          {row.status === "logging-in" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : null}
                          {rtLoginStatusLabel(row.status)}
                        </span>
                        {row.error ? (
                          <span
                            className="ml-2 inline-block max-w-[150px] truncate align-bottom text-xs text-muted-foreground"
                            title={row.error}
                          >
                            {row.error}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        {row.result ? (
                          <SubscriptionBadge value={row.result.planType} />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right">
                        {row.status === "failed" ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={rtLogin.stage !== "review"}
                            onClick={() => void retryRtLoginRow(row)}
                          >
                            <RefreshCw className="h-3 w-3" />
                            重试
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={
                rtLogin?.stage === "processing" ||
                rtLogin?.stage === "uploading"
              }
              onClick={() => setRtLogin(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={
                !rtLogin ||
                rtLogin.stage === "processing" ||
                rtLogin.stage === "uploading" ||
                (rtLogin.stage === "review" &&
                  rtLogin.rows.every((row) => row.status !== "success"))
              }
              onClick={() => {
                if (!rtLogin) {
                  return;
                }
                if (rtLogin.stage === "input") {
                  startRtLoginFlow();
                  return;
                }
                if (rtLogin.stage === "review") {
                  void uploadRtLoginSuccessRows();
                }
              }}
            >
              {rtLogin?.stage === "processing" ||
              rtLogin?.stage === "uploading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {rtLoginConfirmLabel(rtLogin)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={sessionJson !== null}
        onOpenChange={(open) => {
          if (!open && sessionJson?.stage !== "uploading") {
            setSessionJson(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Session JSON</DialogTitle>
            <DialogDescription>
              粘贴 GPTSession2CPAandSub2API 使用的 ChatGPT Session
              JSON，转换后添加到 {sessionJson?.instance.name ?? "当前 CPA"}。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="session-json-input">Session JSON</Label>
            <Textarea
              id="session-json-input"
              value={sessionJson?.text ?? ""}
              disabled={sessionJson?.stage === "uploading"}
              placeholder='{"user":{"email":"mark@example.com"},"expires":"2026-08-06T14:29:36.155Z","account":{"id":"...","planType":"plus"},"accessToken":"...","sessionToken":"..."}'
              className={cn(
                "max-h-[45vh] min-h-56 resize-y overflow-auto font-mono text-xs",
                sessionJson?.error &&
                  "border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-200",
              )}
              onChange={(event) =>
                setSessionJson((current) =>
                  current
                    ? { ...current, text: event.target.value, error: null }
                    : current,
                )
              }
            />
            <div className="text-xs text-muted-foreground">
              支持单个 Session JSON，也支持包含多个 session 对象的数组或嵌套
              JSON。
            </div>
            {sessionJson?.error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {sessionJson.error}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={sessionJson?.stage === "uploading"}
              onClick={() => setSessionJson(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!sessionJson || sessionJson.stage === "uploading"}
              onClick={() => void submitSessionJson()}
            >
              {sessionJson?.stage === "uploading" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              确定
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
              {oauthLogin?.instance.name ?? "当前 CPA"} 的 Codex OAuth
              登录链接。
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
                          window.open(
                            oauthLogin.authUrl,
                            "_blank",
                            "noopener,noreferrer",
                          );
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
                        current
                          ? { ...current, callbackUrl: event.target.value }
                          : current,
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
        open={exchangeDialog !== null}
        onOpenChange={(open) => {
          if (!open && !exchangeDialog?.submitting) {
            setExchangeDialog(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {exchangeDialog?.mode === "move" ? "移动账号" : "取号"}
            </DialogTitle>
            <DialogDescription>
              {exchangeDialog?.instance.name ?? "当前 CPA"} 的 Auth 文件。
            </DialogDescription>
          </DialogHeader>
          {exchangeDialog ? (
            <div className="grid gap-3">
              {exchangeDialog.mode === "move" ? (
                <div className="grid gap-2">
                  <Label htmlFor="exchange-target-cpa">目标 CPA</Label>
                  <select
                    id="exchange-target-cpa"
                    value={exchangeDialog.targetCpaInstanceId}
                    disabled={
                      exchangeDialog.submitting ||
                      exchangeMoveOptions.length === 0
                    }
                    onChange={(event) =>
                      setExchangeDialog((current) =>
                        current
                          ? {
                              ...current,
                              targetCpaInstanceId: event.target.value,
                            }
                          : current,
                      )
                    }
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    {exchangeMoveOptions.map((instance) => (
                      <option key={instance.id} value={instance.id}>
                        {instance.name}
                      </option>
                    ))}
                  </select>
                  {exchangeMoveOptions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      没有其他已启用 CPA 可移动。
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">快速选择</span>
                {authExchangeQuickSelectCounts.map((count) => (
                  <Button
                    key={count}
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={
                      exchangeDialog.submitting || exchangeAvailableCount === 0
                    }
                    onClick={() => quickSelectExchangeRows(count)}
                  >
                    选{count}
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground">
                  可用 {exchangeAvailableCount} 个
                </span>
              </div>
              <div className="overflow-hidden rounded-md border">
                <label className="flex items-center gap-2 border-b bg-muted/35 px-3 py-2 text-sm font-medium">
                  <Checkbox
                    checked={exchangeAllSelected}
                    disabled={
                      exchangeDialog.submitting ||
                      exchangeDialog.rows.length === 0
                    }
                    onCheckedChange={(checked) =>
                      setAllExchangeRowsSelected(Boolean(checked))
                    }
                  />
                  全选
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {exchangeDialog.rows.length} 个
                  </span>
                </label>
                <div className="max-h-[45vh] overflow-auto">
                  {exchangeDialog.rows.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                      暂无数据
                    </div>
                  ) : (
                    exchangeDialog.rows.map((row) => (
                      <label
                        key={row.id}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={exchangeDialog.selectedIds.includes(row.id)}
                          disabled={exchangeDialog.submitting}
                          onCheckedChange={(checked) =>
                            updateExchangeSelection(row.id, Boolean(checked))
                          }
                        />
                        <SubscriptionBadge value={row.subscriptionType} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">
                            {row.email ?? "-"}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">
                            {row.fileName}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter className="items-center sm:justify-between">
            <div className="w-full text-xs text-muted-foreground sm:w-auto">
              已选择 {exchangeSelectedCount} 个
            </div>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button
                type="button"
                variant="outline"
                disabled={exchangeDialog?.submitting}
                onClick={() => setExchangeDialog(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                disabled={
                  !exchangeDialog ||
                  exchangeDialog.submitting ||
                  exchangeSelectedCount === 0 ||
                  (exchangeDialog.mode === "move" &&
                    !exchangeDialog.targetCpaInstanceId)
                }
                onClick={() => void submitExchangeDialog()}
              >
                {exchangeDialog?.submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                确定
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkExceptionTarget !== null}
        onOpenChange={(open) => !open && setBulkExceptionTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulkExceptionTarget?.title ?? "批量操作"}
            </DialogTitle>
            <DialogDescription>
              确认对 {bulkExceptionTarget?.instance.name ?? "这个 CPA"} 的{" "}
              {bulkExceptionTarget?.authFileIds.length ?? 0} 个
              {bulkExceptionTarget?.subject ?? "账号"}执行
              {bulkExceptionTarget?.confirmVerb ?? "操作"}吗？操作会调用 CPA
              接口并在完成后刷新该 CPA。
            </DialogDescription>
          </DialogHeader>
          {bulkExceptionTarget?.action === "delete" ? (
            <p className="text-sm text-muted-foreground">
              删除会从 CPA 中移除认证文件，并清理本地账号和配额记录。
            </p>
          ) : null}
          {bulkExceptionTarget?.action === "portalExceptions" ? (
            <p className="text-sm text-muted-foreground">
              清理会先保存认证文件到异常账号池，再从 CPA
              中移除认证文件和本地账号记录。
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkExceptionTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant={
                bulkExceptionTarget?.action === "delete" ||
                bulkExceptionTarget?.action === "portalExceptions"
                  ? "destructive"
                  : "default"
              }
              disabled={
                !bulkExceptionTarget ||
                bulkExceptionTarget.authFileIds.length === 0
              }
              onClick={() => {
                if (
                  !bulkExceptionTarget ||
                  bulkExceptionTarget.authFileIds.length === 0
                ) {
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
                  target.target,
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

type CandidateAuthFileQuotaRow = {
  id: number;
  fileName: string;
  email: string | null;
  available: boolean;
  quotaStatus: AccountQuotaState | "pending";
  quotaStatusLabel: string;
  subscriptionType: string | null;
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
  usage5hResetAt: string | null;
  usageWeekResetAt: string | null;
  exception: string | null;
  refreshedAt: string | null;
  createdAt: string;
  lastRefresh: string | null;
  expired: string | null;
  refreshToken: string | null;
};

function CandidatePoolSection({
  rows,
  instances,
  nowMs,
  refreshing,
  refreshingMode,
  onUploadJsonFiles,
  onRefreshQuotas,
  onExportJsonFiles,
  onMoveToCpa,
  onRefreshTokens,
  onRefreshSelectedQuotas,
}: {
  rows: CandidateAuthFile[];
  instances: CpaInstance[];
  nowMs: number;
  refreshing: boolean;
  refreshingMode: CandidateQuotaRefreshMode | null;
  onUploadJsonFiles: (
    files: CpaJsonUploadFile[],
  ) => Promise<CpaJsonUploadResult | null>;
  onRefreshQuotas: (refreshToken: boolean) => Promise<void>;
  onExportJsonFiles: (
    authFileIds: number[],
    deleteAfterExport: boolean,
  ) => Promise<void>;
  onMoveToCpa: (
    authFileIds: number[],
    targetCpaInstanceId: number,
  ) => Promise<void>;
  onRefreshTokens: (authFileIds: number[]) => Promise<{
    processed: number;
    failed: number;
    rotated: number;
  }>;
  onRefreshSelectedQuotas: (
    authFileIds: number[],
    refreshToken: boolean,
  ) => Promise<{
    processed: number;
    failed: number;
  }>;
}) {
  const [openUploadMenu, setOpenUploadMenu] = useState(false);
  const [openBatchMenu, setOpenBatchMenu] = useState(false);
  const [jsonContentDialog, setJsonContentDialog] = useState<{
    text: string;
    submitting: boolean;
    error: string | null;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchAction, setBatchAction] = useState<
    | "export"
    | "exportAndDelete"
    | "move"
    | "refreshToken"
    | "refreshQuotaWithRt"
    | "refreshQuotaWithoutRt"
    | null
  >(null);
  const [moveDialog, setMoveDialog] = useState<{
    authFileIds: number[];
    targetCpaInstanceId: string;
    submitting: boolean;
  } | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const batchMenuRef = useRef<HTMLDivElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const tableRows = useMemo(() => buildCandidatePoolRows(rows), [rows]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleIds = useMemo(() => tableRows.map((row) => row.id), [tableRows]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const selectedVisibleIds = useMemo(
    () => selectedIds.filter((id) => visibleIdSet.has(id)),
    [selectedIds, visibleIdSet],
  );
  const selectedVisibleCount = selectedVisibleIds.length;
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  const activeRows = tableRows.filter((row) => row.quotaStatus !== "pending");
  const average5hRemaining = averageAccountRemainingPercent(
    activeRows,
    "usage5hPercent",
  );
  const averageWeekRemaining = averageAccountRemainingPercent(
    activeRows,
    "usageWeekPercent",
  );
  const availableCount = tableRows.filter(
    (row) => row.quotaStatus === "available",
  ).length;
  const limitedCount = tableRows.filter(
    (row) => row.quotaStatus === "limited",
  ).length;
  const exceptionCount = tableRows.filter(
    (row) => row.quotaStatus === "exception",
  ).length;
  const pendingCount = tableRows.filter(
    (row) => row.quotaStatus === "pending",
  ).length;

  useEffect(() => {
    if (!openUploadMenu) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && uploadMenuRef.current?.contains(target)) {
        return;
      }
      setOpenUploadMenu(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openUploadMenu]);

  useEffect(() => {
    if (!openBatchMenu) {
      return;
    }

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && batchMenuRef.current?.contains(target)) {
        return;
      }
      setOpenBatchMenu(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openBatchMenu]);

  function toggleCandidateSelected(id: number, selected: boolean) {
    setSelectedIds((current) => {
      if (selected) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((item) => item !== id);
    });
  }

  function toggleAllCandidates(selected: boolean) {
    setSelectedIds(selected ? visibleIds : []);
  }

  async function handleExportSelected(deleteAfterExport: boolean) {
    if (selectedVisibleIds.length === 0) {
      toast.info("请先选择候补账号");
      return;
    }

    setBatchAction(deleteAfterExport ? "exportAndDelete" : "export");
    try {
      await onExportJsonFiles(selectedVisibleIds, deleteAfterExport);
      toast.success(deleteAfterExport ? "已导出并删除候补账号" : "已导出候补账号");
      if (deleteAfterExport) {
        setSelectedIds([]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBatchAction(null);
    }
  }

  function openMoveDialog() {
    if (selectedVisibleIds.length === 0) {
      toast.info("请先选择候补账号");
      return;
    }

    setMoveDialog({
      authFileIds: selectedVisibleIds,
      targetCpaInstanceId: instances[0] ? String(instances[0].id) : "",
      submitting: false,
    });
  }

  async function submitMoveDialog() {
    if (!moveDialog) {
      return;
    }
    const targetCpaInstanceId = Number(moveDialog.targetCpaInstanceId);
    if (!Number.isInteger(targetCpaInstanceId) || targetCpaInstanceId <= 0) {
      toast.error("请选择目标 CPA");
      return;
    }

    setMoveDialog((current) => current ? { ...current, submitting: true } : current);
    setBatchAction("move");
    try {
      await onMoveToCpa(moveDialog.authFileIds, targetCpaInstanceId);
      setSelectedIds([]);
      setMoveDialog(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMoveDialog((current) =>
        current ? { ...current, submitting: false } : current,
      );
      toast.error(message);
    } finally {
      setBatchAction(null);
    }
  }

  async function handleRefreshSelectedTokens() {
    if (selectedVisibleIds.length === 0) {
      toast.info("请先选择候补账号");
      return;
    }

    setBatchAction("refreshToken");
    try {
      const result = await onRefreshTokens(selectedVisibleIds);
      if (result.failed > 0) {
        toast.warning(
          `已刷 RT：${result.processed} 个成功，${result.failed} 个失败，${result.rotated} 个 RT 已轮换`,
        );
      } else {
        toast.success(`已刷 RT ${result.processed} 个，${result.rotated} 个 RT 已轮换`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBatchAction(null);
    }
  }

  async function handleRefreshSelectedQuotas(refreshToken: boolean) {
    if (selectedVisibleIds.length === 0) {
      toast.info("请先选择候补账号");
      return;
    }

    setBatchAction(refreshToken ? "refreshQuotaWithRt" : "refreshQuotaWithoutRt");
    try {
      const result = await onRefreshSelectedQuotas(selectedVisibleIds, refreshToken);
      if (result.failed > 0) {
        toast.warning(
          `选中账号配额已刷新：${result.processed} 个成功，${result.failed} 个异常`,
        );
      } else {
        toast.success(`选中账号配额已刷新 ${result.processed} 个`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBatchAction(null);
    }
  }

  async function handleJsonInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) {
      return;
    }

    const uploadFiles: CpaJsonUploadFile[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".json")) {
        toast.error(`${file.name} 不是 JSON 文件`);
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(await file.text()) as unknown;
      } catch {
        toast.error(`${file.name} 解析失败，请确认文件内容是合法 JSON`);
        return;
      }

      if (!isJsonObject(payload)) {
        toast.error(`${file.name} 必须是 JSON 对象`);
        return;
      }

      uploadFiles.push({ fileName: file.name, payload });
    }

    try {
      const result = await onUploadJsonFiles(uploadFiles);
      const uploaded = result?.uploaded ?? uploadFiles.length;
      const failed = result?.failed ?? 0;
      if (failed > 0) {
        toast.warning(`已导入 ${uploaded} 个候补账号，${failed} 个失败`);
      } else {
        toast.success(`已导入 ${uploaded} 个候补账号`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function submitJsonContent() {
    if (!jsonContentDialog) {
      return;
    }

    let uploadFiles: CpaJsonUploadFile[];
    try {
      uploadFiles = parseCandidateJsonContent(jsonContentDialog.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setJsonContentDialog((current) =>
        current ? { ...current, error: message } : current,
      );
      toast.error(message);
      return;
    }

    setJsonContentDialog((current) =>
      current ? { ...current, submitting: true, error: null } : current,
    );
    try {
      const result = await onUploadJsonFiles(uploadFiles);
      const uploaded = result?.uploaded ?? uploadFiles.length;
      const failed = result?.failed ?? 0;
      if (failed > 0) {
        toast.warning(`已导入 ${uploaded} 个候补账号，${failed} 个失败`);
      } else {
        toast.success(`已导入 ${uploaded} 个候补账号`);
      }
      setJsonContentDialog(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setJsonContentDialog((current) =>
        current ? { ...current, submitting: false, error: message } : current,
      );
      toast.error(message);
    }
  }

  return (
    <>
      <section className="space-y-3">
        <input
          ref={jsonInputRef}
          type="file"
          accept="application/json,.json"
          multiple
          className="hidden"
          onChange={(event) => void handleJsonInputChange(event)}
        />

        <div className="relative overflow-hidden rounded-md border bg-card">
          <div className="space-y-2 border-b bg-muted/35 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">候补号池</h2>
              <Badge variant="secondary">{tableRows.length}</Badge>
              {selectedVisibleIds.length > 0 ? (
                <>
                  <Badge variant="outline">已选 {selectedVisibleIds.length}</Badge>
                  <div ref={batchMenuRef} className="relative">
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="outline"
                      aria-label="批量操作"
                      aria-expanded={openBatchMenu}
                      disabled={batchAction !== null}
                      onClick={() => setOpenBatchMenu((open) => !open)}
                    >
                      {batchAction !== null ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    {openBatchMenu ? (
                      <div className="absolute left-0 top-8 z-[70] min-w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            setOpenBatchMenu(false);
                            void handleExportSelected(false);
                          }}
                        >
                          <Download className="h-3 w-3" />
                          导出JSON
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            setOpenBatchMenu(false);
                            void handleExportSelected(true);
                          }}
                        >
                          <Download className="h-3 w-3" />
                          导出JSON并删除
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={instances.length === 0}
                          title={instances.length === 0 ? "没有已启用 CPA" : undefined}
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                          onClick={() => {
                            setOpenBatchMenu(false);
                            openMoveDialog();
                          }}
                        >
                          <ArrowLeftRight className="h-3 w-3" />
                          移动到CPA
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            setOpenBatchMenu(false);
                            void handleRefreshSelectedTokens();
                          }}
                        >
                          <RefreshCw className="h-3 w-3" />
                          刷 RT
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            setOpenBatchMenu(false);
                            void handleRefreshSelectedQuotas(true);
                          }}
                        >
                          <RefreshCw className="h-3 w-3" />
                          刷新配额（按需刷新RT）
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            setOpenBatchMenu(false);
                            void handleRefreshSelectedQuotas(false);
                          }}
                        >
                          <RefreshCw className="h-3 w-3" />
                          刷新配额（不刷新RT）
                        </button>
                      </div>
        ) : null}
      </div>
                </>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={refreshing || tableRows.length === 0}
                onClick={() => void onRefreshQuotas(true)}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    refreshingMode === "withRt" && "animate-spin",
                  )}
                />
                刷新配额（按需刷新RT）
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={refreshing || tableRows.length === 0}
                onClick={() => void onRefreshQuotas(false)}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    refreshingMode === "withoutRt" && "animate-spin",
                  )}
                />
                刷新配额（不刷新RT）
              </Button>
              <div ref={uploadMenuRef} className="relative">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  aria-expanded={openUploadMenu}
                  onClick={() => setOpenUploadMenu((open) => !open)}
                >
                  <Plus className="h-3 w-3" />
                  补号
                </Button>
                {openUploadMenu ? (
                  <div className="absolute left-0 top-8 z-[60] min-w-32 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        setOpenUploadMenu(false);
                        jsonInputRef.current?.click();
                      }}
                    >
                      <FileKey2 className="h-3 w-3" />
                      JSON 文件
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        setOpenUploadMenu(false);
                        setJsonContentDialog({
                          text: "",
                          submitting: false,
                          error: null,
                        });
                      }}
                    >
                      <FileKey2 className="h-3 w-3" />
                      JSON 内容
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/50 pt-1.5 text-xs text-muted-foreground">
              <HeaderAverageMeter label="5h" value={average5hRemaining} />
              <HeaderAverageMeter label="周" value={averageWeekRemaining} />
              <span className="text-emerald-700">{availableCount} 可用</span>
              {limitedCount > 0 ? (
                <span className="text-amber-700">{limitedCount} 限额</span>
              ) : null}
              {exceptionCount > 0 ? (
                <span className="text-rose-700">{exceptionCount} 异常</span>
              ) : null}
              {pendingCount > 0 ? <span>{pendingCount} 待刷新</span> : null}
            </div>
          </div>

          <CandidatePoolTable
            rows={tableRows}
            nowMs={nowMs}
            selectedIds={selectedIdSet}
            allSelected={allVisibleSelected}
            onToggleSelected={toggleCandidateSelected}
            onToggleAll={toggleAllCandidates}
          />

          {refreshing ? (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                正在刷新配额
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <Dialog
        open={jsonContentDialog !== null}
        onOpenChange={(open) => {
          if (!open && !jsonContentDialog?.submitting) {
            setJsonContentDialog(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>JSON 内容</DialogTitle>
            <DialogDescription>
              支持单个 JSON、JSON 数组，或一行一个 JSON 的 JSONL。内容会导入到
              Nexus 候补号池。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="candidate-json-content">JSON 内容</Label>
            <Textarea
              id="candidate-json-content"
              value={jsonContentDialog?.text ?? ""}
              disabled={jsonContentDialog?.submitting}
              placeholder='{"type":"codex","email":"name@example.com","refresh_token":"rt_xxx"}'
              className={cn(
                "max-h-[45vh] min-h-56 resize-y overflow-auto font-mono text-xs",
                jsonContentDialog?.error &&
                  "border-rose-300 focus-visible:border-rose-400 focus-visible:ring-rose-200",
              )}
              onChange={(event) =>
                setJsonContentDialog((current) =>
                  current
                    ? { ...current, text: event.target.value, error: null }
                    : current,
                )
              }
            />
            <div className="text-xs text-muted-foreground">
              JSONL 示例：每一行是一条 CPA JSON 或 sub2api JSON。
            </div>
            {jsonContentDialog?.error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {jsonContentDialog.error}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={jsonContentDialog?.submitting}
              onClick={() => setJsonContentDialog(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={
                !jsonContentDialog ||
                jsonContentDialog.submitting ||
                !jsonContentDialog.text.trim()
              }
              onClick={() => void submitJsonContent()}
            >
              {jsonContentDialog?.submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moveDialog !== null}
        onOpenChange={(open) => {
          if (!open && !moveDialog?.submitting) {
            setMoveDialog(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动到CPA</DialogTitle>
            <DialogDescription>
              将已选择的 {moveDialog?.authFileIds.length ?? 0} 个候补账号上传到目标 CPA，成功后从候补号池删除。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="candidate-move-target">目标 CPA</Label>
            <select
              id="candidate-move-target"
              value={moveDialog?.targetCpaInstanceId ?? ""}
              disabled={moveDialog?.submitting || instances.length === 0}
              onChange={(event) =>
                setMoveDialog((current) =>
                  current
                    ? { ...current, targetCpaInstanceId: event.target.value }
                    : current,
                )
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>
            {instances.length === 0 ? (
              <div className="text-sm text-muted-foreground">没有已启用 CPA 可移动。</div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={moveDialog?.submitting}
              onClick={() => setMoveDialog(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={
                !moveDialog ||
                moveDialog.submitting ||
                !moveDialog.targetCpaInstanceId ||
                instances.length === 0
              }
              onClick={() => void submitMoveDialog()}
            >
              {moveDialog?.submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CandidatePoolTable({
  rows,
  nowMs,
  selectedIds,
  allSelected,
  onToggleSelected,
  onToggleAll,
}: {
  rows: CandidateAuthFileQuotaRow[];
  nowMs: number;
  selectedIds: Set<number>;
  allSelected: boolean;
  onToggleSelected: (id: number, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="max-h-[calc(100vh-220px)] min-w-[920px] max-w-none overflow-y-auto">
        <table className="w-full min-w-[920px] table-fixed caption-bottom text-sm">
          <colgroup>
            <col style={{ width: 36 }} />
            <col />
            <col style={{ width: 116 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 88 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 96 }} />
          </colgroup>
          <TableHeader>
            <TableRow className="h-8">
              <TableHead className="sticky top-0 z-10 w-9 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                <Checkbox
                  checked={allSelected}
                  disabled={rows.length === 0}
                  aria-label="选择全部候补账号"
                  onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
                />
              </TableHead>
              <TableHead className="sticky top-0 z-10 bg-card px-3 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                账号
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-[116px] bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                Refresh Token
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-24 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                <CompactPercentHeader windowLabel="5h" />
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-24 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                <CompactPercentHeader windowLabel="周" />
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-[72px] bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                状态
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-20 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                刷新
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-[88px] bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                add_at
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-24 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                last_refresh
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-24 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                expired
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  暂无候补账号
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className="h-9">
                  <TableCell className="w-9 px-2 py-1">
                    <Checkbox
                      checked={selectedIds.has(row.id)}
                      aria-label={`选择 ${row.email ?? row.fileName}`}
                      onCheckedChange={(checked) =>
                        onToggleSelected(row.id, Boolean(checked))
                      }
                    />
                  </TableCell>
                  <TableCell className="px-3 py-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          row.quotaStatus === "pending"
                            ? "bg-muted-foreground/50"
                            : row.quotaStatus === "available"
                              ? "bg-emerald-500"
                              : row.quotaStatus === "limited"
                                ? "bg-amber-500"
                                : "bg-rose-500",
                        )}
                      />
                      <SubscriptionBadge value={row.subscriptionType} />
                      <HoverCopyTooltip
                        className="min-w-0 flex-1"
                        items={candidateTooltipItems(row)}
                      >
                        <span className="block truncate text-xs font-medium">
                          {row.email ?? "-"}
                        </span>
                      </HoverCopyTooltip>
                    </div>
                  </TableCell>
                  <TableCell className="w-[116px] px-2 py-1">
                    <HoverCopyTooltip
                      className="block max-w-[6.5rem]"
                      items={candidateRefreshTokenTooltipItems(row)}
                    >
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {row.refreshToken ? maskRefreshToken(row.refreshToken) : "-"}
                      </span>
                    </HoverCopyTooltip>
                  </TableCell>
                  <TableCell className="w-24 px-2 py-1">
                    <CompactPercentBar
                      value={row.usage5hPercent}
                      resetAt={row.usage5hResetAt}
                      nowMs={nowMs}
                    />
                  </TableCell>
                  <TableCell className="w-24 px-2 py-1">
                    <CompactPercentBar
                      value={row.usageWeekPercent}
                      resetAt={row.usageWeekResetAt}
                      nowMs={nowMs}
                    />
                  </TableCell>
                  <TableCell className="w-[72px] px-2 py-1">
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
                  <TableCell className="w-20 whitespace-nowrap px-2 py-1 text-xs text-muted-foreground">
                    <span title={formatDate(row.refreshedAt)}>
                      {formatRelativeTime(row.refreshedAt, nowMs)}
                    </span>
                  </TableCell>
                  <CandidateTimeCell value={row.createdAt} />
                  <CandidateTimeCell value={row.lastRefresh} />
                  <CandidateTimeCell value={row.expired} />
                </TableRow>
              ))
            )}
          </TableBody>
        </table>
      </div>
    </div>
  );
}

function buildCandidatePoolRows(rows: CandidateAuthFile[]) {
  const mapped = rows.map((row): CandidateAuthFileQuotaRow => {
    const pending = !row.lastQuotaRefreshedAt;
    const parsedAuthMetadata = candidateAuthJsonMetadata(row.rawJson);
    const authMetadata = {
      lastRefresh: row.lastRefresh ?? parsedAuthMetadata.lastRefresh,
      expired: row.expired ?? parsedAuthMetadata.expired,
      refreshToken: row.refreshToken ?? parsedAuthMetadata.refreshToken,
    };
    const quotaStatus = pending
      ? null
      : row.quotaStatus
        ? {
            state: row.quotaStatus,
            label: row.quotaStatusLabel ?? row.status ?? "可用",
          }
        : resolveAccountQuotaStatus({
            disabled: false,
            available: row.available,
            exception: candidateQuotaException(row.statusMessage),
            rawJson: row.quotaRawJson,
          });

    return {
      id: row.id,
      fileName: row.fileName,
      email: row.email,
      available: row.available,
      quotaStatus: pending ? "pending" : (quotaStatus?.state ?? "available"),
      quotaStatusLabel: pending
        ? "待刷新"
        : (quotaStatus?.label ?? row.status ?? "可用"),
      subscriptionType: row.subscriptionType,
      usage5hPercent: row.usage5hPercent,
      usageWeekPercent: row.usageWeekPercent,
      usage5hResetAt: row.usage5hResetAt,
      usageWeekResetAt: row.usageWeekResetAt,
      exception: candidateQuotaException(row.statusMessage),
      refreshedAt: row.lastQuotaRefreshedAt,
      createdAt: row.createdAt,
      lastRefresh: authMetadata.lastRefresh,
      expired: authMetadata.expired,
      refreshToken: authMetadata.refreshToken,
    };
  });

  return sortAccountRows(
    mapped.map((row) => ({
      ...row,
      quotaStatus: row.quotaStatus === "pending" ? undefined : row.quotaStatus,
    })),
  ).map((row) => ({
    ...row,
    quotaStatus:
      mapped.find((item) => item.id === row.id)?.quotaStatus ?? "pending",
  }));
}

function candidateQuotaException(statusMessage: string | null) {
  if (
    statusMessage === "Refresh Token 已轮换" ||
    statusMessage === "Refresh Token 未轮换"
  ) {
    return null;
  }
  return statusMessage;
}

function CandidateTimeCell({ value }: { value: string | null }) {
  return (
    <TableCell className="w-24 whitespace-nowrap px-2 py-1 text-xs text-muted-foreground">
      <span title={formatCandidateTimestamp(value)}>
        {formatDate(value)}
      </span>
    </TableCell>
  );
}

function candidateAuthJsonMetadata(rawJson: string | null) {
  if (!rawJson) {
    return { lastRefresh: null, expired: null, refreshToken: null };
  }

  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!isJsonObject(parsed)) {
      return { lastRefresh: null, expired: null, refreshToken: null };
    }

    return {
      lastRefresh:
        jsonContentString(parsed.last_refresh) ??
        jsonContentString(parsed.lastRefresh) ??
        null,
      expired:
        jsonContentString(parsed.expired) ??
        jsonContentString(parsed.expires_at) ??
        jsonContentString(parsed.expiresAt) ??
        null,
      refreshToken:
        jsonContentString(parsed.refresh_token) ??
        jsonContentString(parsed.refreshToken) ??
        null,
    };
  } catch {
    return { lastRefresh: null, expired: null, refreshToken: null };
  }
}

function candidateTooltipItems(row: CandidateAuthFileQuotaRow) {
  return compactTooltipItems([
    { label: "邮箱", value: row.email ?? "" },
    { label: "文件名", value: row.fileName },
    { label: "添加时间", value: formatDate(row.createdAt) },
  ]);
}

function candidateRefreshTokenTooltipItems(row: CandidateAuthFileQuotaRow) {
  return compactTooltipItems([
    { label: "RT", value: row.refreshToken ?? "" },
  ]);
}

function parseCandidateJsonContent(text: string): CpaJsonUploadFile[] {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("请先粘贴 JSON 内容");
  }

  const payloads = parseCandidateJsonPayloads(trimmed);
  if (payloads.length === 0) {
    throw new Error("没有可导入的 JSON 内容");
  }

  return payloads.map((payload, index) => ({
    fileName: candidateJsonContentFileName(payload, index + 1),
    payload,
  }));
}

function parseCandidateJsonPayloads(text: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item, index) => {
      if (!isJsonObject(item)) {
        throw new Error(`第 ${index + 1} 条必须是 JSON 对象`);
      }
      return item;
    });
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  return parseCandidateJsonStream(text);
}

function parseCandidateJsonStream(text: string): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  let startIndex: number | null = null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (startIndex === null) {
      if (/\s/.test(char)) {
        continue;
      }
      if (char !== "{" && char !== "[") {
        throw new Error(`第 ${lineNumberAt(text, index)} 行不是合法 JSON`);
      }
      startIndex = index;
      depth = 1;
      inString = false;
      escaped = false;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char !== "}" && char !== "]") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      const segment = text.slice(startIndex, index + 1);
      payloads.push(parseCandidateJsonSegment(segment, text, startIndex));
      startIndex = null;
    }
  }

  if (startIndex !== null) {
    throw new Error(`第 ${lineNumberAt(text, startIndex)} 行开始的 JSON 没有结束`);
  }

  return payloads;
}

function parseCandidateJsonSegment(
  segment: string,
  source: string,
  startIndex: number,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(segment) as unknown;
  } catch {
    throw new Error(`第 ${lineNumberAt(source, startIndex)} 行开始的 JSON 不合法`);
  }

  if (!isJsonObject(parsed)) {
    throw new Error(`第 ${lineNumberAt(source, startIndex)} 行开始的 JSON 必须是对象`);
  }

  return parsed;
}

function lineNumberAt(text: string, index: number) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function candidateJsonContentFileName(
  payload: Record<string, unknown>,
  index: number,
) {
  const email = candidateJsonContentEmail(payload);
  return email
    ? buildAutoAuthFileName(email)
    : `json-content-${String(index).padStart(3, "0")}.json`;
}

function candidateJsonContentEmail(payload: Record<string, unknown>) {
  return (
    jsonContentString(payload.email) ??
    jsonContentString(payload.account_email) ??
    jsonContentString(payload.username) ??
    candidateNestedEmail(payload.credentials) ??
    candidateNestedEmail(payload.user) ??
    candidateNestedEmail(payload.account) ??
    jsonContentString(payload.name)?.match(rtLoginEmailRegex)?.[0] ??
    null
  );
}

function candidateNestedEmail(value: unknown) {
  return isJsonObject(value)
    ? (jsonContentString(value.email) ?? jsonContentString(value.account_email))
    : null;
}

function jsonContentString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ExceptionAuthFilesSection({
  rows,
  instances,
  onExport,
  onClear,
  onDelete,
  onMove,
}: {
  rows: ExceptionAuthFile[];
  instances: CpaInstance[];
  onExport: () => void;
  onClear: () => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onMove: (id: number, targetCpaInstanceId: number) => Promise<void>;
}) {
  const [deleteTarget, setDeleteTarget] = useState<ExceptionAuthFile | null>(
    null,
  );
  const [clearOpen, setClearOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<ExceptionAuthFile | null>(null);
  const [moveTargetInstanceId, setMoveTargetInstanceId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function openMoveDialog(row: ExceptionAuthFile) {
    const firstTarget = instances[0];
    setMoveTarget(row);
    setMoveTargetInstanceId(firstTarget ? String(firstTarget.id) : "");
  }

  async function submitMove() {
    if (!moveTarget || !moveTargetInstanceId) {
      return;
    }
    setSubmitting(true);
    try {
      await onMove(moveTarget.id, Number(moveTargetInstanceId));
      setMoveTarget(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">异常账号池</h2>
            <p className="text-sm text-muted-foreground">
              共 {rows.length} 个异常账号
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rows.length === 0}
              onClick={onExport}
            >
              <Download className="h-4 w-4" />
              导出
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={rows.length === 0}
              onClick={() => setClearOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              删除全部
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邮箱</TableHead>
                <TableHead>文件名</TableHead>
                <TableHead>添加时间</TableHead>
                <TableHead>上次报错信息</TableHead>
                <TableHead>来源 CPA</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    暂无异常账号
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[16rem] truncate font-medium">
                      {row.email ?? "-"}
                    </TableCell>
                    <TableCell className="max-w-[18rem] truncate">
                      {row.fileName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(row.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-[20rem] truncate">
                      {row.lastError ?? "-"}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate">
                      {row.sourceCpaInstanceName}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={instances.length === 0}
                          onClick={() => openMoveDialog(row)}
                        >
                          移动
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                          onClick={() => setDeleteTarget(row)}
                        >
                          删除
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除全部异常账号</DialogTitle>
            <DialogDescription>
              确定要清空异常账号池中的 {rows.length} 条记录吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setClearOpen(false);
                void onClear();
              }}
            >
              删除全部
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除异常账号</DialogTitle>
            <DialogDescription>
              确定要删除{" "}
              {deleteTarget?.email ?? deleteTarget?.fileName ?? "这条记录"}{" "}
              吗？这个操作只删除异常账号池记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                if (target) {
                  void onDelete(target.id);
                }
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={moveTarget !== null}
        onOpenChange={(open) => !open && setMoveTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动异常账号</DialogTitle>
            <DialogDescription>
              选择目标 CPA。确认后会上传认证文件到目标 CPA，并从异常账号池移除。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="exception-auth-target-cpa">目标 CPA</Label>
            <select
              id="exception-auth-target-cpa"
              className={cn(compactControlClassName, "w-full")}
              value={moveTargetInstanceId}
              onChange={(event) => setMoveTargetInstanceId(event.target.value)}
            >
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMoveTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={!moveTargetInstanceId || submitting}
              onClick={() => void submitMove()}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              移动
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
  accountTag: string | null;
  proxyUrl: string | null;
  proxyName: string | null;
  disabled: boolean;
  available: boolean;
  quotaStatus: AccountQuotaState;
  quotaStatusLabel: string;
  subscriptionType: string | null;
  usage5hPercent: number | null;
  usageWeekPercent: number | null;
  usage5hResetAt: string | null;
  usageWeekResetAt: string | null;
  usage5hStale: boolean;
  usageWeekStale: boolean;
  exception: string | null;
  createdAt: string;
  refreshedAt: string;
};

function CompactAuthFileTable({
  rows,
  nowMs,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  weights5h,
  weightsWeek,
}: {
  rows: AuthFileQuotaRow[];
  nowMs: number;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  onToggleSelectAll?: () => void;
  weights5h?: SubscriptionWeightMap;
  weightsWeek?: SubscriptionWeightMap;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="max-h-[35.75rem] min-w-[704px] max-w-none overflow-y-auto">
        <table className="w-full min-w-[704px] table-fixed caption-bottom text-sm">
          <colgroup>
            <col />
            <col style={{ width: 96 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <TableHeader>
            <TableRow className="h-8">
              <TableHead className="sticky top-0 z-10 bg-card px-3 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={
                      selectedIds && rows.length > 0
                        ? rows.every((r) => selectedIds.has(r.id))
                        : false
                    }
                    onCheckedChange={() =>
                      onToggleSelectAll?.()
                    }
                  />
                  账号
                </div>
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-24 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                <CompactPercentHeader windowLabel="5h" />
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-24 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                <CompactPercentHeader windowLabel="周" />
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-16 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                代理
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-16 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                状态
              </TableHead>
              <TableHead className="sticky top-0 z-10 w-20 bg-card px-2 py-1 text-xs shadow-[0_1px_0_var(--border)]">
                刷新
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-16 text-center text-sm text-muted-foreground"
                >
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    "h-9",
                    row.disabled && "bg-muted/30 text-muted-foreground",
                  )}
                >
                  <TableCell className="px-3 py-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        checked={selectedIds?.has(row.id) ?? false}
                        onCheckedChange={() => onToggleSelect?.(row.id)}
                      />
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
                      {row.accountTag ? (
                        <SubscriptionBadge
                          value={row.accountTag}
                          formatValue={false}
                          className="max-w-20 truncate normal-case"
                          title={row.accountTag}
                        />
                      ) : null}
                      <span className="flex min-w-0 flex-1 items-center gap-0.5">
                        <span className="truncate text-xs font-medium">
                          {row.email ?? "-"}
                        </span>
                        <HoverCopyTooltip
                          className="shrink-0 cursor-help leading-none"
                          items={accountTooltipItems(row)}
                        >
                          <Info className="h-3 w-3 text-muted-foreground/60" />
                        </HoverCopyTooltip>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="w-24 px-2 py-1">
                    <CompactPercentBar
                      value={row.usage5hPercent}
                      resetAt={row.usage5hResetAt}
                      nowMs={nowMs}
                      stale={row.usage5hStale}
                      quotaDollars={accountQuotaDollars(
                        row.subscriptionType,
                        weights5h,
                      )}
                    />
                  </TableCell>
                  <TableCell className="w-24 px-2 py-1">
                    <CompactPercentBar
                      value={row.usageWeekPercent}
                      resetAt={row.usageWeekResetAt}
                      nowMs={nowMs}
                      stale={row.usageWeekStale}
                      quotaDollars={accountQuotaDollars(
                        row.subscriptionType,
                        weightsWeek,
                      )}
                    />
                  </TableCell>
                  <TableCell className="w-16 px-2 py-1">
                    <HoverCopyTooltip
                      className="block max-w-12"
                      items={proxyTooltipItems(row)}
                    >
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.proxyName ?? row.proxyUrl ?? "-"}
                      </span>
                    </HoverCopyTooltip>
                  </TableCell>
                  <TableCell className="w-16 px-2 py-1">
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
                  <TableCell className="w-20 whitespace-nowrap px-2 py-1 text-xs text-muted-foreground">
                    <span title={formatDate(row.refreshedAt)}>
                      {formatRelativeTime(row.refreshedAt, nowMs)}
                    </span>
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

function HoverTooltip({
  lines,
  className,
  children,
}: {
  lines: Array<string | null | undefined>;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const visibleLines = lines.filter(
    (line): line is string => typeof line === "string" && line.trim().length > 0,
  );
  const hasContent = visibleLines.length > 0;

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openTooltip() {
    if (!hasContent) {
      return;
    }
    clearCloseTimer();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const maxLeft = Math.max(8, window.innerWidth - 240);
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

  useEffect(() => {
    return () => clearCloseTimer();
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        tabIndex={hasContent ? 0 : -1}
        className={cn("inline-flex", hasContent && "cursor-default", className)}
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleClose}
        onFocus={openTooltip}
        onBlur={scheduleClose}
      >
        {children}
      </span>
      {open && hasContent && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed z-[100] max-w-xs rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-lg"
              style={{
                left: position.left,
                top: position.top,
                transform: "translateY(-100%)",
              }}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
            >
              {visibleLines.map((line, index) => (
                <div key={index} className="whitespace-nowrap leading-5 tabular-nums">
                  {line}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
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
        className={cn(
          "inline-block min-w-0",
          hasValue && "cursor-default",
          className,
        )}
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
              style={{
                left: position.left,
                top: position.top,
                transform: "translateY(-100%)",
              }}
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
    { label: "添加时间", value: formatDate(row.createdAt) },
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

const rtLoginEmailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const rtLoginRefreshTokenRegex = /\brt_[A-Za-z0-9._-]+/;

function parseRtLoginInput(text: string) {
  const valid: Array<{
    lineNumber: number;
    sourceLine: string;
    email: string | null;
    refreshToken: string;
  }> = [];
  const invalid: Array<{ lineNumber: number; sourceLine: string }> = [];

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line, index) => {
      if (!line) {
        return;
      }

      const segments = line.split("----").map((segment) => segment.trim());
      const refreshToken =
        segments
          .find((segment) => rtLoginRefreshTokenRegex.test(segment))
          ?.match(rtLoginRefreshTokenRegex)?.[0] ??
        (segments.length >= 4 ? segments.at(-1) : line.includes("----") ? "" : line) ??
        "";
      if (!refreshToken) {
        invalid.push({ lineNumber: index + 1, sourceLine: line });
        return;
      }

      valid.push({
        lineNumber: index + 1,
        sourceLine: line,
        email: line.match(rtLoginEmailRegex)?.[0] ?? null,
        refreshToken,
      });
    });

  return { valid, invalid };
}

function rtLoginProxyLabel(proxy: ProxyRow) {
  return proxy.name.trim() || proxy.url;
}

function rtLoginStatusLabel(status: RtLoginRowStatus) {
  const labels: Record<RtLoginRowStatus, string> = {
    waiting: "等待中",
    "logging-in": "正在登录中",
    success: "登录成功",
    failed: "登录失败",
  };
  return labels[status];
}

function rtLoginStatusClass(status: RtLoginRowStatus) {
  const classes: Record<RtLoginRowStatus, string> = {
    waiting: "text-muted-foreground",
    "logging-in": "text-sky-700",
    success: "text-emerald-700",
    failed: "text-rose-700",
  };
  return classes[status];
}

function rtLoginConfirmLabel(state: RtLoginDialogState | null) {
  if (!state) {
    return "确认";
  }
  if (state.stage === "processing") {
    return "正在登录";
  }
  if (state.stage === "uploading") {
    return "正在添加";
  }
  if (state.stage === "review") {
    const count = state.rows.filter((row) => row.status === "success").length;
    return `确认添加 ${count} 个`;
  }
  return "确认并开始登录";
}

function maskRefreshToken(value: string) {
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function CompactPercentHeader({ windowLabel }: { windowLabel: string }) {
  return (
    <div className="flex w-[4.5rem] items-center gap-1">
      <span>{windowLabel}</span>
      <span>剩余</span>
    </div>
  );
}

function HeaderAverageMeter({
  label,
  value,
  dollars,
}: {
  label: string;
  value: number | null;
  dollars?: { remaining: number; total: number } | null;
}) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value));
  const tone = quotaRemainingTone(value);
  const dollarLine = dollars
    ? `剩余 ${formatDollars(dollars.remaining)} / ${formatDollars(dollars.total)}`
    : null;

  return (
    <HoverTooltip
      lines={[dollarLine]}
      className={cn(
        "items-center gap-1.5 whitespace-nowrap font-medium",
        tone.text,
      )}
    >
      <span>{label}</span>
      <span className="w-8 text-right tabular-nums">
        {formatPercent(value)}
      </span>
      <span className="h-1.5 w-12 overflow-hidden rounded bg-background ring-1 ring-border/60">
        <span
          className={cn("block h-full rounded", tone.bar)}
          style={{ width: `${width}%` }}
        />
      </span>
      {dollars ? (
        <span className="tabular-nums text-muted-foreground">
          {formatDollars(dollars.remaining)}
        </span>
      ) : null}
    </HoverTooltip>
  );
}

function mergeAuthFilesWithQuotas(
  authFileRows: AuthFile[],
  quotas: QuotaSnapshot[],
  proxyNameByUrl: Map<string, string>,
): AuthFileQuotaRow[] {
  const quotaByFileName = new Map<string, QuotaSnapshot>();
  const quotaByEmail = new Map<string, QuotaSnapshot>();
  const quotaEmailCounts = new Map<string, number>();

  for (const quota of quotas) {
    if (quota.authFileName) {
      quotaByFileName.set(quota.authFileName, quota);
    }
    if (quota.email) {
      const key = quota.email.toLowerCase();
      quotaByEmail.set(key, quota);
      quotaEmailCounts.set(key, (quotaEmailCounts.get(key) ?? 0) + 1);
    }
  }

  const rows = authFileRows.map((file) => {
    const proxyUrl = file.proxyUrl ?? proxyUrlFromRawAuthJson(file.rawJson);
    const emailKey = file.email?.toLowerCase() ?? null;
    const quota =
      quotaByFileName.get(file.fileName) ??
      (emailKey && quotaEmailCounts.get(emailKey) === 1
        ? quotaByEmail.get(emailKey)
        : undefined) ??
      null;
    const disabled = Boolean(file.disabled);
    const available = disabled ? false : (quota?.available ?? file.available);
    const exception = disabled
      ? null
      : quota
        ? quota.exception
        : (file.statusMessage ?? (available ? null : (file.status ?? "异常")));
    const quotaStatus = disabled
      ? resolveAccountQuotaStatus({
          disabled,
          available,
          exception,
          rawJson: null,
        })
      : quota?.quotaStatus
        ? {
            state: quota.quotaStatus,
            label: quota.quotaStatusLabel ?? quota.quotaStatus,
          }
        : resolveAccountQuotaStatus({
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
      accountTag: file.accountTag,
      proxyUrl,
      proxyName: proxyUrl ? (proxyNameByUrl.get(proxyUrl) ?? null) : null,
      disabled,
      available,
      quotaStatus: quotaStatus.state,
      quotaStatusLabel: quotaStatus.label,
      subscriptionType:
        quota?.subscriptionType ?? extractSubscriptionType(file.rawJson),
      usage5hPercent: quota?.usage5hPercent ?? null,
      usageWeekPercent: quota?.usageWeekPercent ?? null,
      usage5hResetAt: quota?.usage5hResetAt ?? null,
      usageWeekResetAt: quota?.usageWeekResetAt ?? null,
      usage5hStale: quota?.usage5hStale ?? false,
      usageWeekStale: quota?.usageWeekStale ?? false,
      exception,
      createdAt: file.createdAt,
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
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
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

function CompactPercentBar({
  value,
  resetAt,
  nowMs,
  stale = false,
  quotaDollars = null,
}: {
  value: number | null;
  resetAt: string | null;
  nowMs: number;
  stale?: boolean;
  quotaDollars?: number | null;
}) {
  const remaining =
    value === null ? null : Math.max(0, Math.min(100, 100 - value));
  const width = remaining ?? 0;
  const tone = quotaRemainingTone(remaining);
  const resetLabel = formatQuotaResetCountdown(resetAt, nowMs);
  const isStale = stale && remaining !== null;

  const dollarLine =
    quotaDollars != null && remaining != null
      ? `剩余 ${formatDollars((quotaDollars * remaining) / 100)} / ${formatDollars(quotaDollars)}`
      : null;
  const staleLine = isStale ? "刷新失败，显示上次数据" : null;
  const resetLine = quotaResetTitle(resetAt);

  return (
    <HoverTooltip
      lines={[dollarLine, staleLine, resetLine]}
      className={cn(
        "h-7 w-[4.5rem] max-w-[4.5rem] flex-col justify-center gap-0.5 align-middle",
        isStale && "opacity-60",
      )}
    >
      <span className="block h-1.5 rounded bg-muted">
        <span
          className={cn("block h-1.5 rounded", tone.bar)}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="flex items-center justify-between gap-2 leading-none">
        <span className={cn("text-[11px] tabular-nums", tone.text)}>
          {remaining === null ? "-" : `${isStale ? "~" : ""}${remaining}%`}
        </span>
        <span className="text-right text-[10px] text-muted-foreground tabular-nums">
          {resetLabel ?? "-"}
        </span>
      </span>
    </HoverTooltip>
  );
}

function quotaRemainingTone(remaining: number | null) {
  if (remaining === null) {
    return {
      bar: "bg-muted-foreground/35",
      text: "text-muted-foreground",
    };
  }

  if (remaining < 20) {
    return {
      bar: "bg-rose-500",
      text: "text-rose-700",
    };
  }

  if (remaining < 50) {
    return {
      bar: "bg-amber-500",
      text: "text-amber-700",
    };
  }

  if (remaining < 80) {
    return {
      bar: "bg-sky-500",
      text: "text-sky-700",
    };
  }

  return {
    bar: "bg-emerald-500",
    text: "text-emerald-700",
  };
}

function SubscriptionBadge({
  value,
  formatValue = true,
  className,
  title,
}: {
  value: string | null;
  formatValue?: boolean;
  className?: string;
  title?: string;
}) {
  if (!value) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <Badge
      variant="outline"
      title={title ?? value}
      className={cn(
        "h-4 px-1.5 py-0 text-[10px] leading-none",
        formatValue && "uppercase",
        subscriptionBadgeClass(value),
        className,
      )}
    >
      {formatValue ? formatSubscriptionType(value) : value}
    </Badge>
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
    <section className="space-y-3">
      <div className="flex flex-col gap-2.5 rounded-md border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">代理列表</div>
          <div className="text-sm text-muted-foreground">
            配置代理名称、URL、允许使用账号数和允许应用的 CPA 实例。
          </div>
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
            <DialogTitle>
              {props.editingId ? "编辑代理" : "添加代理"}
            </DialogTitle>
            <DialogDescription>
              设置代理名称、地址、允许被多少账号使用，以及这个代理可用于哪些 CPA
              实例。
            </DialogDescription>
          </DialogHeader>

          <form id={formId} onSubmit={props.onSubmit} className="grid gap-4">
            <Field label="代理名称">
              <Input
                value={props.form.name}
                onChange={(event) =>
                  props.setForm({ ...props.form, name: event.target.value })
                }
                placeholder="美国出口 01"
                required
              />
            </Field>
            <Field label="代理URL">
              <Input
                value={props.form.url}
                onChange={(event) =>
                  props.setForm({ ...props.form, url: event.target.value })
                }
                placeholder="http://user:pass@host:port"
                required
              />
            </Field>
            <NumberField
              label="允许被多少账号使用"
              value={props.form.maxAuthFiles}
              onChange={(maxAuthFiles) =>
                props.setForm({ ...props.form, maxAuthFiles })
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={props.form.enabled}
                onCheckedChange={(enabled) =>
                  props.setForm({ ...props.form, enabled })
                }
              />
              启用
            </label>
            <div className="space-y-2">
              <Label>应用CPA</Label>
              <div className="flex max-h-44 flex-wrap gap-3 overflow-auto rounded-md border bg-muted/25 p-3">
                {props.instances.map((instance) => (
                  <label
                    key={instance.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={props.form.cpaInstanceIds.includes(instance.id)}
                      onCheckedChange={(checked) => {
                        const ids = checked
                          ? [...props.form.cpaInstanceIds, instance.id]
                          : props.form.cpaInstanceIds.filter(
                              (id) => id !== instance.id,
                            );
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
            <Button
              type="button"
              variant="outline"
              onClick={() => props.setOpen(false)}
            >
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
        headers={[
          "名称",
          "代理URL",
          "允许账号数",
          "启用",
          "检测",
          "应用CPA",
          "操作",
        ]}
        rows={props.proxies.map((proxy) => [
          <span key="name" className="font-medium">
            {proxy.name}
          </span>,
          <code key="url" className="text-xs">
            {proxy.url}
          </code>,
          proxy.maxAuthFiles,
          <Switch
            key="enabled"
            checked={proxy.enabled}
            aria-label={`${proxy.name} 启用状态`}
            onCheckedChange={(enabled) =>
              void props.onToggleEnabled(proxy, enabled)
            }
          />,
          <ProxyCheckBadge
            key="check"
            result={props.checks[proxy.id]}
            checking={props.checking}
          />,
          <AppliedCpaTags
            key="cpa-instances"
            instances={props.instances.filter((instance) =>
              proxy.cpaInstanceIds.includes(instance.id),
            )}
          />,
          <div key="actions" className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                props.setEditingId(proxy.id);
                props.setForm({
                  name: proxy.name,
                  url: proxy.url,
                  maxAuthFiles: proxy.maxAuthFiles,
                  enabled: proxy.enabled,
                  notes: proxy.notes ?? "",
                  cpaInstanceIds: proxy.cpaInstanceIds,
                });
                props.setOpen(true);
              }}
            >
              编辑
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void props.onDelete(proxy.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>,
        ])}
      />
    </section>
  );
}

function JobsSection({
  jobs,
  runs,
  runsPagination,
  onRunsPageChange,
  onRun,
  onSave,
}: {
  jobs: CronJob[];
  runs: JobRun[];
  runsPagination: JobRunsPagination;
  onRunsPageChange: (page: number) => Promise<void>;
  onRun: (key: string) => Promise<void>;
  onSave: (job: CronJob) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, CronJobDraft>>({});
  const canGoPrevious = runsPagination.page > 1;
  const canGoNext = runsPagination.page < runsPagination.totalPages;

  function updateDraft(
    job: CronJob,
    updater: (draft: CronJobDraft) => CronJobDraft,
  ) {
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
    <section className="space-y-3">
      <DataTable
        headers={[
          "任务",
          "执行频率",
          "状态",
          "下次执行",
          "最近执行",
          "错误",
          "操作",
        ]}
        rows={jobs.map((job) => {
          const draft = drafts[job.key] ?? createJobDraft(job);
          return [
            <div key="name" className="font-medium">
              {job.name}
            </div>,
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
              onCheckedChange={(enabled) =>
                updateDraft(job, (current) => ({ ...current, enabled }))
              }
            />,
            formatDate(job.nextRunAt),
            formatDate(job.lastRunAt),
            <span key="error" className="max-w-[280px] truncate text-rose-700">
              {job.lastError ?? "-"}
            </span>,
            <div key="actions" className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void saveDraft(job, draft)}
              >
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
        <CardHeader className="grid-cols-[1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">执行记录</CardTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              共 {runsPagination.total} 条，每页 {runsPagination.pageSize} 条
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canGoPrevious}
              onClick={() => void onRunsPageChange(runsPagination.page - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              上一页
            </Button>
            <span className="min-w-16 text-center tabular-nums">
              {runsPagination.page} / {runsPagination.totalPages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canGoNext}
              onClick={() => void onRunsPageChange(runsPagination.page + 1)}
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            headers={["任务", "状态", "信息", "开始", "结束"]}
            rows={runs.map((run) => [
              run.jobKey,
              <StatusBadge
                key="status"
                ok={run.status === "success"}
                label={run.status}
              />,
              <span key="message" className="max-w-[420px] truncate">
                {run.message ?? "-"}
              </span>,
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
          onChange={(event) =>
            onChange(
              defaultScheduleForMode(
                event.target.value as CronSimpleMode,
                schedule,
              ),
            )
          }
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
                onChange({
                  ...schedule,
                  everyMinutes: finiteInputNumber(
                    event.currentTarget.valueAsNumber,
                    schedule.everyMinutes,
                  ),
                })
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
                onChange({
                  ...schedule,
                  minute: finiteInputNumber(
                    event.currentTarget.valueAsNumber,
                    schedule.minute,
                  ),
                })
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
            onChange={(event) =>
              onChange({ ...schedule, time: event.target.value })
            }
          />
        ) : null}

        {schedule.mode === "weekly" ? (
          <>
            <select
              className={cn(compactControlClassName, "w-24")}
              value={schedule.dayOfWeek}
              onChange={(event) =>
                onChange({ ...schedule, dayOfWeek: Number(event.target.value) })
              }
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
              onChange={(event) =>
                onChange({ ...schedule, time: event.target.value })
              }
            />
          </>
        ) : null}

        {schedule.mode === "advanced" ? (
          <Input
            className="h-8 w-60 font-mono text-xs"
            value={schedule.cron}
            onChange={(event) =>
              onChange({ ...schedule, cron: event.target.value })
            }
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

function defaultScheduleForMode(
  mode: CronSimpleMode,
  current: CronSimpleSchedule,
): CronSimpleSchedule {
  switch (mode) {
    case "interval":
      return current.mode === "interval"
        ? current
        : { mode: "interval", everyMinutes: 10 };
    case "hourly":
      return current.mode === "hourly"
        ? current
        : { mode: "hourly", minute: 0 };
    case "daily":
      return current.mode === "daily"
        ? current
        : { mode: "daily", time: scheduleTimeOrDefault(current) };
    case "weekly":
      return current.mode === "weekly"
        ? current
        : {
            mode: "weekly",
            dayOfWeek: 1,
            time: scheduleTimeOrDefault(current),
          };
    case "advanced":
      return current.mode === "advanced"
        ? current
        : { mode: "advanced", cron: simpleScheduleToCron(current) };
    default:
      return { mode: "advanced", cron: simpleScheduleToCron(current) };
  }
}

function scheduleTimeOrDefault(schedule: CronSimpleSchedule) {
  return schedule.mode === "daily" || schedule.mode === "weekly"
    ? schedule.time
    : "00:00";
}

function finiteInputNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
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
        可用
        {typeof result.latencyMs === "number" ? ` ${result.latencyMs}ms` : ""}
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

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header} className="whitespace-nowrap">
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={headers.length}
                className="h-24 text-center text-muted-foreground"
              >
                暂无数据
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow key={index}>
                {row.map((cell, cellIndex) => (
                  <TableCell key={cellIndex} className="align-middle">
                    {cell}
                  </TableCell>
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
    <Badge
      className={cn(
        ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800",
        "hover:bg-current/10",
      )}
    >
      {label}
    </Badge>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        value={value}
        min={0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
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

async function mutate<T = { status: string }>(
  url: string,
  init: RequestInit,
): Promise<T> {
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

async function readFetchError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function fileNameFromContentDisposition(value: string | null) {
  if (!value) {
    return null;
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const quotedMatch = value.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  return null;
}

function formatDownloadTimestamp(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
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

function formatCandidateTimestamp(value: string | null) {
  if (!value) {
    return "-";
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("zh-CN") : value;
}

function cpaBusyPhaseLabel(phase: CpaBusyPhase | undefined) {
  if (phase === "auth_files") {
    return "拉账号...";
  }
  if (phase === "auth_payloads") {
    return "补JSON...";
  }
  if (phase === "quotas") {
    return "刷额度...";
  }

  return "更新...";
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

function formatQuotaResetCountdown(value: string | null, nowMs: number) {
  if (!value) {
    return null;
  }

  const resetAt = new Date(value).getTime();
  if (!Number.isFinite(resetAt)) {
    return null;
  }

  const seconds = Math.ceil((resetAt - nowMs) / 1000);
  if (seconds <= 0) {
    return "待刷新";
  }
  if (seconds < 60) {
    return "即将";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d${remainingHours}h` : `${days}d`;
}

function quotaResetTitle(value: string | null) {
  return value ? `预计 ${formatDate(value)} 刷新额度` : undefined;
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

function formatDollars(value: number) {
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `$${text}`;
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
    pro: "20X",
    pro20x: "20X",
    "pro-20x": "20X",
    pro_20x: "20X",
    prolite: "5X",
    "pro-lite": "5X",
    pro_lite: "5X",
    pro5x: "5X",
    "pro-5x": "5X",
    pro_5x: "5X",
    plus: "Plus",
    free: "Free",
  };

  return labels[normalized] ?? value;
}

function subscriptionBadgeClass(value: string) {
  const normalized = value.trim().toLowerCase();
  const classes: Record<string, string> = {
    enterprise: "border-emerald-300 bg-emerald-50 text-emerald-800",
    team: "border-cyan-300 bg-cyan-50 text-cyan-800",
    pro: "border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(217,119,6,0.22)]",
    pro20x:
      "border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(217,119,6,0.22)]",
    "pro-20x":
      "border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(217,119,6,0.22)]",
    pro_20x:
      "border-amber-300 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(217,119,6,0.22)]",
    prolite:
      "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    "pro-lite":
      "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    pro_lite:
      "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    pro5x:
      "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    "pro-5x":
      "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    pro_5x:
      "border-yellow-300 bg-gradient-to-b from-yellow-50 to-yellow-100 text-yellow-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(202,138,4,0.18)]",
    plus: "border-blue-300 bg-blue-50 text-blue-800",
    free: "border-slate-300 bg-slate-50 text-slate-700",
  };

  return classes[normalized] ?? "border-slate-300 bg-slate-50 text-slate-700";
}
