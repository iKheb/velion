import { trackEventFireAndForget } from "@/services/analytics.service";
import { createNotification } from "@/services/notifications.service";
import { hasSupabaseConfig, supabase } from "@/services/supabase";
import { validateSocialTextRules } from "@/lib/social-text-rules";
import { enforceRateLimit } from "@/lib/rate-limit";

export interface RelationStats {
  friends: number;
  followers: number;
  following: number;
  subscribers: number;
  subscribed: number;
}

export interface RelationStatus {
  isFollowing: boolean;
  isSubscribed: boolean;
  hasFriendship: boolean;
  incomingFriendRequestId: string | null;
  outgoingFriendRequestId: string | null;
  isBlockedByMe: boolean;
}

export interface SocialFriend {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

export interface IncomingFriendRequest {
  friendship_id: string;
  requester: SocialFriend;
  created_at: string;
}

export interface SuggestedProfile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  mutual_friends_count: number;
  follows_you: boolean;
  friendship_state: "none" | "pending_outgoing" | "pending_incoming" | "friends";
  incoming_friendship_id: string | null;
}

export interface BlockedProfile {
  block_id: string;
  blocked_id: string;
  blocked_username: string;
  blocked_full_name: string;
  blocked_avatar_url: string | null;
  blocked_at: string;
}

const getMe = async (): Promise<string | null> => {
  const me = (await supabase.auth.getUser()).data.user?.id;
  return me ?? null;
};

const isProfileBlocksMissing = (error: unknown): boolean => {
  const message = String((error as { message?: string })?.message ?? "");
  const code = String((error as { code?: string })?.code ?? "");
  return code === "PGRST205" || /profile_blocks/i.test(message);
};

export const sendFriendRequest = async (addresseeId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const requesterId = await getMe();
  if (!requesterId) return;

  const { data, error } = await supabase
    .from("friendships")
    .insert({ requester_id: requesterId, addressee_id: addresseeId, status: "pending" })
    .select("id")
    .single();

  if (error) throw error;
  await createNotification(addresseeId, "friend_request", data.id as string);
  trackEventFireAndForget("friend_request_send", { target_user_id: addresseeId });
};

