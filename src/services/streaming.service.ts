import { mockStreams } from "@/lib/mock";
import { enforceRateLimit } from "@/lib/rate-limit";
import { validateSocialTextRules } from "@/lib/social-text-rules";
import { assertCanInteractWithUserContent, canViewUserContent, validateMentionsAllowed } from "@/services/account-settings.service";
import { trackEventFireAndForget } from "@/services/analytics.service";
import { createNotification, createNotificationsBulk } from "@/services/notifications.service";
import { hasSupabaseConfig, supabase } from "@/services/supabase";
import type {
  Clip,
  LiveMessage,
  Stream,
  StreamDashboardSummary,
  StreamDonation,
  StreamGoal,
  StreamPoll,
  StreamPollVote,
  StreamRaid,
  StreamSchedule,
  StreamVod,
  StreamVodComment,
  StreamVodChapter,
  StreamVodReaction,
  StreamVodShare,
} from "@/types/models";

const senderProfileCache = new Map<string, LiveMessage["sender_profile"]>();

const resolveViewerId = async (): Promise<string | null> => (await supabase.auth.getUser()).data.user?.id ?? null;

const filterVisibleStreams = async (streams: Stream[], viewerId: string | null): Promise<Stream[]> => {
  if (!streams.length) return streams;
  const visible = await Promise.all(
    streams.map(async (stream) => ((await canViewUserContent(stream.streamer_id, viewerId, "streams")) ? stream : null)),
  );
  return visible.filter((stream): stream is Stream => Boolean(stream));
};

const filterVisibleVods = async (vods: StreamVod[], viewerId: string | null): Promise<StreamVod[]> => {
  if (!vods.length) return vods;
  const visible = await Promise.all(
    vods.map(async (vod) => ((await canViewUserContent(vod.owner_id, viewerId, "streams")) ? vod : null)),
  );
  return visible.filter((vod): vod is StreamVod => Boolean(vod));
};

