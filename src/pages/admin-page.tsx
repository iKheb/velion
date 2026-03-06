import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { PageHeader } from "@/components/ui/page-header";
import { getProfileRoute } from "@/lib/constants";
import { invalidateMany } from "@/lib/query-utils";
import { useAppStore } from "@/store/app.store";
import {
  acknowledgeAdminAlert,
  banProfileAsAdmin,
  deleteReelAsAdmin,
  deletePostAsAdmin,
  deleteStoryAsAdmin,
  deleteStreamAsAdmin,
  deleteVideoAsAdmin,
  getAnalyticsInsights,
  getAnalyticsSummary,
  listPaymentIntentsAdmin,
  listAdminAlertsByStatus,
  listAdminAlertSyncRuns,
  listAnalyticsEvents,
  resolveAdminAlert,
  reopenAdminAlert,
  addSupportTicketMessageAsAdmin,
  listSupportTicketMessagesAdmin,
  listSupportTicketsAdmin,
  listReports,
  listUsers,
  syncAdminAlertsServer,
  reconcileStalePaymentsAdmin,
  syncReportAlertsServer,
  toggleUserBan,
  updateSupportTicketAdminStatus,
  updateReportStatus,
} from "@/services/admin.service";
import { toAppError } from "@/services/error.service";