export const acceptFriendRequest = async (friendshipId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const { data: friendship, error: getError } = await supabase
    .from("friendships")
    .select("requester_id,addressee_id")
    .eq("id", friendshipId)
    .maybeSingle();

  if (getError) throw getError;

  const { error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
  if (error) throw error;

  if (friendship?.requester_id) {
    await createNotification(friendship.requester_id as string, "friend_accept", friendshipId);
  }
  trackEventFireAndForget("friend_request_accept", { friendship_id: friendshipId });
};

export const declineFriendRequest = async (friendshipId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const { error } = await supabase.from("friendships").update({ status: "declined" }).eq("id", friendshipId);
  if (error) throw error;

  trackEventFireAndForget("friend_request_decline", { friendship_id: friendshipId });
};

export const followUser = async (followingId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const followerId = await getMe();
  if (!followerId) return;

  const { error } = await supabase.from("follows").upsert({ follower_id: followerId, following_id: followingId });
  if (error) throw error;

  await createNotification(followingId, "follow");
  trackEventFireAndForget("follow_create", { target_user_id: followingId });
};

export const unfollowUser = async (followingId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  const followerId = await getMe();
  if (!followerId) return;

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", followerId)
    .eq("following_id", followingId);

  if (error) throw error;
  trackEventFireAndForget("follow_remove", { target_user_id: followingId });
};

export const subscribeToCreator = async (creatorId: string): Promise<void> => {
  if (!hasSupabaseConfig) throw new Error("La conexion con Supabase no esta configurada.");
  const userId = await getMe();
  if (!userId) throw new Error("Debes iniciar sesion para suscribirte.");
  if (!creatorId) throw new Error("Perfil invalido");
  if (creatorId === userId) throw new Error("No puedes suscribirte a tu propio perfil");
  enforceRateLimit({
    key: `subscription:create:${userId}:${creatorId}`,
    maxRequests: 3,
    windowMs: 60_000,
    message: "Demasiados intentos de suscripcion. Espera un minuto.",
  });

  const { error } = await supabase.rpc("subscribe_to_creator_with_credits", {
    creator_id_input: creatorId,
  });

  if (error) throw error;

  // A failed notification should not rollback the successful paid subscription UX.
  try {
    await createNotification(creatorId, "subscription");
  } catch {
    // noop
  }
  trackEventFireAndForget("subscription_create", { creator_id: creatorId });
};

export const unsubscribeFromCreator = async (creatorId: string): Promise<void> => {
  if (!hasSupabaseConfig) throw new Error("La conexion con Supabase no esta configurada.");
  const userId = await getMe();
  if (!userId) throw new Error("Debes iniciar sesion para cancelar la suscripcion.");

  const { error } = await supabase
    .from("subscriptions")
    .delete()
    .eq("subscriber_id", userId)
    .eq("creator_id", creatorId);

  if (error) throw error;
  trackEventFireAndForget("subscription_remove", { creator_id: creatorId });
};

export const removeFriend = async (targetUserId: string): Promise<void> => {
  if (!hasSupabaseConfig) throw new Error("La conexion con Supabase no esta configurada.");
  const userId = await getMe();
  if (!userId) throw new Error("Debes iniciar sesion para eliminar amigos.");
  if (!targetUserId) throw new Error("Perfil invalido");
  if (targetUserId === userId) throw new Error("No puedes eliminarte como amigo");

  const { error } = await supabase
    .from("friendships")
    .delete()
    .or(
      `and(requester_id.eq.${userId},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${userId})`,
    );

  if (error) throw error;
  trackEventFireAndForget("friend_remove", { target_user_id: targetUserId });
};

export const reportProfile = async (profileId: string, reason: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!profileId) throw new Error("Perfil invalido");

  const reporterId = await getMe();
  if (!reporterId) throw new Error("No autenticado");
  if (reporterId === profileId) throw new Error("No puedes reportar tu propio perfil");

  const cleanedReason = validateSocialTextRules(reason.trim());
  if (!cleanedReason) throw new Error("Describe el motivo del reporte");
  if (cleanedReason.length > 400) throw new Error("El reporte no puede superar 400 caracteres.");
  enforceRateLimit({
    key: `report:profile:${reporterId}`,
    maxRequests: 5,
    windowMs: 60_000,
    message: "Has enviado muchos reportes en poco tiempo. Espera un minuto.",
  });

  const { error } = await supabase.from("reports").insert({
    reporter_id: reporterId,
    target_type: "profile",
    target_id: profileId,
    reason: cleanedReason,
    status: "open",
  });

  if (error) throw error;
  trackEventFireAndForget("profile_report_create", { profile_id: profileId });
};

export const blockProfile = async (targetUserId: string): Promise<void> => {
  if (!hasSupabaseConfig) throw new Error("La conexion con Supabase no esta configurada.");
  const me = await getMe();
  if (!me) throw new Error("Debes iniciar sesion para banear perfiles.");
  if (!targetUserId) throw new Error("Perfil invalido");
  if (targetUserId === me) throw new Error("No puedes banearte a ti mismo");

  const { error } = await supabase.rpc("block_profile_user", { target_user_id: targetUserId });
  if (error) throw error;

  trackEventFireAndForget("profile_block_create", { target_user_id: targetUserId });
};

export const unblockProfile = async (targetUserId: string): Promise<void> => {
  if (!hasSupabaseConfig) throw new Error("La conexion con Supabase no esta configurada.");
  const me = await getMe();
  if (!me) throw new Error("Debes iniciar sesion para desbanear perfiles.");
  if (!targetUserId) throw new Error("Perfil invalido");

  const { error } = await supabase.rpc("unblock_profile_user", { target_user_id: targetUserId });
  if (error) throw error;

  trackEventFireAndForget("profile_block_remove", { target_user_id: targetUserId });
};