export const getStreams = async (): Promise<Stream[]> => {
  if (!hasSupabaseConfig) return mockStreams;
  const viewerId = await resolveViewerId();
  const { data, error } = await supabase
    .from("streams")
    .select("*")
    .order("promoted_until", { ascending: false, nullsFirst: false })
    .order("promotion_credits", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return filterVisibleStreams((data as Stream[]) ?? [], viewerId);
};

export const getStreamsByStreamer = async (streamerId: string): Promise<Stream[]> => {
  if (!streamerId) return [];
  if (!hasSupabaseConfig) return mockStreams.filter((stream) => stream.streamer_id === streamerId);

  const viewerId = await resolveViewerId();
  const { data, error } = await supabase
    .from("streams")
    .select("*")
    .eq("streamer_id", streamerId)
    .order("promoted_until", { ascending: false, nullsFirst: false })
    .order("promotion_credits", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return filterVisibleStreams((data as Stream[]) ?? [], viewerId);
};

type StreamSort = "recent" | "viewers";

export interface StreamDiscoverFilters {
  query?: string;
  category?: string;
  liveOnly?: boolean;
  sort?: StreamSort;
}

export const discoverStreams = async (filters: StreamDiscoverFilters = {}): Promise<Stream[]> => {
  const { query, category, liveOnly = false, sort = "viewers" } = filters;
  if (!hasSupabaseConfig) {
    return mockStreams
      .filter((stream) => (liveOnly ? stream.is_live : true))
      .filter((stream) => (category ? stream.category.toLowerCase() === category.toLowerCase() : true))
      .filter((stream) => {
        if (!query?.trim()) return true;
        const value = query.trim().toLowerCase();
        return stream.title.toLowerCase().includes(value) || stream.category.toLowerCase().includes(value);
      })
      .sort((a, b) => (sort === "viewers" ? b.viewer_count - a.viewer_count : b.created_at.localeCompare(a.created_at)));
  }

  const viewerId = await resolveViewerId();
  let request = supabase.from("streams").select("*");
  if (liveOnly) request = request.eq("is_live", true);
  if (query?.trim()) request = request.ilike("title", `%${query.trim()}%`);
  if (category?.trim()) request = request.ilike("category", category.trim());

  request = request.order("promoted_until", { ascending: false, nullsFirst: false }).order("promotion_credits", { ascending: false });
  request = sort === "viewers" ? request.order("viewer_count", { ascending: false }) : request.order("created_at", { ascending: false });
  const { data, error } = await request.limit(50);

  if (error) throw error;
  return filterVisibleStreams((data as Stream[]) ?? [], viewerId);
};

export const getStreamById = async (streamId: string): Promise<Stream | null> => {
  if (!hasSupabaseConfig) return mockStreams.find((item) => item.id === streamId) ?? null;
  const viewerId = await resolveViewerId();
  const { data, error } = await supabase.from("streams").select("*").eq("id", streamId).maybeSingle();
  if (error) throw error;
  const stream = (data as Stream | null) ?? null;
  if (!stream) return null;
  const canView = await canViewUserContent(stream.streamer_id, viewerId, "streams");
  return canView ? stream : null;
};

export const startStream = async (title: string, category: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  await validateMentionsAllowed(title, "streams", user.id);

  const streamKeyHint = `vl_live_${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabase
    .from("streams")
    .insert({
      streamer_id: user.id,
      title,
      category,
      is_live: true,
      stream_key_hint: streamKeyHint,
    })
    .select("id")
    .single();

  if (error) throw error;

  const { data: followers, error: followersError } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", user.id);

  if (followersError) throw followersError;

  const followerIds = (followers ?? []).map((item) => item.follower_id as string);
  await createNotificationsBulk(followerIds, "live", data.id as string);
  trackEventFireAndForget("stream_start", { stream_id: data.id, category });
};

export const stopStream = async (streamId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("streams").update({ is_live: false }).eq("id", streamId);
  if (error) throw error;
  trackEventFireAndForget("stream_stop", { stream_id: streamId });
};

export const getLiveMessages = async (streamId: string): Promise<LiveMessage[]> => {
  if (!hasSupabaseConfig) return [];

  const { data, error } = await supabase
    .from("live_messages")
    .select("id,stream_id,sender_id,content,created_at,profiles:sender_id(id,username,full_name,avatar_url,is_premium,is_verified)")
    .eq("stream_id", streamId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((item) => {
    const profilesRaw = item.profiles;
    const profileValue = Array.isArray(profilesRaw) ? profilesRaw[0] : profilesRaw;

    return {
      id: item.id as string,
      stream_id: item.stream_id as string,
      sender_id: item.sender_id as string,
      content: item.content as string,
      created_at: item.created_at as string,
      sender_profile: (profileValue as LiveMessage["sender_profile"] | null) ?? null,
    } satisfies LiveMessage;
  });
};

export const sendLiveMessage = async (streamId: string, content: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error("No autenticado");

  const trimmed = content.trim();
  if (!trimmed) return;
  enforceRateLimit({
    key: `stream:message:${userId}:${streamId}`,
    maxRequests: 25,
    windowMs: 30_000,
    message: "Estas enviando mensajes muy rapido. Espera unos segundos.",
  });
  await validateMentionsAllowed(trimmed, "streams", userId);

  const { error } = await supabase.from("live_messages").insert({
    stream_id: streamId,
    sender_id: userId,
    content: trimmed,
  });

  if (error) throw error;
  trackEventFireAndForget("stream_chat_message", { stream_id: streamId, length: trimmed.length });
};

export const reportLiveMessage = async (params: {
  streamId: string;
  messageId: string;
  reportedUserId: string;
  reason: string;
}): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const trimmedReason = params.reason.trim();
  if (!trimmedReason) throw new Error("Describe el motivo del reporte");
  enforceRateLimit({
    key: `report:stream_message:${me}`,
    maxRequests: 5,
    windowMs: 60_000,
    message: "Has enviado muchos reportes en poco tiempo. Espera un minuto.",
  });

  const { error } = await supabase.from("stream_reports").insert({
    stream_id: params.streamId,
    message_id: params.messageId,
    reporter_id: me,
    reported_user_id: params.reportedUserId,
    reason: trimmedReason,
  });
  if (error) throw error;

  trackEventFireAndForget("stream_report_create", { stream_id: params.streamId, message_id: params.messageId });
};

export const banUserFromStream = async (params: {
  streamId: string;
  userId: string;
  reason?: string;
  expiresAt?: string | null;
}): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");
  if (me === params.userId) throw new Error("No puedes banearte a ti mismo");

  const { error } = await supabase.from("stream_bans").upsert({
    stream_id: params.streamId,
    user_id: params.userId,
    banned_by: me,
    reason: params.reason?.trim() || null,
    expires_at: params.expiresAt ?? null,
  });
  if (error) throw error;

  trackEventFireAndForget("stream_ban_create", { stream_id: params.streamId, target_user_id: params.userId });
};

export const unbanUserFromStream = async (streamId: string, userId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("stream_bans").delete().eq("stream_id", streamId).eq("user_id", userId);
  if (error) throw error;
  trackEventFireAndForget("stream_ban_remove", { stream_id: streamId, target_user_id: userId });
};

export const subscribeLiveMessages = (streamId: string, onMessage: (message: LiveMessage) => void) => {
  const channel = supabase
    .channel(`live_messages:${streamId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "live_messages", filter: `stream_id=eq.${streamId}` },
      async (payload) => {
        const raw = payload.new as LiveMessage;
        let senderProfile = senderProfileCache.get(raw.sender_id) ?? null;

        if (!senderProfile) {
          const { data } = await supabase
            .from("profiles")
            .select("id,username,full_name,avatar_url,is_premium,is_verified")
            .eq("id", raw.sender_id)
            .maybeSingle();
          senderProfile = (data as LiveMessage["sender_profile"] | null) ?? null;
          if (senderProfile) senderProfileCache.set(raw.sender_id, senderProfile);
        }

        onMessage({ ...raw, sender_profile: senderProfile });
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const subscribeStreams = (onChange: () => void) => {
  const channel = supabase
    .channel("streams_updates")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "streams" }, () => onChange())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "streams" }, () => onChange())
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "streams" }, () => onChange())
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const getClipsByStream = async (streamId: string): Promise<Clip[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("clips")
    .select("*")
    .eq("stream_id", streamId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data as Clip[]) ?? [];
};

