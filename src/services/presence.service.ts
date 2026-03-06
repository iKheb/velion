import { hasSupabaseConfig, supabase } from "@/services/supabase";

export interface PresenceState {
  user_id: string;
  is_online: boolean;
  is_typing: boolean;
  last_seen_at: string | null;
}

export const setPresenceOnline = async (): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;

  await supabase.from("presence").upsert({ user_id: user.id, is_online: true, last_seen_at: new Date().toISOString() });
};

export const setPresenceOffline = async (): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;

  await supabase.from("presence").upsert({ user_id: user.id, is_online: false, last_seen_at: new Date().toISOString() });
};

export const getPresenceByUserId = async (userId: string): Promise<PresenceState | null> => {
  if (!hasSupabaseConfig || !userId) return null;

  const { data, error } = await supabase
    .from("presence")
    .select("user_id,is_online,is_typing,last_seen_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    user_id: data.user_id as string,
    is_online: Boolean(data.is_online),
    is_typing: Boolean(data.is_typing),
    last_seen_at: (data.last_seen_at as string | null) ?? null,
  };
};

export const getPresenceByUserIds = async (userIds: string[]): Promise<Record<string, PresenceState>> => {
  if (!hasSupabaseConfig || userIds.length === 0) return {};

  const { data, error } = await supabase
    .from("presence")
    .select("user_id,is_online,is_typing,last_seen_at")
    .in("user_id", userIds);

  if (error) throw error;

  return ((data ?? []) as Array<Partial<PresenceState> & { user_id: string }>).reduce<Record<string, PresenceState>>(
    (acc, item) => {
      acc[item.user_id] = {
        user_id: item.user_id,
        is_online: Boolean(item.is_online),
        is_typing: Boolean(item.is_typing),
        last_seen_at: item.last_seen_at ?? null,
      };
      return acc;
    },
    {},
  );
};
