"use client";

import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRef } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

type MessagePushTriggerType = "account_exception" | "remaining_5h_below" | "remaining_week_below";
type MessagePushScopeType = "all_enabled" | "custom";
type MessagePushDeliveryType = "webhook" | "browser_notification";

type CpaOption = {
  id: number;
  name: string;
  enabled: boolean;
};

type MessagePushPolicy = {
  id: number;
  name: string;
  deliveryType: string;
  deliveryTypes: MessagePushDeliveryType[];
  triggerType: MessagePushTriggerType;
  thresholdPercent: number | null;
  scopeType: MessagePushScopeType;
  webhookUrl: string;
  headersJson: string;
  bodyTemplate: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  cpaInstanceIds: number[];
};

type MessagePushResponse = {
  policies: MessagePushPolicy[];
  instances: CpaOption[];
};

type MessagePushDelivery = {
  id: number;
  policyId: number;
  policyName: string | null;
  cpaInstanceId: number;
  cpaInstanceName: string | null;
  deliveryType: MessagePushDeliveryType;
  triggerKey: string;
  status: string;
  message: string;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  sentAt: string;
};

type MessagePushDeliveryPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type MessagePushDeliveryResponse = {
  deliveries: MessagePushDelivery[];
  pagination: MessagePushDeliveryPagination;
};

type MessagePushForm = {
  name: string;
  deliveryTypes: MessagePushDeliveryType[];
  triggerType: MessagePushTriggerType;
  thresholdPercent: number;
  scopeType: MessagePushScopeType;
  cpaInstanceIds: number[];
  webhookUrl: string;
  headersJson: string;
  bodyTemplate: string;
  enabled: boolean;
};

const emptyForm: MessagePushForm = {
  name: "",
  deliveryTypes: ["webhook"],
  triggerType: "account_exception",
  thresholdPercent: 20,
  scopeType: "all_enabled",
  cpaInstanceIds: [],
  webhookUrl: "",
  headersJson: '{"content-type":"application/json","Authorization":"Bearer "}',
  bodyTemplate: '{ "message": "{{msg}}" }',
  enabled: true,
};

const triggerLabels: Record<MessagePushTriggerType, string> = {
  account_exception: "有账号出现异常",
  remaining_5h_below: "5h剩余低于",
  remaining_week_below: "周剩余低于",
};

const triggerTemplateDefaults: Record<MessagePushTriggerType, string> = {
  account_exception: '{ "message": "{{msg}}" }',
  remaining_5h_below: '{ "message": "{{cpaName}} 5h剩余 {{value}}%，低于 {{threshold}}%" }',
  remaining_week_below: '{ "message": "{{cpaName}} 周剩余 {{value}}%，低于 {{threshold}}%" }',
};

const deliveryTypeLabels: Record<MessagePushDeliveryType, string> = {
  webhook: "Webhook",
  browser_notification: "浏览器通知",
};

const defaultDeliveryPagination: MessagePushDeliveryPagination = {
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1,
};
const deliveryPageSize = 20;