export const getTrendingClips = async (limit = 20): Promise<Clip[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("clips")
    .select("*")
    .eq("status", "published")
    .order("views_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));

  if (error) throw error;
  return (data as Clip[]) ?? [];
};

export const createClip = async (
  streamId: string,
  clipUrl: string,
  title?: string,
  options?: { startSeconds?: number | null; endSeconds?: number | null; thumbnailUrl?: string | null },
): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error("No autenticado");

  const url = clipUrl.trim();
  if (!url) throw new Error("Ingresa la URL del clip");

  const { error } = await supabase.from("clips").insert({
    stream_id: streamId,
    author_id: userId,
    title: title?.trim() || null,
    clip_url: url,
    start_seconds: options?.startSeconds ?? null,
    end_seconds: options?.endSeconds ?? null,
    duration_seconds:
      options?.startSeconds != null && options?.endSeconds != null && options.endSeconds > options.startSeconds
        ? options.endSeconds - options.startSeconds
        : null,
    thumbnail_url: options?.thumbnailUrl ?? null,
    status: "published",
  });

  if (error) throw error;
  trackEventFireAndForget("clip_create", { stream_id: streamId, has_title: Boolean(title?.trim()) });
};

export const incrementClipViews = async (clipId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { data: clip, error: clipError } = await supabase.from("clips").select("views_count").eq("id", clipId).maybeSingle();
  if (clipError) throw clipError;

  const current = Number((clip as { views_count?: number } | null)?.views_count ?? 0);
  const { error } = await supabase.from("clips").update({ views_count: current + 1 }).eq("id", clipId);
  if (error) throw error;
};

export const toggleClipLike = async (clipId: string): Promise<boolean> => {
  if (!hasSupabaseConfig) return true;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const { data: existing, error: existingError } = await supabase
    .from("clip_reactions")
    .select("id")
    .eq("clip_id", clipId)
    .eq("user_id", me)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const { error } = await supabase.from("clip_reactions").delete().eq("clip_id", clipId).eq("user_id", me);
    if (error) throw error;
    return false;
  }

  const { error } = await supabase.from("clip_reactions").insert({ clip_id: clipId, user_id: me, reaction: "like" });
  if (error) throw error;
  return true;
};

export const sendStreamDonation = async (streamId: string, amountCents: number, message?: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const normalizedAmount = Math.round(amountCents);
  if (normalizedAmount <= 0) throw new Error("Monto invalido.");
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error("No autenticado");
  enforceRateLimit({
    key: `stream:donation:${userId}:${streamId}`,
    maxRequests: 10,
    windowMs: 60_000,
    message: "Has enviado demasiadas donaciones en poco tiempo. Espera un minuto.",
  });

  const { error } = await supabase.rpc("send_stream_donation_with_credits", {
    stream_id_input: streamId,
    amount_credits_input: normalizedAmount,
    message_input: message?.trim() || null,
  });
  if (error) throw error;

  trackEventFireAndForget("stream_donation", { stream_id: streamId, amount_credits: normalizedAmount });
};

export const getStreamDonations = async (streamId: string): Promise<StreamDonation[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("stream_donations")
    .select("*")
    .eq("stream_id", streamId)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as StreamDonation[]) ?? [];
};

