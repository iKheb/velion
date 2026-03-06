import { hasSupabaseConfig, supabase } from "@/services/supabase";
import { requireNonEmptyText } from "@/services/supabase-helpers";
import type { PaymentIntentRecord, Profile } from "@/types/models";
import type { SupportTicket, SupportTicketMessage } from "@/types/models";

export interface ModerationReport {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  created_at: string;
}

export interface AdminAnalyticsSummary {
  range_days: number;
  total_events: number;
  unique_users: number;
  anonymous_events: number;
  top_events: Array<{ event_name: string; count: number }>;
  daily_events: Array<{ day: string; count: number }>;
}

export interface AdminAnalyticsEvent {
  event_name: string;
  user_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface AdminAnalyticsInsights {
  range_days: number;
  current_total_events: number;
  previous_total_events: number;
  total_events_delta_percent: number | null;
  page_view_current: number;
  page_view_previous: number;
  page_view_delta_percent: number | null;
  anonymous_ratio: number;
  alerts: string[];
}

export interface AdminAlert {
  id: string;
  alert_key: string;
  message: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved";
  metadata: Record<string, unknown> | null;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncAdminAlertsResult {
  range_days: number;
  alerts_detected: number;
  alerts_upserted: number;
  alerts_resolved: number;
}

export interface SyncReportAlertsResult {
  alerts_detected: number;
  alerts_upserted: number;
  alerts_resolved: number;
  open_reports_total: number;
  stale_open_reports: number;
}

export interface AdminAlertSyncRun {
  id: string;
  range_days: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error";
  alerts_detected: number | null;
  alerts_upserted: number | null;
  alerts_resolved: number | null;
  error_message: string | null;
  created_at: string;
}

export interface AdminSupportTicket extends SupportTicket {
  requester?: Pick<Profile, "id" | "username" | "full_name" | "avatar_url"> | null;
}

export interface AdminPaymentIntentRecord extends PaymentIntentRecord {
  user_id: string;
  idempotency_key: string | null;
  provider_intent_id: string | null;
  provider_checkout_id: string | null;
  updated_at: string;
  user?: Pick<Profile, "id" | "username" | "full_name" | "avatar_url"> | null;
}

export interface ReconcileStalePaymentsResult {
  ok: boolean;
  probed: number;
  reconciled: number;
  succeeded: number;
  failed: number;
  retrying: number;
  stale_reconciliation: Record<string, unknown> | null;
  errors: Array<{ intent_id: string; error: string }>;
}

const toSingle = <T>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

export const listUsers = async (): Promise<Profile[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data as Profile[]) ?? [];
};

export const toggleUserBan = async (userId: string, nextValue: boolean): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("profiles").update({ is_banned: nextValue }).eq("id", userId);
  if (error) throw error;
};

export const listReports = async (): Promise<ModerationReport[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("reports")
    .select("id,reporter_id,target_type,target_id,reason,status,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data as ModerationReport[]) ?? [];
};

export const updateReportStatus = async (
  reportId: string,
  status: "open" | "reviewed" | "dismissed",
): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("reports").update({ status }).eq("id", reportId);
  if (error) throw error;
};

export const deletePostAsAdmin = async (postId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("posts").delete().eq("id", postId);
  if (error) throw error;
};

export const deleteStoryAsAdmin = async (storyId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("stories").delete().eq("id", storyId);
  if (error) throw error;
};

export const deleteReelAsAdmin = async (reelId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("reels").delete().eq("id", reelId);
  if (error) throw error;
};

export const deleteStreamAsAdmin = async (streamId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("streams").delete().eq("id", streamId);
  if (error) throw error;
};

export const banProfileAsAdmin = async (profileId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("profiles").update({ is_banned: true }).eq("id", profileId);
  if (error) throw error;
};

export const deleteVideoAsAdmin = async (videoId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const deleteFrom = async (table: "reels" | "stream_vods" | "posts", withPostVideoFilter = false): Promise<boolean> => {
    let query = supabase.from(table).delete().eq("id", videoId);
    if (withPostVideoFilter) {
      query = query.eq("media_type", "video");
    }
    const { data, error } = await query.select("id");
    if (error) throw error;
    return Boolean(data && data.length > 0);
  };

  if (await deleteFrom("reels")) return;
  if (await deleteFrom("stream_vods")) return;
  if (await deleteFrom("posts", true)) return;

  throw new Error("No se encontro un video eliminable con el target_id indicado.");
};