export function MessagePushSection() {
  const [policies, setPolicies] = useState<MessagePushPolicy[]>([]);
  const [instances, setInstances] = useState<CpaOption[]>([]);
  const [deliveries, setDeliveries] = useState<MessagePushDelivery[]>([]);
  const [deliveryPagination, setDeliveryPagination] =
    useState<MessagePushDeliveryPagination>(defaultDeliveryPagination);
  const [loading, setLoading] = useState(true);
  const [deliveriesLoading, setDeliveriesLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MessagePushForm>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<MessagePushPolicy | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testingPolicyIds, setTestingPolicyIds] = useState<Set<number>>(() => new Set());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  const latestSeenBrowserDeliveryIdRef = useRef<number | null>(null);
  const notificationToastShownRef = useRef(false);
  const instanceNameById = useMemo(
    () => new Map(instances.map((instance) => [instance.id, instance.name])),
    [instances],
  );

  const loadDeliveries = useCallback(async (page = 1) => {
    try {
      setDeliveriesLoading(true);
      const searchParams = new URLSearchParams({
        page: String(page),
        pageSize: String(deliveryPageSize),
      });
      const payload = await fetchJson<MessagePushDeliveryResponse>(
        `/api/message-push-deliveries?${searchParams.toString()}`,
      );
      setDeliveries(payload.deliveries);
      setDeliveryPagination(payload.pagination);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeliveriesLoading(false);
    }
  }, []);

  const handleBrowserDeliveries = useCallback((rows: MessagePushDelivery[]) => {
    const browserRows = rows
      .filter((delivery) => delivery.deliveryType === "browser_notification")
      .sort((a, b) => a.id - b.id);
    const latestId = Math.max(0, ...browserRows.map((delivery) => delivery.id));

    if (latestSeenBrowserDeliveryIdRef.current === null) {
      latestSeenBrowserDeliveryIdRef.current = latestId || null;
      return;
    }

    const newRows = browserRows.filter((delivery) =>
      delivery.id > (latestSeenBrowserDeliveryIdRef.current ?? 0),
    );
    if (latestId > (latestSeenBrowserDeliveryIdRef.current ?? 0)) {
      latestSeenBrowserDeliveryIdRef.current = latestId;
    }
    if (newRows.length === 0) {
      return;
    }

    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    if (Notification.permission !== "granted") {
      setNotificationPermission(Notification.permission);
      if (!notificationToastShownRef.current) {
        notificationToastShownRef.current = true;
        toast.info("有新的浏览器通知，请先允许浏览器通知权限");
      }
      return;
    }

    setNotificationPermission("granted");
    for (const delivery of newRows) {
      const notification = new Notification(delivery.policyName ?? "CPA Nexus", {
        body: delivery.message,
        tag: `cpa-nexus-message-push-${delivery.id}`,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  }, []);

  const pollBrowserDeliveries = useCallback(async () => {
    try {
      const payload = await fetchJson<MessagePushDeliveryResponse>(
        `/api/message-push-deliveries?page=1&pageSize=${deliveryPageSize}`,
      );
      handleBrowserDeliveries(payload.deliveries);
      if (deliveryPagination.page === 1) {
        setDeliveries(payload.deliveries);
        setDeliveryPagination(payload.pagination);
      }
    } catch {
      // Keep background polling quiet; visible refresh still surfaces errors.
    }
  }, [deliveryPagination.page, handleBrowserDeliveries]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPolicies();
      void loadDeliveries().then(() => {
        if ("Notification" in window) {
          setNotificationPermission(Notification.permission);
        } else {
          setNotificationPermission("unsupported");
        }
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadDeliveries]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void pollBrowserDeliveries();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [pollBrowserDeliveries]);

  async function loadPolicies() {
    try {
      setLoading(true);
      const payload = await fetchJson<MessagePushResponse>("/api/message-push-policies");
      setPolicies(payload.policies);
      setInstances(payload.instances);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function openCreateDialog() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(policy: MessagePushPolicy) {
    setEditingId(policy.id);
    setForm({
      name: policy.name,
      deliveryTypes: policy.deliveryTypes.length > 0
        ? policy.deliveryTypes
        : deliveryTypesFromPolicyValue(policy.deliveryType),
      triggerType: policy.triggerType,
      thresholdPercent: policy.thresholdPercent ?? 20,
      scopeType: policy.scopeType,
      cpaInstanceIds: policy.cpaInstanceIds,
      webhookUrl: policy.webhookUrl,
      headersJson: policy.headersJson || "{}",
      bodyTemplate: policy.bodyTemplate,
      enabled: policy.enabled,
    });
    setDialogOpen(true);
  }

  function markPolicyTesting(id: number, testing: boolean) {
    setTestingPolicyIds((current) => {
      const next = new Set(current);
      if (testing) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function requestBrowserNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      toast.error("当前浏览器不支持系统通知");
      return "unsupported";
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      toast.success("浏览器通知已启用");
    } else {
      toast.error("浏览器通知权限未开启");
    }
    return permission;
  }

  async function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = policyPayload(form);
    if (!validatePayload(payload)) {
      return;
    }

    try {
      setSaving(true);
      if (payload.deliveryTypes.includes("browser_notification")) {
        await requestBrowserNotificationPermission();
      }
      if (editingId) {
        await mutate(`/api/message-push-policies/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast.success("消息推送策略已保存");
      } else {
        await mutate("/api/message-push-policies", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success("消息推送策略已创建");
      }
      setDialogOpen(false);
      await loadPolicies();
      await loadDeliveries(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function testPolicy(policy: MessagePushPolicy) {
    try {
      markPolicyTesting(policy.id, true);
      if (policy.deliveryTypes.includes("browser_notification")) {
        await requestBrowserNotificationPermission();
      }
      await mutate(`/api/message-push-policies/${policy.id}/test`, { method: "POST" });
      toast.success("测试消息已发送");
      await loadDeliveries(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      markPolicyTesting(policy.id, false);
    }
  }

  async function togglePolicy(policy: MessagePushPolicy, enabled: boolean) {
    try {
      await mutate(`/api/message-push-policies/${policy.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...policyPayload(policyToForm(policy)),
          enabled,
        }),
      });
      toast.success(enabled ? "消息推送策略已启用" : "消息推送策略已停用");
      await loadPolicies();
      await loadDeliveries(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function deletePolicy() {
    if (!deleteTarget) {
      return;
    }

    try {
      setDeleting(true);
      await mutate(`/api/message-push-policies/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("消息推送策略已删除");
      setDeleteTarget(null);
      await loadPolicies();
      await loadDeliveries(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  }

  function updateTriggerType(triggerType: MessagePushTriggerType) {
    setForm((current) => ({
      ...current,
      triggerType,
      bodyTemplate: current.bodyTemplate === triggerTemplateDefaults[current.triggerType]
        ? triggerTemplateDefaults[triggerType]
        : current.bodyTemplate,
    }));
  }

  function toggleDeliveryType(deliveryType: MessagePushDeliveryType, checked: boolean) {
    setForm((current) => ({
      ...current,
      deliveryTypes: checked
        ? [...new Set([...current.deliveryTypes, deliveryType])]
        : current.deliveryTypes.filter((type) => type !== deliveryType),
      headersJson: checked && deliveryType === "webhook"
        ? current.headersJson || emptyForm.headersJson
        : current.headersJson,
      bodyTemplate: checked && deliveryType === "browser_notification" && current.bodyTemplate === emptyForm.bodyTemplate
        ? "{{msg}}"
        : current.bodyTemplate,
    }));
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2.5 rounded-md border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">消息推送策略</div>
          <div className="text-sm text-muted-foreground">按 CPA 范围监控账号异常和额度剩余，触发后推送到 Webhook。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}
            onClick={() => void requestBrowserNotificationPermission()}
          >
            <Bell className="h-4 w-4" />
            {notificationPermission === "granted" ? "通知已开启" : "开启浏览器通知"}
          </Button>
          <Button type="button" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            新建
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑消息推送" : "新建消息推送"}</DialogTitle>
            <DialogDescription>
              触发条件会按每个 CPA 独立去重；恢复后再次触发才会重新推送。
            </DialogDescription>
          </DialogHeader>

          <form id="message-push-form" className="grid gap-4" onSubmit={submitPolicy}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="名称">
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="额度预警"
                  required
                />
              </Field>
              <Field label="推送类型">
                <div className="flex flex-wrap gap-3 rounded-md border bg-muted/25 p-2">
                  {Object.entries(deliveryTypeLabels).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.deliveryTypes.includes(value as MessagePushDeliveryType)}
                        onCheckedChange={(checked) =>
                          toggleDeliveryType(value as MessagePushDeliveryType, checked === true)
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </Field>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="推送时机">
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  value={form.triggerType}
                  onChange={(event) => updateTriggerType(event.target.value as MessagePushTriggerType)}
                >
                  {Object.entries(triggerLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>

              {form.triggerType !== "account_exception" ? (
                <Field label="低于百分比">
                  <div className="flex max-w-44 items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={form.thresholdPercent}
                      onChange={(event) => setForm({ ...form, thresholdPercent: Number(event.target.value) })}
                      required
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </Field>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>监控范围</Label>
              <div className="flex flex-wrap gap-2">
                <ScopeButton
                  active={form.scopeType === "all_enabled"}
                  onClick={() => setForm({ ...form, scopeType: "all_enabled", cpaInstanceIds: [] })}
                >
                  全部启用 CPA
                </ScopeButton>
                <ScopeButton
                  active={form.scopeType === "custom"}
                  onClick={() => setForm({ ...form, scopeType: "custom" })}
                >
                  自定义 CPA
                </ScopeButton>
              </div>
              {form.scopeType === "custom" ? (
                <div className="flex max-h-44 flex-wrap gap-3 overflow-auto rounded-md border bg-muted/25 p-3">
                  {instances.map((instance) => (
                    <label key={instance.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.cpaInstanceIds.includes(instance.id)}
                        onCheckedChange={(checked) => {
                          const ids = checked
                            ? [...form.cpaInstanceIds, instance.id]
                            : form.cpaInstanceIds.filter((id) => id !== instance.id);
                          setForm({ ...form, cpaInstanceIds: ids });
                        }}
                      />
                      <span className={cn(!instance.enabled && "text-muted-foreground")}>
                        {instance.name}{instance.enabled ? "" : "（停用）"}
                      </span>
                    </label>
                  ))}
                  {instances.length === 0 ? (
                    <span className="text-sm text-muted-foreground">暂无 CPA 实例</span>
                  ) : null}
                </div>
              ) : null}
            </div>

            {form.deliveryTypes.includes("webhook") ? (
              <>
                <Field label="Webhook URL">
                  <Input
                    value={form.webhookUrl}
                    onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })}
                    placeholder="https://example.com/webhook"
                    required
                  />
                </Field>

                <Field label="请求头">
                  <Textarea
                    className="min-h-20 font-mono text-xs"
                    value={form.headersJson}
                    onChange={(event) => setForm({ ...form, headersJson: event.target.value })}
                    placeholder='{"content-type":"application/json","Authorization":"Bearer "}'
                  />
                </Field>
              </>
            ) : null}

            <Field label={form.deliveryTypes.includes("webhook") ? "请求体 / 通知内容" : "通知内容"}>
              <Textarea
                className="min-h-24 font-mono text-xs"
                value={form.bodyTemplate}
                onChange={(event) => setForm({ ...form, bodyTemplate: event.target.value })}
                placeholder={form.deliveryTypes.includes("webhook") ? '{ "message": "{{msg}}" }' : "{{msg}}"}
                required
              />
              <div className="text-xs text-muted-foreground">
                可用变量：{"{{msg}}"}、{"{{trigger}}"}、{"{{cpaName}}"}、{"{{value}}"}、{"{{threshold}}"}、{"{{accountCount}}"}、{"{{exceptionByType}}"}
              </div>
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
              启用
            </label>
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="message-push-form" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editingId ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除消息推送策略</DialogTitle>
            <DialogDescription>
              删除后这个策略的触发状态和投递记录也会一起移除。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            {deleteTarget?.name}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button type="button" variant="destructive" disabled={deleting} onClick={() => void deletePolicy()}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="overflow-x-auto rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">名称</TableHead>
              <TableHead className="whitespace-nowrap">类型</TableHead>
              <TableHead className="whitespace-nowrap">推送时机</TableHead>
              <TableHead className="whitespace-nowrap">监控范围</TableHead>
              <TableHead className="whitespace-nowrap">Webhook</TableHead>
              <TableHead className="whitespace-nowrap">启用</TableHead>
              <TableHead className="whitespace-nowrap">更新</TableHead>
              <TableHead className="whitespace-nowrap">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中
                  </span>
                </TableCell>
              </TableRow>
            ) : null}
            {!loading && policies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  暂无消息推送策略
                </TableCell>
              </TableRow>
            ) : null}
            {!loading ? policies.map((policy) => (
              <TableRow key={policy.id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                    {policy.name}
                  </div>
                </TableCell>
                <TableCell>
                  <DeliveryTypeBadges types={policy.deliveryTypes} />
                </TableCell>
                <TableCell>
                  <TriggerBadge policy={policy} />
                </TableCell>
                <TableCell>
                  <ScopeSummary policy={policy} instanceNameById={instanceNameById} />
                </TableCell>
                <TableCell>
                  <code className="block max-w-72 truncate text-xs" title={policy.webhookUrl}>
                    {policy.webhookUrl}
                  </code>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={policy.enabled}
                    aria-label={`${policy.name} 启用状态`}
                    onCheckedChange={(enabled) => void togglePolicy(policy, enabled)}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDate(policy.updatedAt)}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={testingPolicyIds.has(policy.id)}
                      onClick={() => void testPolicy(policy)}
                    >
                      {testingPolicyIds.has(policy.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      测试
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => openEditDialog(policy)}>
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </Button>
                    <Button type="button" size="icon" variant="ghost" onClick={() => setDeleteTarget(policy)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )) : null}
          </TableBody>
        </Table>
      </div>

      <MessagePushHistoryTable
        deliveries={deliveries}
        pagination={deliveryPagination}
        loading={deliveriesLoading}
        onRefresh={() => loadDeliveries(deliveryPagination.page)}
        onPageChange={loadDeliveries}
      />
    </section>
  );
}

function MessagePushHistoryTable({
  deliveries,
  pagination,
  loading,
  onRefresh,
  onPageChange,
}: {
  deliveries: MessagePushDelivery[];
  pagination: MessagePushDeliveryPagination;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onPageChange: (page: number) => Promise<void>;
}) {
  const canGoPrevious = pagination.page > 1;
  const canGoNext = pagination.page < pagination.totalPages;

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">推送历史</div>
          <div className="text-xs text-muted-foreground">
            共 {pagination.total} 条，每页 {pagination.pageSize} 条
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void onRefresh()}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            刷新
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canGoPrevious || loading}
            onClick={() => void onPageChange(pagination.page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            上一页
          </Button>
          <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
            {pagination.page} / {pagination.totalPages}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canGoNext || loading}
            onClick={() => void onPageChange(pagination.page + 1)}
          >
            下一页
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">时间</TableHead>
              <TableHead className="whitespace-nowrap">类型</TableHead>
              <TableHead className="whitespace-nowrap">策略</TableHead>
              <TableHead className="whitespace-nowrap">CPA</TableHead>
              <TableHead className="whitespace-nowrap">触发</TableHead>
              <TableHead className="whitespace-nowrap">状态</TableHead>
              <TableHead className="whitespace-nowrap">消息</TableHead>
              <TableHead className="whitespace-nowrap">响应</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中
                  </span>
                </TableCell>
              </TableRow>
            ) : null}
            {!loading && deliveries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  暂无推送历史
                </TableCell>
              </TableRow>
            ) : null}
            {!loading ? deliveries.map((delivery) => (
              <TableRow key={delivery.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDate(delivery.sentAt)}
                </TableCell>
                <TableCell>
                  <DeliveryTypeBadge type={delivery.deliveryType} />
                </TableCell>
                <TableCell>
                  <span className="block max-w-40 truncate font-medium" title={delivery.policyName ?? `策略 #${delivery.policyId}`}>
                    {delivery.policyName ?? `策略 #${delivery.policyId}`}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="block max-w-40 truncate" title={delivery.cpaInstanceName ?? `CPA #${delivery.cpaInstanceId}`}>
                    {delivery.cpaInstanceName ?? `CPA #${delivery.cpaInstanceId}`}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatTriggerKey(delivery.triggerKey)}
                </TableCell>
                <TableCell>
                  <DeliveryStatusBadge status={delivery.status} />
                </TableCell>
                <TableCell>
                  <span className="block max-w-[360px] truncate text-sm" title={delivery.message}>
                    {delivery.message}
                  </span>
                </TableCell>
                <TableCell>
                  <DeliveryResponseSummary delivery={delivery} />
                </TableCell>
              </TableRow>
            )) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DeliveryStatusBadge({ status }: { status: string }) {
  const ok = status === "success";
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 text-xs font-normal",
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-rose-200 bg-rose-50 text-rose-700",
      )}
    >
      {ok ? "成功" : "失败"}
    </Badge>
  );
}

function DeliveryResponseSummary({ delivery }: { delivery: MessagePushDelivery }) {
  const responseText = delivery.error || delivery.responseBody || "-";
  const statusText = typeof delivery.responseStatus === "number"
    ? String(delivery.responseStatus)
    : "-";

  return (
    <div className="max-w-[360px] space-y-0.5 text-xs">
      <div className="whitespace-nowrap text-muted-foreground">HTTP {statusText}</div>
      <div className="truncate" title={responseText}>
        {responseText}
      </div>
    </div>
  );
}

function formatTriggerKey(value: string) {
  if (value in triggerLabels) {
    return triggerLabels[value as MessagePushTriggerType];
  }
  return value;
}

function TriggerBadge({ policy }: { policy: MessagePushPolicy }) {
  const label = policy.triggerType === "account_exception"
    ? triggerLabels[policy.triggerType]
    : `${triggerLabels[policy.triggerType]} ${policy.thresholdPercent}%`;
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 text-xs font-normal",
        policy.triggerType === "account_exception" && "border-rose-200 bg-rose-50 text-rose-700",
        policy.triggerType === "remaining_5h_below" && "border-sky-200 bg-sky-50 text-sky-700",
        policy.triggerType === "remaining_week_below" && "border-amber-200 bg-amber-50 text-amber-700",
      )}
    >
      {label}
    </Badge>
  );
}

function DeliveryTypeBadge({ type }: { type: MessagePushDeliveryType }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "px-1.5 py-0 text-xs font-normal",
        type === "webhook"
          ? "border-slate-200 bg-slate-50 text-slate-700"
          : "border-violet-200 bg-violet-50 text-violet-700",
      )}
    >
      {deliveryTypeLabels[type]}
    </Badge>
  );
}