export const getStreamDashboardSummary = async (): Promise<StreamDashboardSummary> => {
  if (!hasSupabaseConfig) {
    return {
      streams_total: 2,
      live_now: 1,
      total_messages: 242,
      total_clips: 18,
      total_donations_cents: 55400,
      total_subscribers: 128,
    };
  }

  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const { data: myStreams, error: streamsError } = await supabase.from("streams").select("id,is_live").eq("streamer_id", me);
  if (streamsError) throw streamsError;

  const streams = (myStreams ?? []) as Array<{ id: string; is_live: boolean }>;
  const streamIds = streams.map((stream) => stream.id);
  const liveNow = streams.filter((stream) => stream.is_live).length;

  if (!streamIds.length) {
    return {
      streams_total: 0,
      live_now: 0,
      total_messages: 0,
      total_clips: 0,
      total_donations_cents: 0,
      total_subscribers: 0,
    };
  }

  const [messagesRes, clipsRes, donationsRes, subsRes] = await Promise.all([
    supabase.from("live_messages").select("id", { count: "exact", head: true }).in("stream_id", streamIds),
    supabase.from("clips").select("id", { count: "exact", head: true }).in("stream_id", streamIds),
    supabase.from("stream_donations").select("amount_cents,stream_id").in("stream_id", streamIds).eq("status", "paid"),
    supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("creator_id", me).eq("status", "active"),
  ]);

  if (messagesRes.error) throw messagesRes.error;
  if (clipsRes.error) throw clipsRes.error;
  if (donationsRes.error) throw donationsRes.error;
  if (subsRes.error) throw subsRes.error;

  const totalDonations = ((donationsRes.data ?? []) as Array<{ amount_cents: number }>).reduce(
    (acc, item) => acc + Number(item.amount_cents || 0),
    0,
  );

  return {
    streams_total: streams.length,
    live_now: liveNow,
    total_messages: messagesRes.count ?? 0,
    total_clips: clipsRes.count ?? 0,
    total_donations_cents: totalDonations,
    total_subscribers: subsRes.count ?? 0,
  };
};

export const getUpcomingSchedules = async (): Promise<StreamSchedule[]> => {
  if (!hasSupabaseConfig) return [];
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("stream_schedules")
    .select("*")
    .gte("scheduled_for", nowIso)
    .eq("status", "scheduled")
    .order("scheduled_for", { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data as StreamSchedule[]) ?? [];
};

export const createStreamSchedule = async (params: {
  title: string;
  category?: string;
  description?: string;
  scheduledFor: string;
}): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const title = params.title.trim();
  if (!title) throw new Error("Titulo requerido");
  if (!params.scheduledFor) throw new Error("Fecha requerida");

  const { error } = await supabase.from("stream_schedules").insert({
    streamer_id: me,
    title,
    category: params.category?.trim() || null,
    description: params.description?.trim() || null,
    scheduled_for: new Date(params.scheduledFor).toISOString(),
    status: "scheduled",
  });
  if (error) throw error;

  const { data: followers, error: followersError } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", me);
  if (followersError) throw followersError;

  const followerIds = ((followers ?? []) as Array<{ follower_id: string }>).map((row) => row.follower_id);
  await createNotificationsBulk(followerIds, "stream_schedule");

  trackEventFireAndForget("stream_schedule_create", { category: params.category?.trim() || null });
};

export const setScheduleReminder = async (scheduleId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const { error } = await supabase.from("stream_schedule_reminders").upsert({ schedule_id: scheduleId, user_id: me });
  if (error) throw error;
  trackEventFireAndForget("stream_schedule_reminder_set", { schedule_id: scheduleId });
};

export const removeScheduleReminder = async (scheduleId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const { error } = await supabase.from("stream_schedule_reminders").delete().eq("schedule_id", scheduleId).eq("user_id", me);
  if (error) throw error;
};

export const getMyScheduleReminderIds = async (): Promise<string[]> => {
  if (!hasSupabaseConfig) return [];
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) return [];

  const { data, error } = await supabase.from("stream_schedule_reminders").select("schedule_id").eq("user_id", me);
  if (error) throw error;
  return ((data ?? []) as Array<{ schedule_id: string }>).map((row) => row.schedule_id);
};

export const createStreamRaid = async (fromStreamId: string, toStreamId: string, message?: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");
  if (fromStreamId === toStreamId) throw new Error("No puedes raidear el mismo stream");

  const { error } = await supabase.from("stream_raids").insert({
    from_stream_id: fromStreamId,
    to_stream_id: toStreamId,
    raider_id: me,
    message: message?.trim() || null,
  });
  if (error) throw error;

  const { data: targetStream, error: targetError } = await supabase
    .from("streams")
    .select("streamer_id")
    .eq("id", toStreamId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (targetStream?.streamer_id) {
    await createNotification(targetStream.streamer_id as string, "raid", toStreamId);
  }

  trackEventFireAndForget("stream_raid_create", { from_stream_id: fromStreamId, to_stream_id: toStreamId });
};

export const getRecentRaids = async (streamId: string): Promise<StreamRaid[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("stream_raids")
    .select("*")
    .or(`to_stream_id.eq.${streamId},from_stream_id.eq.${streamId}`)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data as StreamRaid[]) ?? [];
};

export const getStreamGoals = async (streamId: string): Promise<StreamGoal[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("stream_goals")
    .select("*")
    .eq("stream_id", streamId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as StreamGoal[]) ?? [];
};

export const createStreamGoal = async (params: {
  streamId: string;
  title: string;
  targetValue: number;
  metric?: StreamGoal["metric"];
}): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const title = params.title.trim();
  const target = Math.round(params.targetValue);
  if (!title) throw new Error("Titulo requerido");
  if (target <= 0) throw new Error("Meta invalida");

  const { error } = await supabase.from("stream_goals").insert({
    stream_id: params.streamId,
    owner_id: me,
    title,
    target_value: target,
    metric: params.metric ?? "custom",
    status: "active",
  });
  if (error) throw error;
  trackEventFireAndForget("stream_goal_create", { stream_id: params.streamId, target_value: target });
};