export const getAnalyticsSummary = async (rangeDays: number): Promise<AdminAnalyticsSummary> => {
  const normalizedDays = [1, 7, 30].includes(rangeDays) ? rangeDays : 7;
  if (!hasSupabaseConfig) {
    return {
      range_days: normalizedDays,
      total_events: 0,
      unique_users: 0,
      anonymous_events: 0,
      top_events: [],
      daily_events: [],
    };
  }

  const sinceDate = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("analytics_events")
    .select("event_name,user_id,created_at")
    .gte("created_at", sinceDate)
    .order("created_at", { ascending: false })
    .limit(10000);

  if (error) throw error;

  const rows = (data ?? []) as Array<{ event_name: string; user_id: string | null; created_at: string }>;
  const uniqueUsers = new Set<string>();
  let anonymousEvents = 0;
  const eventsByName = new Map<string, number>();
  const eventsByDay = new Map<string, number>();

  for (const row of rows) {
    if (row.user_id) uniqueUsers.add(row.user_id);
    else anonymousEvents += 1;

    eventsByName.set(row.event_name, (eventsByName.get(row.event_name) ?? 0) + 1);

    const day = row.created_at.slice(0, 10);
    eventsByDay.set(day, (eventsByDay.get(day) ?? 0) + 1);
  }

  return {
    range_days: normalizedDays,
    total_events: rows.length,
    unique_users: uniqueUsers.size,
    anonymous_events: anonymousEvents,
    top_events: Array.from(eventsByName.entries())
      .map(([event_name, count]) => ({ event_name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    daily_events: Array.from(eventsByDay.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
};

export const listAnalyticsEvents = async (
  rangeDays: number,
  eventNameFilter: string,
  limit = 1000,
): Promise<AdminAnalyticsEvent[]> => {
  const normalizedDays = [1, 7, 30].includes(rangeDays) ? rangeDays : 7;
  if (!hasSupabaseConfig) return [];

  const safeLimit = Math.min(Math.max(limit, 1), 5000);
  const sinceDate = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000).toISOString();
  const normalizedFilter = eventNameFilter.trim();

  let query = supabase
    .from("analytics_events")
    .select("event_name,user_id,payload,created_at")
    .gte("created_at", sinceDate)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (normalizedFilter) {
    query = query.ilike("event_name", `%${normalizedFilter}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as AdminAnalyticsEvent[]) ?? [];
};

export const getAnalyticsInsights = async (rangeDays: number): Promise<AdminAnalyticsInsights> => {
  const normalizedDays = [1, 7, 30].includes(rangeDays) ? rangeDays : 7;
  if (!hasSupabaseConfig) {
    return {
      range_days: normalizedDays,
      current_total_events: 0,
      previous_total_events: 0,
      total_events_delta_percent: null,
      page_view_current: 0,
      page_view_previous: 0,
      page_view_delta_percent: null,
      anonymous_ratio: 0,
      alerts: [],
    };
  }

  const now = Date.now();
  const windowMs = normalizedDays * 24 * 60 * 60 * 1000;
  const currentStart = new Date(now - windowMs).toISOString();
  const previousStart = new Date(now - 2 * windowMs).toISOString();

  const [currentTotalRes, previousTotalRes, currentAnonymousRes, currentPageViewRes, previousPageViewRes] = await Promise.all([
    supabase.from("analytics_events").select("id", { count: "exact", head: true }).gte("created_at", currentStart),
    supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", previousStart)
      .lt("created_at", currentStart),
    supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", currentStart)
      .is("user_id", null),
    supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", currentStart)
      .eq("event_name", "page_view"),
    supabase
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", previousStart)
      .lt("created_at", currentStart)
      .eq("event_name", "page_view"),
  ]);

  if (currentTotalRes.error) throw currentTotalRes.error;
  if (previousTotalRes.error) throw previousTotalRes.error;
  if (currentAnonymousRes.error) throw currentAnonymousRes.error;
  if (currentPageViewRes.error) throw currentPageViewRes.error;
  if (previousPageViewRes.error) throw previousPageViewRes.error;

  const currentTotalEvents = currentTotalRes.count ?? 0;
  const previousTotalEvents = previousTotalRes.count ?? 0;
  const currentAnonymousEvents = currentAnonymousRes.count ?? 0;
  const pageViewCurrent = currentPageViewRes.count ?? 0;
  const pageViewPrevious = previousPageViewRes.count ?? 0;

  const totalDeltaPercent =
    previousTotalEvents > 0 ? ((currentTotalEvents - previousTotalEvents) / previousTotalEvents) * 100 : null;
  const pageViewDeltaPercent =
    pageViewPrevious > 0 ? ((pageViewCurrent - pageViewPrevious) / pageViewPrevious) * 100 : null;
  const anonymousRatio = currentTotalEvents > 0 ? currentAnonymousEvents / currentTotalEvents : 0;

  const alerts: string[] = [];
  if (previousTotalEvents >= 50 && totalDeltaPercent !== null && totalDeltaPercent < -40) {
    alerts.push("Caida fuerte de eventos totales frente al periodo anterior.");
  }
  if (pageViewPrevious >= 30 && pageViewDeltaPercent !== null && pageViewDeltaPercent < -50) {
    alerts.push("Caida fuerte de page_view; posible problema de adquisicion o tracking.");
  }
  if (currentTotalEvents >= 50 && anonymousRatio > 0.7) {
    alerts.push("Proporcion alta de eventos anonimos; revisar sesiones/autenticacion.");
  }

  return {
    range_days: normalizedDays,
    current_total_events: currentTotalEvents,
    previous_total_events: previousTotalEvents,
    total_events_delta_percent: totalDeltaPercent,
    page_view_current: pageViewCurrent,
    page_view_previous: pageViewPrevious,
    page_view_delta_percent: pageViewDeltaPercent,
    anonymous_ratio: anonymousRatio,
    alerts,
  };
};

const toAlertKey = (rangeDays: number, message: string): string => {
  return `${rangeDays}:${message.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
};

export const listAdminAlerts = async (): Promise<AdminAlert[]> => {
  return listAdminAlertsByStatus("all");
};

export const listAdminAlertsByStatus = async (
  status: "all" | "open" | "acknowledged" | "resolved",
): Promise<AdminAlert[]> => {
  if (!hasSupabaseConfig) return [];
  let query = supabase
    .from("admin_alerts")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(100);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data as AdminAlert[]) ?? [];
};

export const syncAdminAlertsFromInsights = async (
  rangeDays: number,
  alerts: string[],
): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const now = new Date().toISOString();
  const currentKeys = alerts.map((message) => toAlertKey(rangeDays, message));

  const { data: existing, error: existingError } = await supabase
    .from("admin_alerts")
    .select("id,alert_key,status")
    .ilike("alert_key", `${rangeDays}:%`)
    .in("status", ["open", "acknowledged"]);

  if (existingError) throw existingError;

  if (alerts.length === 0) {
    const staleIds = (existing ?? []).map((item) => item.id as string);
    if (staleIds.length) {
      const { error: resolveAllError } = await supabase
        .from("admin_alerts")
        .update({ status: "resolved", updated_at: now })
        .in("id", staleIds);
      if (resolveAllError) throw resolveAllError;
    }
    return;
  }

  const rows = alerts.map((message) => ({
    alert_key: toAlertKey(rangeDays, message),
    message,
    severity: "warning",
    status: "open",
    metadata: { range_days: rangeDays },
    last_seen_at: now,
    updated_at: now,
  }));

  const { error } = await supabase.from("admin_alerts").upsert(rows, { onConflict: "alert_key" });
  if (error) throw error;

  const staleIds = (existing ?? [])
    .filter((item) => !currentKeys.includes(item.alert_key as string))
    .map((item) => item.id as string);

  if (staleIds.length) {
    const { error: resolveError } = await supabase
      .from("admin_alerts")
      .update({ status: "resolved", updated_at: now })
      .in("id", staleIds);

    if (resolveError) throw resolveError;
  }
};

export const syncAdminAlertsServer = async (rangeDays: number): Promise<SyncAdminAlertsResult> => {
  const normalizedDays = [1, 7, 30].includes(rangeDays) ? rangeDays : 7;
  if (!hasSupabaseConfig) {
    return {
      range_days: normalizedDays,
      alerts_detected: 0,
      alerts_upserted: 0,
      alerts_resolved: 0,
    };
  }

  const { data, error } = await supabase.rpc("sync_admin_alerts", { range_days: normalizedDays });
  if (error) throw error;

  const payload = (data ?? {}) as Partial<SyncAdminAlertsResult>;
  return {
    range_days: payload.range_days ?? normalizedDays,
    alerts_detected: payload.alerts_detected ?? 0,
    alerts_upserted: payload.alerts_upserted ?? 0,
    alerts_resolved: payload.alerts_resolved ?? 0,
  };
};

export const syncReportAlertsServer = async (): Promise<SyncReportAlertsResult> => {
  if (!hasSupabaseConfig) {
    return {
      alerts_detected: 0,
      alerts_upserted: 0,
      alerts_resolved: 0,
      open_reports_total: 0,
      stale_open_reports: 0,
    };
  }

  const { data, error } = await supabase.rpc("sync_report_alerts");
  if (error) throw error;

  const payload = (data ?? {}) as Partial<SyncReportAlertsResult>;
  return {
    alerts_detected: payload.alerts_detected ?? 0,
    alerts_upserted: payload.alerts_upserted ?? 0,
    alerts_resolved: payload.alerts_resolved ?? 0,
    open_reports_total: payload.open_reports_total ?? 0,
    stale_open_reports: payload.stale_open_reports ?? 0,
  };
};

export const listAdminAlertSyncRuns = async (limit = 25): Promise<AdminAlertSyncRun[]> => {
  if (!hasSupabaseConfig) return [];
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const { data, error } = await supabase
    .from("admin_alert_sync_runs")
    .select("id,range_days,started_at,finished_at,status,alerts_detected,alerts_upserted,alerts_resolved,error_message,created_at")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  return (data as AdminAlertSyncRun[]) ?? [];
};

export const acknowledgeAdminAlert = async (alertId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { error } = await supabase
    .from("admin_alerts")
    .update({
      status: "acknowledged",
      acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", alertId);

  if (error) throw error;
};

export const reopenAdminAlert = async (alertId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase
    .from("admin_alerts")
    .update({
      status: "open",
      acknowledged_by: null,
      acknowledged_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", alertId);

  if (error) throw error;
};

export const resolveAdminAlert = async (alertId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase
    .from("admin_alerts")
    .update({
      status: "resolved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", alertId);

  if (error) throw error;
};

export const listSupportTicketsAdmin = async (
  status: "all" | SupportTicket["status"] = "all",
  limit = 200,
): Promise<AdminSupportTicket[]> => {
  if (!hasSupabaseConfig) return [];

  const safeLimit = Math.min(Math.max(limit, 1), 500);
  let query = supabase
    .from("support_tickets")
    .select(
      "id,requester_id,subject,category,priority,status,description,contact_email,created_at,updated_at,closed_at,requester:profiles(id,username,full_name,avatar_url)",
    )
    .order("updated_at", { ascending: false })
    .limit(safeLimit);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    requester_id: row.requester_id as string,
    subject: row.subject as string,
    category: row.category as SupportTicket["category"],
    priority: row.priority as SupportTicket["priority"],
    status: row.status as SupportTicket["status"],
    description: row.description as string,
    contact_email: (row.contact_email as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    closed_at: (row.closed_at as string | null) ?? null,
    requester: (toSingle(row.requester as AdminSupportTicket["requester"] | AdminSupportTicket["requester"][]) ??
      null) as AdminSupportTicket["requester"],
  }));
};

export const listSupportTicketMessagesAdmin = async (ticketId: string): Promise<SupportTicketMessage[]> => {
  if (!hasSupabaseConfig || !ticketId) return [];

  const { data, error } = await supabase
    .from("support_ticket_messages")
    .select("id,ticket_id,sender_id,sender_role,message,created_at,sender:profiles(id,username,full_name,avatar_url)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>).map((item) => ({
    id: item.id as string,
    ticket_id: item.ticket_id as string,
    sender_id: (item.sender_id as string | null) ?? null,
    sender_role: item.sender_role as SupportTicketMessage["sender_role"],
    message: item.message as string,
    created_at: item.created_at as string,
    sender: (toSingle(item.sender as SupportTicketMessage["sender"] | SupportTicketMessage["sender"][]) ??
      null) as SupportTicketMessage["sender"],
  }));
};

export const updateSupportTicketAdminStatus = async (
  ticketId: string,
  status: SupportTicket["status"],
): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const nowIso = new Date().toISOString();
  const closedAt = status === "resolved" || status === "closed" ? nowIso : null;

  const { error } = await supabase
    .from("support_tickets")
    .update({ status, updated_at: nowIso, closed_at: closedAt })
    .eq("id", ticketId);

  if (error) throw error;
};

export const addSupportTicketMessageAsAdmin = async (
  ticketId: string,
  message: string,
): Promise<SupportTicketMessage> => {
  if (!hasSupabaseConfig) {
    throw new Error("Supabase no configurado");
  }

  const normalizedMessage = requireNonEmptyText(message, "Debes escribir un mensaje.");
  const user = (await supabase.auth.getUser()).data.user;
  if (!user?.id) {
    throw new Error("No autenticado");
  }

  const { data, error } = await supabase
    .from("support_ticket_messages")
    .insert({
      ticket_id: ticketId,
      sender_id: user.id,
      sender_role: "agent",
      message: normalizedMessage,
    })
    .select("id,ticket_id,sender_id,sender_role,message,created_at,sender:profiles(id,username,full_name,avatar_url)")
    .single();

  if (error) throw error;

  const { error: touchError } = await supabase
    .from("support_tickets")
    .update({ updated_at: new Date().toISOString(), status: "waiting_user", closed_at: null })
    .eq("id", ticketId);

  if (touchError) throw touchError;

  return {
    id: data.id as string,
    ticket_id: data.ticket_id as string,
    sender_id: (data.sender_id as string | null) ?? null,
    sender_role: data.sender_role as SupportTicketMessage["sender_role"],
    message: data.message as string,
    created_at: data.created_at as string,
    sender: (toSingle(data.sender as SupportTicketMessage["sender"] | SupportTicketMessage["sender"][]) ??
      null) as SupportTicketMessage["sender"],
  };
};

export const listPaymentIntentsAdmin = async (params?: {
  status?: "all" | AdminPaymentIntentRecord["status"];
  provider?: "all" | "stripe" | "mercado_pago";
  limit?: number;
}): Promise<AdminPaymentIntentRecord[]> => {
  if (!hasSupabaseConfig) return [];

  const status = params?.status ?? "all";
  const provider = params?.provider ?? "all";
  const safeLimit = Math.min(Math.max(params?.limit ?? 100, 1), 500);

  let query = supabase
    .from("payment_intents")
    .select(
      "id,user_id,provider,status,amount_minor,currency,package_credits,error_message,created_at,updated_at,settled_at,metadata,retry_count,last_retry_at,next_retry_at,last_webhook_received_at,idempotency_key,provider_intent_id,provider_checkout_id,user:profiles(id,username,full_name,avatar_url)",
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (status !== "all") query = query.eq("status", status);
  if (provider !== "all") query = query.eq("provider", provider);

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    user_id: row.user_id as string,
    provider: row.provider as AdminPaymentIntentRecord["provider"],
    status: row.status as AdminPaymentIntentRecord["status"],
    amount_minor: Number(row.amount_minor ?? 0),
    currency: row.currency as "USD",
    package_credits: Number(row.package_credits ?? 0),
    error_message: (row.error_message as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    settled_at: (row.settled_at as string | null) ?? null,
    metadata: (row.metadata as AdminPaymentIntentRecord["metadata"]) ?? null,
    retry_count: Number(row.retry_count ?? 0),
    last_retry_at: (row.last_retry_at as string | null) ?? null,
    next_retry_at: (row.next_retry_at as string | null) ?? null,
    last_webhook_received_at: (row.last_webhook_received_at as string | null) ?? null,
    idempotency_key: (row.idempotency_key as string | null) ?? null,
    provider_intent_id: (row.provider_intent_id as string | null) ?? null,
    provider_checkout_id: (row.provider_checkout_id as string | null) ?? null,
    user: (toSingle(row.user as AdminPaymentIntentRecord["user"] | AdminPaymentIntentRecord["user"][]) ??
      null) as AdminPaymentIntentRecord["user"],
  }));
};

export const reconcileStalePaymentsAdmin = async (params?: {
  intentId?: string;
  minutes?: number;
  limit?: number;
  maxRetries?: number;
}): Promise<ReconcileStalePaymentsResult> => {
  if (!hasSupabaseConfig) {
    return {
      ok: true,
      probed: 0,
      reconciled: 0,
      succeeded: 0,
      failed: 0,
      retrying: 0,
      stale_reconciliation: null,
      errors: [],
    };
  }

  const body: Record<string, unknown> = {};
  if (params?.intentId) body.intent_id = params.intentId;
  if (typeof params?.minutes === "number") body.minutes = params.minutes;
  if (typeof params?.limit === "number") body.limit = params.limit;
  if (typeof params?.maxRetries === "number") body.max_retries = params.maxRetries;

  const { data, error } = await supabase.functions.invoke("reconcile-stale-payments", { body });
  if (error) throw error;

  const payload = (data ?? {}) as Partial<ReconcileStalePaymentsResult>;
  return {
    ok: Boolean(payload.ok),
    probed: Number(payload.probed ?? 0),
    reconciled: Number(payload.reconciled ?? 0),
    succeeded: Number(payload.succeeded ?? 0),
    failed: Number(payload.failed ?? 0),
    retrying: Number(payload.retrying ?? 0),
    stale_reconciliation: (payload.stale_reconciliation as Record<string, unknown> | null) ?? null,
    errors: (payload.errors ?? []) as Array<{ intent_id: string; error: string }>,
  };
};