function DeliveryTypeBadges({ types }: { types: MessagePushDeliveryType[] }) {
  const values = types.length > 0 ? types : ["webhook" as const];
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((type) => (
        <DeliveryTypeBadge key={type} type={type} />
      ))}
    </div>
  );
}

function ScopeSummary({
  policy,
  instanceNameById,
}: {
  policy: MessagePushPolicy;
  instanceNameById: Map<number, string>;
}) {
  if (policy.scopeType === "all_enabled") {
    return <span className="text-sm">全部启用 CPA</span>;
  }

  if (policy.cpaInstanceIds.length === 0) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }

  return (
    <div className="flex max-w-80 flex-wrap gap-1.5">
      {policy.cpaInstanceIds.map((id) => (
        <Badge
          key={id}
          variant="outline"
          className="max-w-36 truncate px-1.5 py-0 text-xs font-normal"
          title={instanceNameById.get(id) ?? `CPA #${id}`}
        >
          {instanceNameById.get(id) ?? `CPA #${id}`}
        </Badge>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ScopeButton({
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
      className="h-7 px-2 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function policyToForm(policy: MessagePushPolicy): MessagePushForm {
  return {
    name: policy.name,
    deliveryTypes: policy.deliveryTypes.length > 0
      ? policy.deliveryTypes
      : deliveryTypesFromPolicyValue(policy.deliveryType),
    triggerType: policy.triggerType,
    thresholdPercent: policy.thresholdPercent ?? 20,
    scopeType: policy.scopeType,
    cpaInstanceIds: policy.cpaInstanceIds,
    webhookUrl: policy.webhookUrl,
    headersJson: policy.headersJson || "{}",
    bodyTemplate: policy.bodyTemplate,
    enabled: policy.enabled,
  };
}

function policyPayload(form: MessagePushForm) {
  return {
    name: form.name.trim(),
    deliveryTypes: form.deliveryTypes,
    triggerType: form.triggerType,
    thresholdPercent: form.triggerType === "account_exception" ? null : form.thresholdPercent,
    scopeType: form.scopeType,
    cpaInstanceIds: form.scopeType === "custom" ? form.cpaInstanceIds : [],
    webhookUrl: form.webhookUrl.trim(),
    headersJson: form.headersJson.trim() || "{}",
    bodyTemplate: form.bodyTemplate.trim(),
    enabled: form.enabled,
  };
}

function validatePayload(payload: ReturnType<typeof policyPayload>) {
  if (payload.deliveryTypes.length === 0) {
    toast.error("至少选择一种推送类型");
    return false;
  }

  if (payload.scopeType === "custom" && payload.cpaInstanceIds.length === 0) {
    toast.error("自定义监控范围至少选择一个 CPA");
    return false;
  }

  if (payload.deliveryTypes.includes("webhook")) {
    try {
      const parsed = JSON.parse(payload.headersJson) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        toast.error("请求头必须是 JSON 对象");
        return false;
      }
    } catch {
      toast.error("请求头必须是 JSON 对象");
      return false;
    }
  }

  return true;
}

function deliveryTypesFromPolicyValue(value: string): MessagePushDeliveryType[] {
  const types = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is MessagePushDeliveryType =>
      Object.prototype.hasOwnProperty.call(deliveryTypeLabels, item),
    );
  return types.length > 0 ? types : ["webhook"];
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