export const contributeToStreamGoal = async (goalId: string, amount: number): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const normalizedAmount = Math.round(amount);
  if (normalizedAmount <= 0) throw new Error("Aporte invalido");

  const { data: goal, error: goalError } = await supabase
    .from("stream_goals")
    .select("id,current_value,target_value,status")
    .eq("id", goalId)
    .maybeSingle();
  if (goalError) throw goalError;
  if (!goal) throw new Error("Meta no encontrada");
  if ((goal as { status: string }).status !== "active") throw new Error("La meta no esta activa");

  const nextValue = Number((goal as { current_value: number }).current_value ?? 0) + normalizedAmount;
  const targetValue = Number((goal as { target_value: number }).target_value ?? 0);
  const nextStatus = nextValue >= targetValue ? "completed" : "active";

  const [contributionRes, updateRes] = await Promise.all([
    supabase.from("stream_goal_contributions").insert({ goal_id: goalId, user_id: me, amount: normalizedAmount }),
    supabase.from("stream_goals").update({ current_value: nextValue, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", goalId),
  ]);
  if (contributionRes.error) throw contributionRes.error;
  if (updateRes.error) throw updateRes.error;

  trackEventFireAndForget("stream_goal_contribution", { goal_id: goalId, amount: normalizedAmount });
};

const parsePollOptions = (options: unknown): string[] => {
  if (!Array.isArray(options)) return [];
  return options.map((item) => String(item)).filter((item) => item.trim().length > 0);
};

export const getStreamPolls = async (streamId: string): Promise<StreamPoll[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("stream_polls")
    .select("*")
    .eq("stream_id", streamId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>).map((poll) => ({
    id: String(poll.id),
    stream_id: String(poll.stream_id),
    owner_id: String(poll.owner_id),
    question: String(poll.question),
    options: parsePollOptions(poll.options),
    status: String(poll.status) as StreamPoll["status"],
    created_at: String(poll.created_at),
    closed_at: (poll.closed_at as string | null) ?? null,
  }));
};

export const createStreamPoll = async (params: { streamId: string; question: string; options: string[] }): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const question = params.question.trim();
  const options = params.options.map((item) => item.trim()).filter(Boolean);
  if (!question) throw new Error("Pregunta requerida");
  if (options.length < 2) throw new Error("Minimo dos opciones");

  const { error } = await supabase.from("stream_polls").insert({
    stream_id: params.streamId,
    owner_id: me,
    question,
    options,
    status: "open",
  });
  if (error) throw error;
  trackEventFireAndForget("stream_poll_create", { stream_id: params.streamId, options_count: options.length });
};

export const closeStreamPoll = async (pollId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase
    .from("stream_polls")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", pollId);
  if (error) throw error;
};

export const voteStreamPoll = async (pollId: string, optionIndex: number): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");
  if (optionIndex < 0) throw new Error("Opcion invalida");

  const { error } = await supabase.from("stream_poll_votes").upsert({
    poll_id: pollId,
    user_id: me,
    option_index: optionIndex,
  });
  if (error) throw error;
  trackEventFireAndForget("stream_poll_vote", { poll_id: pollId, option_index: optionIndex });
};

export const getPollVotes = async (pollId: string): Promise<StreamPollVote[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase.from("stream_poll_votes").select("*").eq("poll_id", pollId);
  if (error) throw error;
  return (data as StreamPollVote[]) ?? [];
};

export const getMyStreamVods = async (): Promise<StreamVod[]> => {
  if (!hasSupabaseConfig) return [];
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) return [];

  const { data, error } = await supabase.from("stream_vods").select("*").eq("owner_id", me).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data as StreamVod[]) ?? [];
};

export const getStreamVodsByOwner = async (ownerId: string): Promise<StreamVod[]> => {
  if (!ownerId) return [];
  if (!hasSupabaseConfig) return [];

  const me = await resolveViewerId();

  let request = supabase
    .from("stream_vods")
    .select("*")
    .eq("owner_id", ownerId)
    .order("promoted_until", { ascending: false, nullsFirst: false })
    .order("promotion_credits", { ascending: false })
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (me !== ownerId) {
    request = request.eq("status", "ready").in("visibility", ["public", "unlisted"]);
  }

  const { data, error } = await request;
  if (error) throw error;
  return filterVisibleVods((data as StreamVod[]) ?? [], me);
};