export const listBlockedProfiles = async (): Promise<BlockedProfile[]> => {
  if (!hasSupabaseConfig) return [];
  const me = await getMe();
  if (!me) return [];

  const { data, error } = await supabase
    .from("profile_blocks")
    .select("id,blocked_id,created_at,blocked:profiles!profile_blocks_blocked_id_fkey(id,username,full_name,avatar_url)")
    .eq("blocker_id", me)
    .order("created_at", { ascending: false });

  if (error) {
    if (isProfileBlocksMissing(error)) return [];
    throw error;
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const blocked = row.blocked as Record<string, unknown> | null;
      if (!blocked?.id) return null;
      return {
        block_id: String(row.id),
        blocked_id: String(blocked.id),
        blocked_username: String(blocked.username ?? ""),
        blocked_full_name: String(blocked.full_name ?? blocked.username ?? ""),
        blocked_avatar_url: (blocked.avatar_url as string | null) ?? null,
        blocked_at: String(row.created_at),
      } satisfies BlockedProfile;
    })
    .filter((item): item is BlockedProfile => Boolean(item));
};

export const getProfileStats = async (userId: string): Promise<RelationStats> => {
  if (!hasSupabaseConfig) {
    return { friends: 188, followers: 2040, following: 392, subscribers: 128, subscribed: 64 };
  }

  const [friendsCount, followersCount, followingCount, subscribersCount, subscribedCount] = await Promise.all([
    supabase
      .from("friendships")
      .select("id", { count: "exact", head: true })
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", userId),
    supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", userId),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("creator_id", userId)
      .eq("status", "active"),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("subscriber_id", userId)
      .eq("status", "active"),
  ]);

  if (friendsCount.error) throw friendsCount.error;
  if (followersCount.error) throw followersCount.error;
  if (followingCount.error) throw followingCount.error;
  if (subscribersCount.error) throw subscribersCount.error;
  if (subscribedCount.error) throw subscribedCount.error;

  return {
    friends: friendsCount.count ?? 0,
    followers: followersCount.count ?? 0,
    following: followingCount.count ?? 0,
    subscribers: subscribersCount.count ?? 0,
    subscribed: subscribedCount.count ?? 0,
  };
};

export const getRelationStatus = async (targetUserId: string): Promise<RelationStatus> => {
  if (!hasSupabaseConfig) {
    return {
      isFollowing: false,
      isSubscribed: false,
      hasFriendship: false,
      incomingFriendRequestId: null,
      outgoingFriendRequestId: null,
      isBlockedByMe: false,
    };
  }

  const me = await getMe();
  if (!me || me === targetUserId) {
    return {
      isFollowing: false,
      isSubscribed: false,
      hasFriendship: false,
      incomingFriendRequestId: null,
      outgoingFriendRequestId: null,
      isBlockedByMe: false,
    };
  }

  const [followRes, subRes, friendshipRes, blockRes] = await Promise.all([
    supabase
      .from("follows")
      .select("id")
      .eq("follower_id", me)
      .eq("following_id", targetUserId)
      .maybeSingle(),
    supabase
      .from("subscriptions")
      .select("id")
      .eq("subscriber_id", me)
      .eq("creator_id", targetUserId)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("friendships")
      .select("id,status,requester_id,addressee_id,created_at")
      .or(
        `and(requester_id.eq.${me},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${me})`,
      )
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("profile_blocks")
      .select("id")
      .eq("blocker_id", me)
      .eq("blocked_id", targetUserId)
      .maybeSingle(),
  ]);

  if (followRes.error) throw followRes.error;
  if (subRes.error) throw subRes.error;
  if (friendshipRes.error) throw friendshipRes.error;
  if (blockRes.error && !isProfileBlocksMissing(blockRes.error)) throw blockRes.error;

  const friendshipRows = (friendshipRes.data ?? []) as Array<{
    id: string;
    status: string;
    requester_id: string;
    addressee_id: string;
  }>;
  const acceptedRow = friendshipRows.find((row) => row.status === "accepted");
  const incomingPendingRow = friendshipRows.find((row) => row.status === "pending" && row.requester_id === targetUserId);
  const outgoingPendingRow = friendshipRows.find((row) => row.status === "pending" && row.requester_id === me);

  return {
    isFollowing: Boolean(followRes.data),
    isSubscribed: Boolean(subRes.data),
    hasFriendship: Boolean(acceptedRow),
    incomingFriendRequestId: incomingPendingRow?.id ?? null,
    outgoingFriendRequestId: outgoingPendingRow?.id ?? null,
    isBlockedByMe: Boolean(blockRes.data),
  };
};