const formatNumber = (value: number): string => new Intl.NumberFormat("es-ES").format(value);
const formatMoneyMinor = (minor: number): string => `$${(minor / 100).toFixed(2)}`;
const escapeCsv = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const formatDelta = (value: number | null): string => (value === null ? "N/A" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`);
const normalizeReportTargetType = (targetType: string): "profile" | "post" | "video" | "story" | "reel" | "stream" | "unknown" => {
  const normalized = targetType.trim().toLowerCase();
  if (normalized === "profile") return "profile";
  if (normalized === "post") return "post";
  if (normalized === "video") return "video";
  if (normalized === "story" || normalized === "stories") return "story";
  if (normalized === "reel" || normalized === "rells" || normalized === "reels") return "reel";
  if (normalized === "stream") return "stream";
  return "unknown";
};

interface PendingModerationAction {
  reportId: string;
  targetId: string;
  targetType: "profile" | "post" | "video" | "story" | "reel" | "stream";
  title: string;
  description: string;
  confirmLabel: string;
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);
  const [rangeDays, setRangeDays] = useState<1 | 7 | 30>(7);
  const [eventNameFilter, setEventNameFilter] = useState("");
  const [adminAlertStatusFilter, setAdminAlertStatusFilter] = useState<"all" | "open" | "acknowledged" | "resolved">("all");
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [pendingBanAction, setPendingBanAction] = useState<{ userId: string; nextValue: boolean; username: string } | null>(null);
  const [pendingModerationAction, setPendingModerationAction] = useState<PendingModerationAction | null>(null);
  const [lastReportAlertSyncAt, setLastReportAlertSyncAt] = useState<string | null>(null);
  const [supportTicketStatusFilter, setSupportTicketStatusFilter] = useState<
    "all" | "open" | "in_progress" | "waiting_user" | "resolved" | "closed"
  >("all");
  const [selectedSupportTicketId, setSelectedSupportTicketId] = useState<string | null>(null);
  const [supportReplyMessage, setSupportReplyMessage] = useState("");
  const [paymentIntentStatusFilter, setPaymentIntentStatusFilter] = useState<
    "all" | "created" | "pending" | "pending_webhook" | "retrying" | "requires_action" | "succeeded" | "canceled" | "failed"
  >("all");
  const [paymentProviderFilter, setPaymentProviderFilter] = useState<"all" | "stripe" | "mercado_pago">("all");

  const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: listUsers, enabled: profile?.role === "admin" });
  const reportsQuery = useQuery({ queryKey: ["admin-reports"], queryFn: listReports, enabled: profile?.role === "admin" });
  const analyticsQuery = useQuery({
    queryKey: ["admin-analytics", rangeDays],
    queryFn: () => getAnalyticsSummary(rangeDays),
    enabled: profile?.role === "admin",
  });
  const analyticsInsightsQuery = useQuery({
    queryKey: ["admin-analytics-insights", rangeDays],
    queryFn: () => getAnalyticsInsights(rangeDays),
    enabled: profile?.role === "admin",
  });
  const analyticsEventsQuery = useQuery({
    queryKey: ["admin-analytics-events", rangeDays, eventNameFilter],
    queryFn: () => listAnalyticsEvents(rangeDays, eventNameFilter, 2000),
    enabled: profile?.role === "admin",
  });
  const adminAlertsQuery = useQuery({
    queryKey: ["admin-alerts", adminAlertStatusFilter],
    queryFn: () => listAdminAlertsByStatus(adminAlertStatusFilter),
    enabled: profile?.role === "admin",
  });
  const syncRunsQuery = useQuery({
    queryKey: ["admin-alert-sync-runs"],
    queryFn: () => listAdminAlertSyncRuns(25),
    enabled: profile?.role === "admin",
  });
  const supportTicketsQuery = useQuery({
    queryKey: ["admin-support-tickets", supportTicketStatusFilter],
    queryFn: () => listSupportTicketsAdmin(supportTicketStatusFilter),
    enabled: profile?.role === "admin",
  });
  const supportTicketMessagesQuery = useQuery({
    queryKey: ["admin-support-ticket-messages", selectedSupportTicketId],
    queryFn: () => listSupportTicketMessagesAdmin(selectedSupportTicketId as string),
    enabled: profile?.role === "admin" && Boolean(selectedSupportTicketId),
  });
  const paymentIntentsQuery = useQuery({
    queryKey: ["admin-payment-intents", paymentIntentStatusFilter, paymentProviderFilter],
    queryFn: () =>
      listPaymentIntentsAdmin({
        status: paymentIntentStatusFilter,
        provider: paymentProviderFilter,
        limit: 100,
      }),
    enabled: profile?.role === "admin",
  });

  const banMutation = useMutation({
    mutationFn: async ({ userId, nextValue }: { userId: string; nextValue: boolean }) =>
      toggleUserBan(userId, nextValue),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-users"]]);
    },
  });

  const reportMutation = useMutation({
    mutationFn: async ({ reportId, status }: { reportId: string; status: "open" | "reviewed" | "dismissed" }) =>
      updateReportStatus(reportId, status),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-reports"]]);
    },
  });

  const moderateTargetMutation = useMutation({
    mutationFn: async (action: PendingModerationAction) => {
      if (action.targetType === "profile") {
        await banProfileAsAdmin(action.targetId);
      } else if (action.targetType === "post") {
        await deletePostAsAdmin(action.targetId);
      } else if (action.targetType === "video") {
        await deleteVideoAsAdmin(action.targetId);
      } else if (action.targetType === "story") {
        await deleteStoryAsAdmin(action.targetId);
      } else if (action.targetType === "reel") {
        await deleteReelAsAdmin(action.targetId);
      } else if (action.targetType === "stream") {
        await deleteStreamAsAdmin(action.targetId);
      }
      await updateReportStatus(action.reportId, "reviewed");
    },
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-reports"], ["admin-users"]]);
    },
  });
  const syncReportAlertsMutation = useMutation({
    mutationFn: syncReportAlertsServer,
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-alerts"]]);
      setLastReportAlertSyncAt(new Date().toISOString());
    },
  });

  const syncAlertsMutation = useMutation({
    mutationFn: async () => syncAdminAlertsServer(rangeDays),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-alerts"], ["admin-alert-sync-runs"]]);
      setLastSyncAt(new Date().toISOString());
    },
  });
  const acknowledgeAlertMutation = useMutation({
    mutationFn: acknowledgeAdminAlert,
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-alerts"]]);
    },
  });
  const reopenAlertMutation = useMutation({
    mutationFn: reopenAdminAlert,
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-alerts"]]);
    },
  });
  const resolveAlertMutation = useMutation({
    mutationFn: resolveAdminAlert,
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-alerts"]]);
    },
  });
  const supportTicketStatusMutation = useMutation({
    mutationFn: async ({
      ticketId,
      status,
    }: {
      ticketId: string;
      status: "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
    }) => updateSupportTicketAdminStatus(ticketId, status),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-support-tickets"], ["admin-support-ticket-messages"]]);
    },
  });
  const supportTicketReplyMutation = useMutation({
    mutationFn: async ({ ticketId, message }: { ticketId: string; message: string }) =>
      addSupportTicketMessageAsAdmin(ticketId, message),
    onSuccess: async () => {
      setSupportReplyMessage("");
      await invalidateMany(queryClient, [["admin-support-tickets"], ["admin-support-ticket-messages"]]);
    },
  });
  const reconcilePaymentsMutation = useMutation({
    mutationFn: async () =>
      reconcileStalePaymentsAdmin({
        limit: 100,
        minutes: 30,
        maxRetries: 6,
      }),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-payment-intents"]]);
    },
  });
  const reconcileSinglePaymentMutation = useMutation({
    mutationFn: async (intentId: string) =>
      reconcileStalePaymentsAdmin({
        intentId,
        limit: 1,
        minutes: 30,
        maxRetries: 6,
      }),
    onSuccess: async () => {
      await invalidateMany(queryClient, [["admin-payment-intents"]]);
    },
  });

  const topEvents = analyticsQuery.data?.top_events ?? [];
  const dailyEvents = analyticsQuery.data?.daily_events ?? [];
  const maxTopEventCount = topEvents.reduce((max, item) => Math.max(max, item.count), 0);
  const maxDailyEventCount = dailyEvents.reduce((max, item) => Math.max(max, item.count), 0);
  const sparklinePoints =
    dailyEvents.length > 0
      ? dailyEvents
          .map((item, index) => {
            const x = (index / Math.max(dailyEvents.length - 1, 1)) * 100;
            const y = 100 - (item.count / Math.max(maxDailyEventCount, 1)) * 100;
            return `${x},${y}`;
          })
          .join(" ")
      : "";
  const selectedSupportTicket = (supportTicketsQuery.data ?? []).find((ticket) => ticket.id === selectedSupportTicketId) ?? null;
  const reportStats = (reportsQuery.data ?? []).reduce(
    (acc, report) => {
      const type = normalizeReportTargetType(report.target_type);
      if (report.status === "open") {
        acc.openTotal += 1;
        if (type !== "unknown") {
          acc.byType[type] += 1;
        }
      }
      return acc;
    },
    {
      openTotal: 0,
      byType: {
        profile: 0,
        post: 0,
        video: 0,
        story: 0,
        reel: 0,
        stream: 0,
      },
    },
  );

  useEffect(() => {
    if (!autoSyncEnabled || profile?.role !== "admin") return;

    syncAlertsMutation.mutate();
    const intervalId = window.setInterval(() => {
      syncAlertsMutation.mutate();
    }, 120000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoSyncEnabled, profile?.role, rangeDays]);

  if (profile?.role !== "admin") {
    return (
      <Card>
        <h1 className="text-xl font-bold">Acceso denegado</h1>
        <p className="text-sm text-zinc-300">Solo administradores pueden abrir esta ruta.</p>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <PageHeader title="Panel Admin" subtitle="Moderación, analítica y alertas operativas en una vista unificada." />

      {(usersQuery.error ||
        reportsQuery.error ||
        analyticsQuery.error ||
        analyticsInsightsQuery.error ||
        analyticsEventsQuery.error ||
        adminAlertsQuery.error ||
        syncRunsQuery.error ||
        supportTicketsQuery.error ||
        supportTicketMessagesQuery.error ||
        paymentIntentsQuery.error ||
        reconcilePaymentsMutation.error ||
        reconcileSinglePaymentMutation.error) && (
        <Card>
          <p className="text-sm text-red-400">
            {toAppError(
              usersQuery.error ??
                reportsQuery.error ??
                analyticsQuery.error ??
                analyticsInsightsQuery.error ??
                analyticsEventsQuery.error ??
                adminAlertsQuery.error ??
                syncRunsQuery.error ??
                supportTicketsQuery.error ??
                supportTicketMessagesQuery.error ??
                paymentIntentsQuery.error ??
                reconcilePaymentsMutation.error ??
                reconcileSinglePaymentMutation.error,
            )}
          </p>
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Analitica de uso</h2>
          <div className="flex gap-2">
            <Button className={`text-xs ${rangeDays === 1 ? "" : "bg-zinc-700 hover:bg-zinc-600"}`} onClick={() => setRangeDays(1)}>
              24h
            </Button>
            <Button className={`text-xs ${rangeDays === 7 ? "" : "bg-zinc-700 hover:bg-zinc-600"}`} onClick={() => setRangeDays(7)}>
              7 dias
            </Button>
            <Button className={`text-xs ${rangeDays === 30 ? "" : "bg-zinc-700 hover:bg-zinc-600"}`} onClick={() => setRangeDays(30)}>
              30 dias
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={eventNameFilter}
            onChange={(event) => setEventNameFilter(event.target.value)}
            placeholder="Filtrar por event_name..."
            className="sm:max-w-xs"
          />
          <Button
            className="bg-zinc-700 px-3 py-2 text-xs"
            onClick={() => {
              const rows = analyticsEventsQuery.data ?? [];
              if (!rows.length) return;

              const header = ["created_at", "event_name", "user_id", "payload_json"];
              const lines = rows.map((row) =>
                [
                  escapeCsv(row.created_at ?? ""),
                  escapeCsv(row.event_name ?? ""),
                  escapeCsv(row.user_id ?? ""),
                  escapeCsv(JSON.stringify(row.payload ?? {})),
                ].join(","),
              );
              const csv = [header.join(","), ...lines].join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `velion_analytics_${rangeDays}d.csv`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }}
          >
            Exportar CSV
          </Button>
          <p className="text-xs text-zinc-400">Eventos cargados: {formatNumber((analyticsEventsQuery.data ?? []).length)}</p>
        </div>

        {analyticsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando metricas...</p>}

        {analyticsQuery.data && (
          <>
            {analyticsInsightsQuery.data && (
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-velion-black/50 p-3">
                  <p className="text-xs text-zinc-400">Delta eventos</p>
                  <p className="text-xl font-semibold">{formatDelta(analyticsInsightsQuery.data.total_events_delta_percent)}</p>
                </div>
                <div className="rounded-lg bg-velion-black/50 p-3">
                  <p className="text-xs text-zinc-400">Delta page_view</p>
                  <p className="text-xl font-semibold">{formatDelta(analyticsInsightsQuery.data.page_view_delta_percent)}</p>
                </div>
                <div className="rounded-lg bg-velion-black/50 p-3">
                  <p className="text-xs text-zinc-400">Ratio anonimo</p>
                  <p className="text-xl font-semibold">{(analyticsInsightsQuery.data.anonymous_ratio * 100).toFixed(1)}%</p>
                </div>
              </div>
            )}

            {analyticsInsightsQuery.data && (
              <div className="space-y-2 rounded-lg border border-zinc-700 bg-velion-black/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Alertas automaticas</p>
                  <div className="flex items-center gap-2">
                    <Button
                      className={`px-3 py-1 text-xs ${autoSyncEnabled ? "bg-emerald-700" : "bg-zinc-700"}`}
                      onClick={() => setAutoSyncEnabled((prev) => !prev)}
                    >
                      Auto-sync {autoSyncEnabled ? "ON" : "OFF"}
                    </Button>
                    <Button className="bg-zinc-700 px-3 py-1 text-xs" onClick={() => syncAlertsMutation.mutate()} disabled={syncAlertsMutation.isPending}>
                      Guardar alertas
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-zinc-400">
                  Ultima sincronizacion: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "Aun no sincronizado"}
                </p>
                {analyticsInsightsQuery.data.alerts.length === 0 && (
                  <p className="text-xs text-emerald-400">Sin alertas relevantes en este periodo.</p>
                )}
                {analyticsInsightsQuery.data.alerts.map((alert) => (
                  <p key={alert} className="text-xs text-amber-300">
                    - {alert}
                  </p>
                ))}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-velion-black/50 p-3">
                <p className="text-xs text-zinc-400">Eventos</p>
                <p className="text-xl font-semibold">{formatNumber(analyticsQuery.data.total_events)}</p>
              </div>
              <div className="rounded-lg bg-velion-black/50 p-3">
                <p className="text-xs text-zinc-400">Usuarios unicos</p>
                <p className="text-xl font-semibold">{formatNumber(analyticsQuery.data.unique_users)}</p>
              </div>
              <div className="rounded-lg bg-velion-black/50 p-3">
                <p className="text-xs text-zinc-400">Eventos anonimos</p>
                <p className="text-xl font-semibold">{formatNumber(analyticsQuery.data.anonymous_events)}</p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Top eventos</h3>
                {topEvents.length === 0 && <p className="text-xs text-zinc-400">Sin datos para este rango.</p>}
                {topEvents.map((event) => (
                  <div key={event.event_name} className="space-y-1 rounded-lg bg-velion-black/50 p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>{event.event_name}</span>
                      <span className="text-zinc-300">{formatNumber(event.count)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-velion-fuchsia"
                        style={{ width: `${(event.count / Math.max(maxTopEventCount, 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium">Actividad diaria</h3>
                {dailyEvents.length === 0 && <p className="text-xs text-zinc-400">Sin datos para este rango.</p>}
                {dailyEvents.length > 0 && (
                  <div className="rounded-lg bg-velion-black/50 p-2">
                    <svg viewBox="0 0 100 100" className="h-24 w-full">
                      <polyline
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-velion-fuchsia"
                        points={sparklinePoints}
                      />
                    </svg>
                  </div>
                )}
                {dailyEvents.map((day) => (
                  <div key={day.day} className="space-y-1 rounded-lg bg-velion-black/50 p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>{day.day}</span>
                      <span className="text-zinc-300">{formatNumber(day.count)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-sky-400"
                        style={{ width: `${(day.count / Math.max(maxDailyEventCount, 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Alertas persistidas</h2>
          <div className="flex gap-2">
            <Button
              className={`text-xs ${adminAlertStatusFilter === "all" ? "" : "bg-zinc-700 hover:bg-zinc-600"}`}
              onClick={() => setAdminAlertStatusFilter("all")}
            >
              Todas
            </Button>
            <Button
              className={`text-xs ${adminAlertStatusFilter === "open" ? "" : "bg-zinc-700 hover:bg-zinc-600"}`}
              onClick={() => setAdminAlertStatusFilter("open")}
            >
              Open
            </Button>
            <Button
              className={`text-xs ${adminAlertStatusFilter === "acknowledged" ? "" : "bg-zinc-700 hover:bg-zinc-600"}`}
              onClick={() => setAdminAlertStatusFilter("acknowledged")}
            >
              ACK
            </Button>
            <Button
              className={`text-xs ${adminAlertStatusFilter === "resolved" ? "" : "bg-zinc-700 hover:bg-zinc-600"}`}
              onClick={() => setAdminAlertStatusFilter("resolved")}
            >
              Resueltas
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-velion-black/30 p-3 text-xs text-zinc-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-zinc-200">Alertas de reportes</p>
            <Button
              className="bg-zinc-700 px-3 py-1 text-xs"
              onClick={() => syncReportAlertsMutation.mutate()}
              disabled={syncReportAlertsMutation.isPending}
            >
              Sync reportes
            </Button>
          </div>
          <p className="mt-2">Abiertos: {reportStats.openTotal}</p>
          <p>
            perfiles {reportStats.byType.profile} · posts {reportStats.byType.post} · videos {reportStats.byType.video} · historias{" "}
            {reportStats.byType.story} · reels {reportStats.byType.reel} · streams {reportStats.byType.stream}
          </p>
          <p className="text-zinc-400">Ultimo sync reportes: {lastReportAlertSyncAt ? new Date(lastReportAlertSyncAt).toLocaleString() : "Sin sync"}</p>
        </div>
        {adminAlertsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando alertas...</p>}
        {(adminAlertsQuery.data ?? []).length === 0 && <p className="text-xs text-zinc-400">No hay alertas guardadas.</p>}
        {(adminAlertsQuery.data ?? []).map((alert) => (
          <div key={alert.id} className="space-y-2 rounded-lg bg-velion-black/50 p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{alert.message}</p>
              <span className="rounded bg-zinc-800 px-2 py-1 text-xs uppercase tracking-wide text-zinc-200">{alert.status}</span>
            </div>
            <p className="text-xs text-zinc-400">Ultima vez: {new Date(alert.last_seen_at).toLocaleString()}</p>
            <div className="flex gap-2">
              <Button
                className="bg-zinc-700 px-3 py-1 text-xs"
                onClick={() => acknowledgeAlertMutation.mutate(alert.id)}
                disabled={alert.status === "acknowledged" || acknowledgeAlertMutation.isPending}
              >
                ACK
              </Button>
              <Button
                className="bg-zinc-700 px-3 py-1 text-xs"
                onClick={() => reopenAlertMutation.mutate(alert.id)}
                disabled={alert.status === "open" || reopenAlertMutation.isPending}
              >
                Reabrir
              </Button>
              <Button
                className="bg-zinc-700 px-3 py-1 text-xs"
                onClick={() => resolveAlertMutation.mutate(alert.id)}
                disabled={alert.status === "resolved" || resolveAlertMutation.isPending}
              >
                Resolver
              </Button>
            </div>
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Historial de sincronizacion</h2>
        {syncRunsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando ejecuciones...</p>}
        {(syncRunsQuery.data ?? []).length === 0 && <p className="text-xs text-zinc-400">Sin ejecuciones registradas.</p>}
        {(syncRunsQuery.data ?? []).map((run) => (
          <div key={run.id} className="space-y-1 rounded-lg bg-velion-black/50 p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                Rango {run.range_days}d · {run.status}
              </p>
              <p className="text-xs text-zinc-400">{new Date(run.started_at).toLocaleString()}</p>
            </div>
            <p className="text-xs text-zinc-400">
              detectadas: {run.alerts_detected ?? 0} · upsert: {run.alerts_upserted ?? 0} · resueltas: {run.alerts_resolved ?? 0}
            </p>
            {run.error_message && <p className="text-xs text-red-400">Error: {run.error_message}</p>}
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Soporte (admin)</h2>
          <Select
            value={supportTicketStatusFilter}
            onChange={(event) =>
              setSupportTicketStatusFilter(
                event.target.value as "all" | "open" | "in_progress" | "waiting_user" | "resolved" | "closed",
              )
            }
            className="max-w-[220px]"
          >
            <option value="all">Todos</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="waiting_user">Waiting user</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </Select>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            {supportTicketsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando tickets...</p>}
            {(supportTicketsQuery.data ?? []).length === 0 && <p className="text-xs text-zinc-400">Sin tickets en este filtro.</p>}
            {(supportTicketsQuery.data ?? []).map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setSelectedSupportTicketId(ticket.id)}
                className={`w-full rounded-lg border p-3 text-left ${
                  selectedSupportTicketId === ticket.id
                    ? "border-velion-fuchsia bg-velion-black/70"
                    : "border-zinc-700 bg-velion-black/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{ticket.subject}</p>
                  <span className="rounded bg-zinc-800 px-2 py-1 text-xs uppercase text-zinc-200">{ticket.status}</span>
                </div>
                <p className="text-xs text-zinc-400">
                  {ticket.requester?.username ? `@${ticket.requester.username}` : ticket.requester_id} · {ticket.priority}
                </p>
              </button>
            ))}
          </div>

          <div className="space-y-3 rounded-lg border border-zinc-700 bg-velion-black/40 p-3">
            {!selectedSupportTicket && <p className="text-xs text-zinc-400">Selecciona un ticket para gestionarlo.</p>}
            {selectedSupportTicket && (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-semibold">{selectedSupportTicket.subject}</p>
                  <p className="text-xs text-zinc-400">{selectedSupportTicket.description}</p>
                  <p className="text-xs text-zinc-400">
                    Categoria: {selectedSupportTicket.category} · Prioridad: {selectedSupportTicket.priority}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    className="bg-zinc-700 px-3 py-1 text-xs"
                    onClick={() => supportTicketStatusMutation.mutate({ ticketId: selectedSupportTicket.id, status: "in_progress" })}
                    disabled={supportTicketStatusMutation.isPending}
                  >
                    In progress
                  </Button>
                  <Button
                    className="bg-zinc-700 px-3 py-1 text-xs"
                    onClick={() => supportTicketStatusMutation.mutate({ ticketId: selectedSupportTicket.id, status: "waiting_user" })}
                    disabled={supportTicketStatusMutation.isPending}
                  >
                    Waiting user
                  </Button>
                  <Button
                    className="bg-zinc-700 px-3 py-1 text-xs"
                    onClick={() => supportTicketStatusMutation.mutate({ ticketId: selectedSupportTicket.id, status: "resolved" })}
                    disabled={supportTicketStatusMutation.isPending}
                  >
                    Resolver
                  </Button>
                  <Button
                    className="bg-zinc-700 px-3 py-1 text-xs"
                    onClick={() => supportTicketStatusMutation.mutate({ ticketId: selectedSupportTicket.id, status: "closed" })}
                    disabled={supportTicketStatusMutation.isPending}
                  >
                    Cerrar
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-zinc-300">Mensajes</p>
                  <div className="max-h-48 space-y-2 overflow-auto pr-1">
                    {supportTicketMessagesQuery.isLoading && <p className="text-xs text-zinc-400">Cargando mensajes...</p>}
                    {(supportTicketMessagesQuery.data ?? []).map((msg) => (
                      <div key={msg.id} className="rounded bg-zinc-900/60 p-2 text-xs">
                        <p className="text-zinc-300">
                          {msg.sender_role} · {new Date(msg.created_at).toLocaleString()}
                        </p>
                        <p>{msg.message}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Input
                    value={supportReplyMessage}
                    onChange={(event) => setSupportReplyMessage(event.target.value)}
                    placeholder="Responder como agente..."
                  />
                  <Button
                    className="bg-velion-fuchsia px-3 py-2 text-xs text-black hover:bg-fuchsia-300"
                    onClick={() =>
                      supportTicketReplyMutation.mutate({
                        ticketId: selectedSupportTicket.id,
                        message: supportReplyMessage,
                      })
                    }
                    disabled={supportTicketReplyMutation.isPending || !supportReplyMessage.trim()}
                  >
                    Enviar
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Pagos y reconciliacion</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={paymentProviderFilter}
              onChange={(event) => setPaymentProviderFilter(event.target.value as "all" | "stripe" | "mercado_pago")}
              className="max-w-[180px]"
            >
              <option value="all">Todos providers</option>
              <option value="stripe">Stripe</option>
              <option value="mercado_pago">Mercado Pago</option>
            </Select>
            <Select
              value={paymentIntentStatusFilter}
              onChange={(event) =>
                setPaymentIntentStatusFilter(
                  event.target.value as
                    | "all"
                    | "created"
                    | "pending"
                    | "pending_webhook"
                    | "retrying"
                    | "requires_action"
                    | "succeeded"
                    | "canceled"
                    | "failed",
                )
              }
              className="max-w-[220px]"
            >
              <option value="all">Todos estados</option>
              <option value="pending_webhook">Pending webhook</option>
              <option value="retrying">Retrying</option>
              <option value="failed">Failed</option>
              <option value="succeeded">Succeeded</option>
              <option value="created">Created</option>
              <option value="pending">Pending</option>
              <option value="requires_action">Requires action</option>
              <option value="canceled">Canceled</option>
            </Select>
            <Button
              className="bg-zinc-700 px-3 py-1 text-xs"
              onClick={() => reconcilePaymentsMutation.mutate()}
              disabled={reconcilePaymentsMutation.isPending}
            >
              Reconciliar lote
            </Button>
          </div>
        </div>

        {(reconcilePaymentsMutation.data || reconcileSinglePaymentMutation.data) && (
          <p className="text-xs text-zinc-300">
            Ultima reconciliacion: probed {formatNumber(reconcilePaymentsMutation.data?.probed ?? reconcileSinglePaymentMutation.data?.probed ?? 0)}
            {" · "}succeeded {formatNumber(reconcilePaymentsMutation.data?.succeeded ?? reconcileSinglePaymentMutation.data?.succeeded ?? 0)}
            {" · "}failed {formatNumber(reconcilePaymentsMutation.data?.failed ?? reconcileSinglePaymentMutation.data?.failed ?? 0)}
            {" · "}retrying {formatNumber(reconcilePaymentsMutation.data?.retrying ?? reconcileSinglePaymentMutation.data?.retrying ?? 0)}
          </p>
        )}

        {paymentIntentsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando intents de pago...</p>}
        {(paymentIntentsQuery.data ?? []).length === 0 && <p className="text-xs text-zinc-400">Sin intents para este filtro.</p>}

        {(paymentIntentsQuery.data ?? []).map((intent) => (
          <div key={intent.id} className="space-y-2 rounded-lg bg-velion-black/50 p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {intent.provider} · {intent.status} · {formatMoneyMinor(intent.amount_minor)}
              </p>
              <p className="text-xs text-zinc-400">{new Date(intent.created_at).toLocaleString()}</p>
            </div>
            <p className="text-xs text-zinc-400">
              intent: {intent.id} · user: {intent.user?.username ? `@${intent.user.username}` : intent.user_id} · retries:{" "}
              {intent.retry_count ?? 0}
            </p>
            {intent.error_message && <p className="text-xs text-amber-400">{intent.error_message}</p>}
            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-zinc-700 px-3 py-1 text-xs"
                onClick={() => reconcileSinglePaymentMutation.mutate(intent.id)}
                disabled={reconcileSinglePaymentMutation.isPending || intent.status === "succeeded" || intent.status === "canceled"}
              >
                Reconciliar intent
              </Button>
            </div>
          </div>
        ))}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="font-semibold">Usuarios</h2>

          {usersQuery.isLoading && <p className="text-sm text-zinc-400">Cargando usuarios...</p>}

          {(usersQuery.data ?? []).map((user) => (
            <div key={user.id} className="flex items-center justify-between rounded-lg bg-velion-black/50 p-2 text-sm">
              <div>
                <Link to={getProfileRoute(user.username)} className="hover:text-velion-fuchsia">@{user.username}</Link>
                <Link to={getProfileRoute(user.username)} className="text-xs text-zinc-400 hover:text-white">
                  {user.full_name}
                </Link>
              </div>
              <Button
                className={`px-3 py-1 text-xs ${user.is_banned ? "bg-emerald-700" : "bg-red-600"}`}
                onClick={() => setPendingBanAction({ userId: user.id, nextValue: !Boolean(user.is_banned), username: user.username })}
              >
                {user.is_banned ? "Desbanear" : "Banear"}
              </Button>
            </div>
          ))}
        </Card>

        <Card className="space-y-3">
          <h2 className="font-semibold">Moderacion de reportes</h2>

          {reportsQuery.isLoading && <p className="text-sm text-zinc-400">Cargando reportes...</p>}

          {(reportsQuery.data ?? []).map((report) => (
            <div key={report.id} className="space-y-2 rounded-lg bg-velion-black/50 p-2 text-sm">
              <p className="font-medium">{report.reason}</p>
              <p className="text-xs text-zinc-400">
                {report.target_type} · {report.target_id}
              </p>
              <p className="text-xs text-zinc-400">Estado: {report.status}</p>

              <div className="flex flex-wrap gap-2">
                <Button className="bg-zinc-700 px-3 py-1 text-xs" onClick={() => reportMutation.mutate({ reportId: report.id, status: "reviewed" })}>
                  Marcar revisado
                </Button>
                <Button className="bg-zinc-700 px-3 py-1 text-xs" onClick={() => reportMutation.mutate({ reportId: report.id, status: "dismissed" })}>
                  Descartar
                </Button>
                {normalizeReportTargetType(report.target_type) === "profile" && (
                  <Button
                    className="bg-red-700 px-3 py-1 text-xs"
                    onClick={() =>
                      setPendingModerationAction({
                        reportId: report.id,
                        targetId: report.target_id,
                        targetType: "profile",
                        title: "Banear perfil reportado",
                        description: "Se bloqueara el perfil reportado y el reporte quedara como revisado.",
                        confirmLabel: "Banear perfil",
                      })
                    }
                  >
                    Banear perfil
                  </Button>
                )}
                {normalizeReportTargetType(report.target_type) === "post" && (
                  <Button
                    className="bg-red-700 px-3 py-1 text-xs"
                    onClick={() =>
                      setPendingModerationAction({
                        reportId: report.id,
                        targetId: report.target_id,
                        targetType: "post",
                        title: "Eliminar publicación reportada",
                        description: "Esta accion eliminara el post y marcara el reporte como revisado.",
                        confirmLabel: "Eliminar post",
                      })
                    }
                  >
                    Eliminar post
                  </Button>
                )}
                {normalizeReportTargetType(report.target_type) === "video" && (
                  <Button
                    className="bg-red-700 px-3 py-1 text-xs"
                    onClick={() =>
                      setPendingModerationAction({
                        reportId: report.id,
                        targetId: report.target_id,
                        targetType: "video",
                        title: "Eliminar video reportado",
                        description: "Se intentara eliminar el video en reels, VODs o posts de video.",
                        confirmLabel: "Eliminar video",
                      })
                    }
                  >
                    Eliminar video
                  </Button>
                )}
                {normalizeReportTargetType(report.target_type) === "story" && (
                  <Button
                    className="bg-red-700 px-3 py-1 text-xs"
                    onClick={() =>
                      setPendingModerationAction({
                        reportId: report.id,
                        targetId: report.target_id,
                        targetType: "story",
                        title: "Eliminar historia reportada",
                        description: "Esta accion eliminara la historia y marcara el reporte como revisado.",
                        confirmLabel: "Eliminar historia",
                      })
                    }
                  >
                    Eliminar historia
                  </Button>
                )}
                {normalizeReportTargetType(report.target_type) === "reel" && (
                  <Button
                    className="bg-red-700 px-3 py-1 text-xs"
                    onClick={() =>
                      setPendingModerationAction({
                        reportId: report.id,
                        targetId: report.target_id,
                        targetType: "reel",
                        title: "Eliminar reel reportado",
                        description: "Esta accion eliminara el reel y marcara el reporte como revisado.",
                        confirmLabel: "Eliminar reel",
                      })
                    }
                  >
                    Eliminar reel
                  </Button>
                )}
                {normalizeReportTargetType(report.target_type) === "stream" && (
                  <Button
                    className="bg-red-700 px-3 py-1 text-xs"
                    onClick={() =>
                      setPendingModerationAction({
                        reportId: report.id,
                        targetId: report.target_id,
                        targetType: "stream",
                        title: "Eliminar stream reportado",
                        description: "Esta accion eliminara el stream y marcara el reporte como revisado.",
                        confirmLabel: "Eliminar stream",
                      })
                    }
                  >
                    Eliminar stream
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      </div>

      <ConfirmModal
        open={Boolean(pendingBanAction)}
        title={pendingBanAction?.nextValue ? "Banear usuario" : "Desbanear usuario"}
        description={
          pendingBanAction
            ? `${pendingBanAction.nextValue ? "Se bloqueará" : "Se rehabilitará"} la cuenta @${pendingBanAction.username}.`
            : ""
        }
        confirmLabel={pendingBanAction?.nextValue ? "Banear" : "Desbanear"}
        danger={Boolean(pendingBanAction?.nextValue)}
        loading={banMutation.isPending}
        onClose={() => setPendingBanAction(null)}
        onConfirm={() => {
          if (!pendingBanAction) return;
          banMutation.mutate({ userId: pendingBanAction.userId, nextValue: pendingBanAction.nextValue });
          setPendingBanAction(null);
        }}
      />

      <ConfirmModal
        open={Boolean(pendingModerationAction)}
        title={pendingModerationAction?.title ?? "Accion de moderacion"}
        description={pendingModerationAction?.description ?? ""}
        confirmLabel={pendingModerationAction?.confirmLabel ?? "Confirmar"}
        danger
        loading={moderateTargetMutation.isPending}
        onClose={() => setPendingModerationAction(null)}
        onConfirm={() => {
          if (!pendingModerationAction) return;
          moderateTargetMutation.mutate(pendingModerationAction);
          setPendingModerationAction(null);
        }}
      />
    </section>
  );
}