export const getStreamVodById = async (vodId: string): Promise<StreamVod | null> => {
  if (!vodId) return null;
  if (!hasSupabaseConfig) return null;
  const viewerId = await resolveViewerId();

  const { data, error } = await supabase.from("stream_vods").select("*").eq("id", vodId).maybeSingle();
  if (error) throw error;
  const vod = (data as StreamVod | null) ?? null;
  if (!vod) return null;
  const canView = await canViewUserContent(vod.owner_id, viewerId, "streams");
  return canView ? vod : null;
};

export const searchStreamVods = async (query: string, limit = 20): Promise<StreamVod[]> => {
  const normalized = query.trim();
  if (!normalized) return [];
  if (!hasSupabaseConfig) return [];

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const viewerId = await resolveViewerId();
  const { data, error } = await supabase
    .from("stream_vods")
    .select("*")
    .eq("status", "ready")
    .in("visibility", ["public", "unlisted"])
    .or(`title.ilike.%${normalized}%,description.ilike.%${normalized}%`)
    .order("promoted_until", { ascending: false, nullsFirst: false })
    .order("promotion_credits", { ascending: false })
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  return filterVisibleVods((data as StreamVod[]) ?? [], viewerId);
};

export const incrementStreamVodViews = async (vodId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!vodId) return;

  const { data: vod, error: fetchError } = await supabase.from("stream_vods").select("views_count").eq("id", vodId).maybeSingle();
  if (fetchError) throw fetchError;

  const currentViews = Number((vod as { views_count?: number } | null)?.views_count ?? 0);
  const { error } = await supabase.from("stream_vods").update({ views_count: currentViews + 1 }).eq("id", vodId);
  if (error) throw error;
};

export const getStreamVodReactionsSummary = async (vodId: string): Promise<{ likes: number; dislikes: number }> => {
  if (!hasSupabaseConfig) return { likes: 0, dislikes: 0 };
  if (!vodId) return { likes: 0, dislikes: 0 };

  const { data, error } = await supabase.from("stream_vod_reactions").select("reaction").eq("vod_id", vodId);
  if (error) throw error;

  let likes = 0;
  let dislikes = 0;
  ((data ?? []) as Array<{ reaction: "like" | "dislike" }>).forEach((row) => {
    if (row.reaction === "like") likes += 1;
    if (row.reaction === "dislike") dislikes += 1;
  });

  return { likes, dislikes };
};

export const getMyStreamVodReaction = async (vodId: string): Promise<StreamVodReaction["reaction"] | null> => {
  if (!hasSupabaseConfig) return null;
  if (!vodId) return null;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) return null;

  const { data, error } = await supabase
    .from("stream_vod_reactions")
    .select("reaction")
    .eq("vod_id", vodId)
    .eq("user_id", me)
    .maybeSingle();
  if (error) throw error;
  return ((data as { reaction?: "like" | "dislike" } | null)?.reaction ?? null) as StreamVodReaction["reaction"] | null;
};

export const setStreamVodReaction = async (vodId: string, reaction: StreamVodReaction["reaction"]): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");
  if (!vodId) throw new Error("Video invalido");
  const { data: vodOwner, error: vodOwnerError } = await supabase.from("stream_vods").select("owner_id").eq("id", vodId).maybeSingle();
  if (vodOwnerError) throw vodOwnerError;
  if (!vodOwner) throw new Error("Video no encontrado");
  await assertCanInteractWithUserContent(vodOwner.owner_id as string, me, "streams", "like");

  const { data: existing, error: existingError } = await supabase
    .from("stream_vod_reactions")
    .select("id,reaction")
    .eq("vod_id", vodId)
    .eq("user_id", me)
    .maybeSingle();
  if (existingError) throw existingError;

  const currentReaction = (existing as { reaction?: "like" | "dislike" } | null)?.reaction ?? null;
  if (currentReaction === reaction) {
    const { error } = await supabase.from("stream_vod_reactions").delete().eq("vod_id", vodId).eq("user_id", me);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("stream_vod_reactions")
    .upsert({ vod_id: vodId, user_id: me, reaction }, { onConflict: "vod_id,user_id" });
  if (error) throw error;
};

export const getStreamVodComments = async (vodId: string): Promise<StreamVodComment[]> => {
  if (!hasSupabaseConfig) return [];
  if (!vodId) return [];

  const { data, error } = await supabase
    .from("stream_vod_comments")
    .select("id,vod_id,author_id,content,created_at,profiles:author_id(id,username,full_name,avatar_url,is_premium,is_verified)")
    .eq("vod_id", vodId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>).map((item) => {
    const profilesRaw = item.profiles;
    const profileValue = Array.isArray(profilesRaw) ? profilesRaw[0] : profilesRaw;

    return {
      id: item.id as string,
      vod_id: item.vod_id as string,
      author_id: item.author_id as string,
      content: item.content as string,
      created_at: item.created_at as string,
      author: (profileValue as StreamVodComment["author"] | null) ?? undefined,
    } satisfies StreamVodComment;
  });
};

