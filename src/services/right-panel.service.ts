import { hasSupabaseConfig, supabase } from "@/services/supabase";
import { getStreams } from "@/services/streaming.service";

export interface LiveStreamWidgetItem {
  id: string;
  title: string;
  viewerCount: number;
}

export interface ActiveFriendWidgetItem {
  id: string;
  username: string;
  fullName: string;
  statusLabel: string;
}

export interface TrendWidgetItem {
  hashtag: string;
  count: number;
}

const fallbackLiveStreams: LiveStreamWidgetItem[] = [
  { id: "stream-1", title: "Velion Arena", viewerCount: 120 },
  { id: "stream-2", title: "Co-op Friday", viewerCount: 56 },
];

const fallbackActiveFriends: ActiveFriendWidgetItem[] = [
  { id: "friend-1", username: "NovaWolf", fullName: "NovaWolf", statusLabel: "En linea" },
  { id: "friend-2", username: "RiftQueen", fullName: "RiftQueen", statusLabel: "En partida" },
  { id: "friend-3", username: "KiloAce", fullName: "KiloAce", statusLabel: "Escribiendo..." },
];

const fallbackTrends: TrendWidgetItem[] = [];

const getStatusLabel = (entry: { is_online?: boolean; is_typing?: boolean } | undefined): string => {
  if (!entry) return "Activo recientemente";
  if (entry.is_typing) return "Escribiendo...";
  if (entry.is_online) return "En linea";
  return "Activo recientemente";
};

export const getLiveStreamWidget = async (): Promise<LiveStreamWidgetItem[]> => {
  if (!hasSupabaseConfig) return fallbackLiveStreams;

  const streams = await getStreams();
  const liveStreams = streams
    .filter((stream) => stream.is_live)
    .sort((a, b) => b.viewer_count - a.viewer_count)
    .slice(0, 7)
    .map((stream) => ({
      id: stream.id,
      title: stream.title,
      viewerCount: stream.viewer_count,
    }));

  return liveStreams;
};

export const getActiveFriendsWidget = async (): Promise<ActiveFriendWidgetItem[]> => {
  if (!hasSupabaseConfig) return fallbackActiveFriends;

  const me = (await supabase.auth.getUser()).data.user?.id;
  if (!me) return [];

  const { data: friendships, error: friendshipsError } = await supabase
    .from("friendships")
    .select("requester_id,addressee_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`);
  if (friendshipsError) throw friendshipsError;

  const friendIds = Array.from(
    new Set(
      ((friendships ?? []) as Array<{ requester_id: string; addressee_id: string }>).map((row) =>
        row.requester_id === me ? row.addressee_id : row.requester_id,
      ),
    ),
  );
  if (!friendIds.length) return [];

  const [profilesResult, presenceResult] = await Promise.all([
    supabase.from("profiles").select("id,username,full_name").in("id", friendIds),
    supabase.from("presence").select("user_id,is_online,is_typing").in("user_id", friendIds),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (presenceResult.error) throw presenceResult.error;

  const presenceMap = new Map(
    ((presenceResult.data ?? []) as Array<{ user_id: string; is_online?: boolean; is_typing?: boolean }>).map((entry) => [
      entry.user_id,
      entry,
    ]),
  );

  return ((profilesResult.data ?? []) as Array<{ id: string; username: string; full_name: string }>)
    .map((profile) => {
      const presenceEntry = presenceMap.get(profile.id);
      return {
        id: profile.id,
        username: profile.username,
        fullName: profile.full_name,
        statusLabel: getStatusLabel(presenceEntry),
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, 6);
};

export const getTrendWidget = async (): Promise<TrendWidgetItem[]> => {
  if (!hasSupabaseConfig) return fallbackTrends;

  const [postsResult, storiesResult] = await Promise.all([
    supabase
      .from("posts")
      .select("content")
      .ilike("content", "%#%")
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("stories")
      .select("description")
      .gt("expires_at", new Date().toISOString())
      .ilike("description", "%#%")
      .order("created_at", { ascending: false })
      .limit(150),
  ]);
  if (postsResult.error) throw postsResult.error;
  if (storiesResult.error) throw storiesResult.error;

  const counter = new Map<string, number>();
  const hashtagRegex = /(^|\s)#([\p{L}\p{N}_]+)/gu;

  ((postsResult.data ?? []) as Array<{ content?: string | null }>).forEach((row) => {
    const uniqueTags = new Set<string>();
    const matches = Array.from((row.content ?? "").matchAll(hashtagRegex));
    matches.forEach((match) => {
      const tag = `#${(match[2] ?? "").toLowerCase()}`;
      if (!tag || tag === "#") return;
      uniqueTags.add(tag);
    });
    uniqueTags.forEach((tag) => counter.set(tag, (counter.get(tag) ?? 0) + 1));
  });

  ((storiesResult.data ?? []) as Array<{ description?: string | null }>).forEach((row) => {
    const uniqueTags = new Set<string>();
    const matches = Array.from((row.description ?? "").matchAll(hashtagRegex));
    matches.forEach((match) => {
      const tag = `#${(match[2] ?? "").toLowerCase()}`;
      if (!tag || tag === "#") return;
      uniqueTags.add(tag);
    });
    uniqueTags.forEach((tag) => counter.set(tag, (counter.get(tag) ?? 0) + 1));
  });

  const trends = Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([hashtag, count]) => ({ hashtag, count }));

  return trends.length ? trends : fallbackTrends;
};