export const listFriends = async (userId: string): Promise<SocialFriend[]> => {
  if (!hasSupabaseConfig) return [];

  const { data: friendships, error: friendshipsError } = await supabase
    .from("friendships")
    .select("requester_id,addressee_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (friendshipsError) throw friendshipsError;

  const friendIds = Array.from(
    new Set(
      ((friendships ?? []) as Array<{ requester_id: string; addressee_id: string }>).map((row) =>
        row.requester_id === userId ? row.addressee_id : row.requester_id,
      ),
    ),
  );

  if (!friendIds.length) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,username,full_name,avatar_url")
    .in("id", friendIds);

  if (profilesError) throw profilesError;
  return (profiles as SocialFriend[]) ?? [];
};

export const listIncomingFriendRequests = async (): Promise<IncomingFriendRequest[]> => {
  if (!hasSupabaseConfig) return [];
  const me = await getMe();
  if (!me) return [];

  const { data: requests, error: requestsError } = await supabase
    .from("friendships")
    .select("id,requester_id,created_at")
    .eq("addressee_id", me)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  if (requestsError) throw requestsError;
  const typedRequests = (requests ?? []) as Array<{ id: string; requester_id: string; created_at: string }>;
  if (!typedRequests.length) return [];

  const requesterIds = Array.from(new Set(typedRequests.map((request) => request.requester_id)));
  const { data: requesters, error: requestersError } = await supabase
    .from("profiles")
    .select("id,username,full_name,avatar_url")
    .in("id", requesterIds);

  if (requestersError) throw requestersError;
  const byId = new Map<string, SocialFriend>(
    ((requesters ?? []) as SocialFriend[]).map((requester) => [requester.id, requester]),
  );

  return typedRequests
    .map((request) => {
      const requester = byId.get(request.requester_id);
      if (!requester) return null;
      return {
        friendship_id: request.id,
        requester,
        created_at: request.created_at,
      } satisfies IncomingFriendRequest;
    })
    .filter((item): item is IncomingFriendRequest => Boolean(item));
};

export const listSuggestedProfiles = async (limit = 6): Promise<SuggestedProfile[]> => {
  if (!hasSupabaseConfig) return [];
  const me = await getMe();
  if (!me) return [];

  const { data: followRows, error: followsError } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", me);

  if (followsError) throw followsError;
  const followingIds = new Set(((followRows ?? []) as Array<{ following_id: string }>).map((row) => row.following_id));
  followingIds.add(me);

  const { data: myFriendRows, error: myFriendRowsError } = await supabase
    .from("friendships")
    .select("requester_id,addressee_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`);

  if (myFriendRowsError) throw myFriendRowsError;
  const myFriendIds = new Set(
    ((myFriendRows ?? []) as Array<{ requester_id: string; addressee_id: string }>).map((row) =>
      row.requester_id === me ? row.addressee_id : row.requester_id,
    ),
  );

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,username,full_name,avatar_url,bio,created_at")
    .order("created_at", { ascending: false })
    .limit(80);

  if (profilesError) throw profilesError;
  const available = ((profiles ?? []) as Array<SuggestedProfile & { created_at?: string }>).filter(
    (profile) => !followingIds.has(profile.id),
  );
  if (!available.length) return [];

  const candidateIds = available.map((profile) => profile.id);
  const { data: followsYouRows, error: followsYouError } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("following_id", me)
    .in("follower_id", candidateIds);

  if (followsYouError) throw followsYouError;
  const followsYouIds = new Set(((followsYouRows ?? []) as Array<{ follower_id: string }>).map((row) => row.follower_id));

  const [outgoingFriendshipsRes, incomingFriendshipsRes] = await Promise.all([
    supabase
      .from("friendships")
      .select("id,requester_id,addressee_id,status")
      .eq("requester_id", me)
      .in("addressee_id", candidateIds),
    supabase
      .from("friendships")
      .select("id,requester_id,addressee_id,status")
      .eq("addressee_id", me)
      .in("requester_id", candidateIds),
  ]);

  if (outgoingFriendshipsRes.error) throw outgoingFriendshipsRes.error;
  if (incomingFriendshipsRes.error) throw incomingFriendshipsRes.error;
  const friendshipRows = [
    ...((outgoingFriendshipsRes.data ?? []) as Array<{ id: string; requester_id: string; addressee_id: string; status: string }>),
    ...((incomingFriendshipsRes.data ?? []) as Array<{ id: string; requester_id: string; addressee_id: string; status: string }>),
  ];
  const friendshipByCandidate = new Map<
    string,
    { state: "none" | "pending_outgoing" | "pending_incoming" | "friends"; incoming_friendship_id: string | null }
  >();

  for (const row of friendshipRows) {
    const candidateId = row.requester_id === me ? row.addressee_id : row.requester_id;
    if (!candidateIds.includes(candidateId)) continue;

    if (row.status === "accepted") {
      friendshipByCandidate.set(candidateId, { state: "friends", incoming_friendship_id: null });
      continue;
    }

    if (row.status === "pending") {
      if (row.requester_id === me) {
        friendshipByCandidate.set(candidateId, { state: "pending_outgoing", incoming_friendship_id: null });
      } else {
        friendshipByCandidate.set(candidateId, { state: "pending_incoming", incoming_friendship_id: row.id });
      }
    }
  }

  const myFriendArray = Array.from(myFriendIds);
  let mutualByCandidate = new Map<string, number>();

  if (candidateIds.length && myFriendArray.length) {
    const [q1, q2] = await Promise.all([
      supabase
        .from("friendships")
        .select("requester_id,addressee_id")
        .eq("status", "accepted")
        .in("requester_id", candidateIds)
        .in("addressee_id", myFriendArray),
      supabase
        .from("friendships")
        .select("requester_id,addressee_id")
        .eq("status", "accepted")
        .in("addressee_id", candidateIds)
        .in("requester_id", myFriendArray),
    ]);

    if (q1.error) throw q1.error;
    if (q2.error) throw q2.error;

    const addCount = (candidateId: string) => {
      mutualByCandidate.set(candidateId, (mutualByCandidate.get(candidateId) ?? 0) + 1);
    };

    for (const row of (q1.data ?? []) as Array<{ requester_id: string; addressee_id: string }>) {
      addCount(row.requester_id);
    }
    for (const row of (q2.data ?? []) as Array<{ requester_id: string; addressee_id: string }>) {
      addCount(row.addressee_id);
    }
  }

  const ranked = available
    .map((profile) => ({
      id: profile.id,
      username: profile.username,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      bio: profile.bio,
      mutual_friends_count: mutualByCandidate.get(profile.id) ?? 0,
      follows_you: followsYouIds.has(profile.id),
      friendship_state: friendshipByCandidate.get(profile.id)?.state ?? "none",
      incoming_friendship_id: friendshipByCandidate.get(profile.id)?.incoming_friendship_id ?? null,
      created_at: profile.created_at ?? "",
    }))
    .sort((a, b) => {
      if (b.mutual_friends_count !== a.mutual_friends_count) {
        return b.mutual_friends_count - a.mutual_friends_count;
      }
      return b.created_at.localeCompare(a.created_at);
    })
    .map(({ created_at, ...item }) => item satisfies SuggestedProfile);

  return ranked.slice(0, Math.min(Math.max(limit, 1), 20));
};