export const getStreamVodSharesSummary = async (vodId: string): Promise<number> => {
  if (!hasSupabaseConfig) return 0;
  if (!vodId) return 0;

  const { count, error } = await supabase
    .from("stream_vod_shares")
    .select("id", { count: "exact", head: true })
    .eq("vod_id", vodId);
  if (error) throw error;
  return count ?? 0;
};

export const getMyStreamVodShare = async (vodId: string): Promise<boolean> => {
  if (!hasSupabaseConfig) return false;
  if (!vodId) return false;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) return false;

  const { data, error } = await supabase
    .from("stream_vod_shares")
    .select("id")
    .eq("vod_id", vodId)
    .eq("user_id", me)
    .maybeSingle();
  if (error) throw error;
  return Boolean((data as { id?: string } | null)?.id);
};

export const toggleStreamVodShare = async (vodId: string): Promise<boolean> => {
  if (!hasSupabaseConfig) return false;
  if (!vodId) throw new Error("Video invalido");
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");
  const { data: vodOwner, error: vodOwnerError } = await supabase.from("stream_vods").select("owner_id").eq("id", vodId).maybeSingle();
  if (vodOwnerError) throw vodOwnerError;
  if (!vodOwner) throw new Error("Video no encontrado");
  await assertCanInteractWithUserContent(vodOwner.owner_id as string, me, "streams", "share");

  const { data: existing, error: existingError } = await supabase
    .from("stream_vod_shares")
    .select("id")
    .eq("vod_id", vodId)
    .eq("user_id", me)
    .maybeSingle();
  if (existingError) throw existingError;

  if ((existing as { id?: string } | null)?.id) {
    const { error } = await supabase.from("stream_vod_shares").delete().eq("vod_id", vodId).eq("user_id", me);
    if (error) throw error;
    return false;
  }

  const { error } = await supabase
    .from("stream_vod_shares")
    .insert({ vod_id: vodId, user_id: me } satisfies Pick<StreamVodShare, "vod_id" | "user_id">);
  if (error) throw error;
  return true;
};

export const retweetStreamVod = async (vodId: string, rawComment?: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!vodId) throw new Error("Video invalido");

  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error("No autenticado");

  const { data: existing, error: existingError } = await supabase
    .from("stream_vod_shares")
    .select("id")
    .eq("vod_id", vodId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw existingError;
  if ((existing as { id?: string } | null)?.id) throw new Error("Ya compartiste este video.");

  const { data: vod, error: vodError } = await supabase
    .from("stream_vods")
    .select("id,owner_id,title,description,vod_url,thumbnail_url")
    .eq("id", vodId)
    .maybeSingle();
  if (vodError) throw vodError;
  if (!vod) throw new Error("Video no encontrado");
  await assertCanInteractWithUserContent((vod as { owner_id: string }).owner_id, userId, "streams", "share");

  const comment = validateSocialTextRules((rawComment ?? "").trim());
  if (comment.length > 300) throw new Error("El comentario no puede superar 300 caracteres.");

  const title = ((vod as { title?: string }).title ?? "Video").trim();
  const description = ((vod as { description?: string | null }).description ?? "").trim();
  const vodUrl = ((vod as { vod_url?: string }).vod_url ?? "").trim();
  const appVodPath = `/streaming/video/${vodId}`;
  const content = [comment, `Compartio video: ${title}`, description, appVodPath]
    .filter((part) => part.length > 0)
    .join("\n\n");
  await validateMentionsAllowed(content, "streams", userId);

  const { data: createdPost, error: postError } = await supabase
    .from("posts")
    .insert({
      author_id: userId,
      content,
      media_url: vodUrl || null,
      media_type: (vodUrl ? "video" : null) as "video" | null,
      shared_target_type: "stream_vod",
      shared_target_id: vodId,
    })
    .select("id")
    .maybeSingle();
  if (postError) throw postError;

  const { error: shareError } = await supabase.from("stream_vod_shares").insert({ vod_id: vodId, user_id: userId });
  if (shareError) throw shareError;

  const ownerId = (vod as { owner_id?: string | null }).owner_id ?? null;
  if (ownerId) {
    await createNotification(ownerId, "share", vodId);
  }

  trackEventFireAndForget("stream_vod_retweet", { vod_id: vodId, shared_post_id: (createdPost as { id?: string } | null)?.id ?? null });
};

export const addStreamVodComment = async (vodId: string, content: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!vodId) throw new Error("Video invalido");
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const cleaned = validateSocialTextRules(content.trim());
  if (!cleaned) throw new Error("Comentario requerido");
  if (cleaned.length > 300) throw new Error("El comentario no puede superar 300 caracteres.");
  const { data: vodOwner, error: vodOwnerError } = await supabase.from("stream_vods").select("owner_id").eq("id", vodId).maybeSingle();
  if (vodOwnerError) throw vodOwnerError;
  if (!vodOwner) throw new Error("Video no encontrado");
  await assertCanInteractWithUserContent(vodOwner.owner_id as string, me, "streams", "comment");
  await validateMentionsAllowed(cleaned, "streams", me);

  const { error } = await supabase.from("stream_vod_comments").insert({
    vod_id: vodId,
    author_id: me,
    content: cleaned,
  });
  if (error) throw error;
};

