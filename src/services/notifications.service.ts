import { mockNotifications } from "@/lib/mock";
import { hasSupabaseConfig, supabase } from "@/services/supabase";
import type { NotificationItem } from "@/types/models";

type NotificationActorRow = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  is_premium?: boolean | null;
  is_verified?: boolean | null;
};

type NotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string;
  event_type: string;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
  actor: NotificationActorRow | NotificationActorRow[] | null;
};

const normalizeNotification = (row: NotificationRow): NotificationItem => ({
  id: row.id,
  recipient_id: row.recipient_id,
  actor_id: row.actor_id,
  event_type: row.event_type,
  entity_id: row.entity_id,
  read_at: row.read_at,
  created_at: row.created_at,
  actor: (() => {
    const actor = Array.isArray(row.actor) ? (row.actor[0] ?? null) : (row.actor ?? null);
    if (!actor) return null;
    return {
      ...actor,
      is_premium: actor.is_premium ?? undefined,
      is_verified: actor.is_verified ?? undefined,
    };
  })(),
});

export const getNotifications = async (): Promise<NotificationItem[]> => {
  if (!hasSupabaseConfig) return mockNotifications;
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id,recipient_id,actor_id,event_type,entity_id,read_at,created_at,actor:profiles!notifications_actor_id_fkey(id,username,full_name,avatar_url)",
    )
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return ((data ?? []) as NotificationRow[]).map(normalizeNotification);
};

export const getNotificationById = async (notificationId: string): Promise<NotificationItem | null> => {
  if (!hasSupabaseConfig) return null;

  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id,recipient_id,actor_id,event_type,entity_id,read_at,created_at,actor:profiles!notifications_actor_id_fkey(id,username,full_name,avatar_url)",
    )
    .eq("id", notificationId)
    .maybeSingle();

  if (error) throw error;
  return data ? normalizeNotification(data as NotificationRow) : null;
};

export const createNotification = async (
  recipientId: string,
  eventType: string,
  entityId?: string,
): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const actorId = (await supabase.auth.getUser()).data.user?.id;
  if (!actorId || actorId === recipientId) return;

  const { error } = await supabase.from("notifications").insert({
    recipient_id: recipientId,
    actor_id: actorId,
    event_type: eventType,
    entity_id: entityId ?? null,
  });

  if (error) throw error;
};

export const createNotificationsBulk = async (
  recipientIds: string[],
  eventType: string,
  entityId?: string,
): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const actorId = (await supabase.auth.getUser()).data.user?.id;
  if (!actorId) return;

  const uniqueRecipients = Array.from(new Set(recipientIds.filter((id) => id && id !== actorId)));
  if (!uniqueRecipients.length) return;

  const payload = uniqueRecipients.map((recipientId) => ({
    recipient_id: recipientId,
    actor_id: actorId,
    event_type: eventType,
    entity_id: entityId ?? null,
  }));

  const { error } = await supabase.from("notifications").insert(payload);
  if (error) throw error;
};

export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId);

  if (error) throw error;
};

export const markAllNotificationsAsRead = async (): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) throw error;
};

export const getUnreadNotificationsCount = async (): Promise<number> => {
  if (!hasSupabaseConfig) return 0;
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return 0;

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) throw error;
  return count ?? 0;
};

export const subscribeNotifications = (userId: string, onNotification: (item: NotificationItem) => void) => {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
      (payload) => onNotification(payload.new as NotificationItem),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const subscribeNotificationsChanges = (userId: string, onChange: () => void) => {
  const channel = supabase
    .channel(`notifications_changes:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
      () => onChange(),
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
      () => onChange(),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};