export const createStreamVod = async (params: {
  streamId?: string | null;
  title: string;
  description?: string | null;
  vodUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  visibility?: StreamVod["visibility"];
}): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");

  const title = params.title.trim();
  const vodUrl = params.vodUrl.trim();
  if (!title) throw new Error("Titulo requerido");
  if (!vodUrl) throw new Error("URL VOD requerida");
  const description = params.description?.trim()
    ? validateSocialTextRules(params.description.trim())
    : null;
  await validateMentionsAllowed(`${title}\n${description ?? ""}`, "streams", me);
  if (description && description.length > 300) {
    throw new Error("La descripcion no puede superar 300 caracteres.");
  }

  const { data: createdVod, error } = await supabase
    .from("stream_vods")
    .insert({
      stream_id: params.streamId ?? null,
      owner_id: me,
      title,
      description,
      vod_url: vodUrl,
      thumbnail_url: params.thumbnailUrl?.trim() || null,
      duration_seconds: params.durationSeconds ?? null,
      visibility: params.visibility ?? "public",
      status: "ready",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) throw error;

  if ((params.visibility ?? "public") !== "private" && (createdVod as { id?: string } | null)?.id) {
    const { data: followers, error: followersError } = await supabase
      .from("follows")
      .select("follower_id")
      .eq("following_id", me);
    if (followersError) throw followersError;

    const followerIds = ((followers ?? []) as Array<{ follower_id: string }>).map((row) => row.follower_id);
    await createNotificationsBulk(followerIds, "stream_vod", (createdVod as { id: string }).id);
  }

  trackEventFireAndForget("stream_vod_create", { stream_id: params.streamId ?? null, visibility: params.visibility ?? "public" });
};

export const updateStreamVodVisibility = async (vodId: string, visibility: StreamVod["visibility"]): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const { error } = await supabase.from("stream_vods").update({ visibility, updated_at: new Date().toISOString() }).eq("id", vodId);
  if (error) throw error;
};

export const updateStreamVodInfo = async (vodId: string, params: { title: string; description?: string | null }): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!vodId) throw new Error("Video invalido");

  const title = params.title.trim();
  if (!title) throw new Error("Titulo requerido");
  const description = params.description?.trim() ? validateSocialTextRules(params.description.trim()) : null;
  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) throw new Error("No autenticado");
  await validateMentionsAllowed(`${title}\n${description ?? ""}`, "streams", me);
  if (description && description.length > 300) throw new Error("La descripcion no puede superar 300 caracteres.");

  const { error } = await supabase
    .from("stream_vods")
    .update({ title, description, updated_at: new Date().toISOString() })
    .eq("id", vodId);
  if (error) throw error;
};

export const deleteStreamVod = async (vodId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!vodId) throw new Error("Video invalido");
  const { error } = await supabase.from("stream_vods").delete().eq("id", vodId);
  if (error) throw error;
};

export const reportStreamVod = async (vodId: string, reason: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!vodId) throw new Error("Video invalido");

  const reporterId = (await supabase.auth.getUser()).data.user?.id;
  if (!reporterId) throw new Error("No autenticado");

  const cleanedReason = validateSocialTextRules(reason.trim());
  if (!cleanedReason) throw new Error("Describe el motivo del reporte");
  if (cleanedReason.length > 400) throw new Error("El reporte no puede superar 400 caracteres.");
  enforceRateLimit({
    key: `report:stream_vod:${reporterId}`,
    maxRequests: 5,
    windowMs: 60_000,
    message: "Has enviado muchos reportes en poco tiempo. Espera un minuto.",
  });

  const { error } = await supabase.from("reports").insert({
    reporter_id: reporterId,
    target_type: "video",
    target_id: vodId,
    reason: cleanedReason,
    status: "open",
  });
  if (error) throw error;
};

export const getStreamVodChapters = async (vodId: string): Promise<StreamVodChapter[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("stream_vod_chapters")
    .select("*")
    .eq("vod_id", vodId)
    .order("start_seconds", { ascending: true });
  if (error) throw error;
  return (data as StreamVodChapter[]) ?? [];
};

export const createStreamVodChapter = async (vodId: string, title: string, startSeconds: number): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const normalizedTitle = title.trim();
  const normalizedStart = Math.max(0, Math.floor(startSeconds));
  if (!normalizedTitle) throw new Error("Titulo de capitulo requerido");

  const { error } = await supabase.from("stream_vod_chapters").insert({
    vod_id: vodId,
    title: normalizedTitle,
    start_seconds: normalizedStart,
  });
  if (error) throw error;
};
