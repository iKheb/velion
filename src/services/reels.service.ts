import { mockReels } from "@/lib/mock";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sanitizeInput } from "@/lib/sanitize";
import { validateSocialTextRules } from "@/lib/social-text-rules";
import { assertCanInteractWithUserContent, canViewUserContent, validateMentionsAllowed } from "@/services/account-settings.service";
import { trackEventFireAndForget } from "@/services/analytics.service";
import { createNotification } from "@/services/notifications.service";
import { uploadFile } from "@/services/storage.service";
import { hasSupabaseConfig, supabase } from "@/services/supabase";
import { requireAuthUser, requireNonEmptyText } from "@/services/supabase-helpers";
import type { Reel, ReelComment } from "@/types/models";

const toSingle = <T>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const filterVisibleReels = async (reels: Reel[], viewerId: string | null): Promise<Reel[]> => {
  if (!reels.length) return reels;
  const visible = await Promise.all(
    reels.map(async (reel) => ((await canViewUserContent(reel.author_id, viewerId, "reels")) ? reel : null)),
  );
  return visible.filter((reel): reel is Reel => Boolean(reel));
};

const mapReelRows = (rows: Array<Record<string, unknown>>): Reel[] =>
  rows.map((item) => ({
    id: item.id as string,
    author_id: item.author_id as string,
    title: (item.title as string | null) ?? null,
    description: (item.description as string | null) ?? null,
    video_url: item.video_url as string,
    thumbnail_url: (item.thumbnail_url as string | null) ?? null,
    likes_count: Number(item.likes_count ?? 0),
    comments_count: Number(((item.reel_comments as Array<{ count: number }> | undefined)?.[0]?.count ?? item.comments_count ?? 0)),
    shares_count: Number(((item.reel_shares as Array<{ count: number }> | undefined)?.[0]?.count ?? item.shares_count ?? 0)),
    saves_count: Number(((item.reel_saves as Array<{ count: number }> | undefined)?.[0]?.count ?? item.saves_count ?? 0)),
    views_count: Number(item.views_count ?? 0),
    created_at: item.created_at as string,
    profile: (toSingle(item.profile as Reel["profile"] | Reel["profile"][]) ?? undefined) as Reel["profile"],
    liked_by_me: false,
    saved_by_me: false,
  }));

const withLikedState = async (reels: Reel[], userId: string | null | undefined): Promise<Reel[]> => {
  if (!reels.length || !userId || !hasSupabaseConfig) return reels;

  const reelIds = reels.map((reel) => reel.id);
  const [likesResult, savesResult] = await Promise.all([
    supabase.from("reel_reactions").select("reel_id").eq("user_id", userId).in("reel_id", reelIds),
    supabase.from("reel_saves").select("reel_id").eq("user_id", userId).in("reel_id", reelIds),
  ]);

  if (likesResult.error) throw likesResult.error;
  if (savesResult.error) throw savesResult.error;

  const likedIds = new Set(((likesResult.data ?? []) as Array<{ reel_id: string }>).map((item) => item.reel_id));
  const savedIds = new Set(((savesResult.data ?? []) as Array<{ reel_id: string }>).map((item) => item.reel_id));
  return reels.map((reel) => ({ ...reel, liked_by_me: likedIds.has(reel.id), saved_by_me: savedIds.has(reel.id) }));
};

const getCurrentUserId = async (): Promise<string | null> => {
  const user = (await supabase.auth.getUser()).data.user;
  return user?.id ?? null;
};

export const getReelsFeed = async (limit = 30): Promise<Reel[]> => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  if (!hasSupabaseConfig) return mockReels.slice(0, safeLimit);

  const currentUserId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("reels")
    .select(`
      id,
      author_id,
      title,
      description,
      video_url,
      thumbnail_url,
      likes_count,
      comments_count,
      shares_count,
      saves_count,
      views_count,
      created_at,
      profile:profiles(id,username,full_name,avatar_url,is_premium,is_verified),
      reel_comments(count),
      reel_shares(count),
      reel_saves(count)
    `)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  const visibleReels = await filterVisibleReels(mapReelRows((data ?? []) as Array<Record<string, unknown>>), currentUserId);
  return withLikedState(visibleReels, currentUserId);
};

export const getReelsByAuthor = async (authorId: string, limit = 40): Promise<Reel[]> => {
  if (!authorId) return [];
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  if (!hasSupabaseConfig) return mockReels.filter((reel) => reel.author_id === authorId).slice(0, safeLimit);

  const currentUserId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("reels")
    .select(`
      id,
      author_id,
      title,
      description,
      video_url,
      thumbnail_url,
      likes_count,
      comments_count,
      shares_count,
      saves_count,
      views_count,
      created_at,
      profile:profiles(id,username,full_name,avatar_url,is_premium,is_verified),
      reel_comments(count),
      reel_shares(count),
      reel_saves(count)
    `)
    .eq("author_id", authorId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  const visibleReels = await filterVisibleReels(mapReelRows((data ?? []) as Array<Record<string, unknown>>), currentUserId);
  return withLikedState(visibleReels, currentUserId);
};

export const searchReels = async (query: string, limit = 20): Promise<Reel[]> => {
  const normalized = query.trim();
  if (!normalized) return [];

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  if (!hasSupabaseConfig) {
    const lowered = normalized.toLowerCase();
    return mockReels
      .filter((reel) => {
        const title = (reel.title ?? "").toLowerCase();
        const description = (reel.description ?? "").toLowerCase();
        return title.includes(lowered) || description.includes(lowered);
      })
      .slice(0, safeLimit);
  }

  const currentUserId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("reels")
    .select(`
      id,
      author_id,
      title,
      description,
      video_url,
      thumbnail_url,
      likes_count,
      comments_count,
      shares_count,
      saves_count,
      views_count,
      created_at,
      profile:profiles(id,username,full_name,avatar_url,is_premium,is_verified),
      reel_comments(count),
      reel_shares(count),
      reel_saves(count)
    `)
    .or(`title.ilike.%${normalized}%,description.ilike.%${normalized}%`)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  const visibleReels = await filterVisibleReels(mapReelRows((data ?? []) as Array<Record<string, unknown>>), currentUserId);
  return withLikedState(visibleReels, currentUserId);
};

export const createReel = async (
  payload: { title: string; description?: string | null; videoFile: File; thumbnailFile?: File | null },
  onProgress?: (progress: number) => void,
): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const title = requireNonEmptyText(validateSocialTextRules(payload.title ?? ""), "El titulo del reel es obligatorio.");
  const description = validateSocialTextRules(payload.description ?? "");
  await validateMentionsAllowed(`${title}\n${description}`, "reels", user.id);
  if (!payload.videoFile.type.startsWith("video/")) throw new Error("Debes seleccionar un archivo de video.");
  if (payload.videoFile.size > 120 * 1024 * 1024) throw new Error("El video excede el limite de 120MB.");

  const extension = payload.videoFile.name.split(".").pop() ?? "mp4";
  const videoPath = `${user.id}/reel-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const videoUrl = await uploadFile("reels", videoPath, payload.videoFile, onProgress);

  let thumbnailUrl: string | null = null;
  if (payload.thumbnailFile) {
    const thumbExt = payload.thumbnailFile.name.split(".").pop() ?? "jpg";
    const thumbnailPath = `${user.id}/reel-thumb-${Date.now()}-${crypto.randomUUID()}.${thumbExt}`;
    thumbnailUrl = await uploadFile("reels", thumbnailPath, payload.thumbnailFile);
  }

  const { error } = await supabase.from("reels").insert({
    author_id: user.id,
    title,
    description: description || null,
    video_url: videoUrl,
    thumbnail_url: thumbnailUrl,
  });

  if (error) throw error;
  trackEventFireAndForget("reel_create", { has_thumbnail: Boolean(thumbnailUrl) });
};

export const updateReel = async (
  reelId: string,
  payload: { title: string; description?: string | null },
): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const title = requireNonEmptyText(validateSocialTextRules(payload.title ?? ""), "El titulo del reel es obligatorio.");
  const description = validateSocialTextRules(payload.description ?? "");
  await validateMentionsAllowed(`${title}\n${description}`, "reels", user.id);

  const { error } = await supabase
    .from("reels")
    .update({
      title,
      description: description || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reelId)
    .eq("author_id", user.id);

  if (error) throw error;
  trackEventFireAndForget("reel_update", { reel_id: reelId });
};

export const deleteReel = async (reelId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const { error } = await supabase
    .from("reels")
    .delete()
    .eq("id", reelId)
    .eq("author_id", user.id);

  if (error) throw error;
  trackEventFireAndForget("reel_delete", { reel_id: reelId });
};

export const reportReel = async (reelId: string, reason: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!reelId) throw new Error("Reel invalido");

  const reporterId = (await supabase.auth.getUser()).data.user?.id;
  if (!reporterId) throw new Error("No autenticado");

  const cleanedReason = validateSocialTextRules(reason.trim());
  if (!cleanedReason) throw new Error("Describe el motivo del reporte");
  if (cleanedReason.length > 400) throw new Error("El reporte no puede superar 400 caracteres.");
  enforceRateLimit({
    key: `report:reel:${reporterId}`,
    maxRequests: 5,
    windowMs: 60_000,
    message: "Has enviado muchos reportes en poco tiempo. Espera un minuto.",
  });

  const { error } = await supabase.from("reports").insert({
    reporter_id: reporterId,
    target_type: "reel",
    target_id: reelId,
    reason: cleanedReason,
    status: "open",
  });
  if (error) throw error;

  trackEventFireAndForget("reel_report_create", { reel_id: reelId });
};

export const toggleLikeReel = async (reelId: string): Promise<boolean> => {
  if (!hasSupabaseConfig) return true;

  const user = await requireAuthUser();
  const { data: reelOwner, error: reelOwnerError } = await supabase.from("reels").select("author_id").eq("id", reelId).maybeSingle();
  if (reelOwnerError) throw reelOwnerError;
  if (!reelOwner) throw new Error("Reel no encontrado.");
  await assertCanInteractWithUserContent(reelOwner.author_id as string, user.id, "reels", "like");

  const { data: existing, error: existingError } = await supabase
    .from("reel_reactions")
    .select("id")
    .eq("reel_id", reelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { error: deleteError } = await supabase.from("reel_reactions").delete().eq("id", existing.id);
    if (deleteError) throw deleteError;

    const { data: current, error: currentError } = await supabase.from("reels").select("likes_count").eq("id", reelId).maybeSingle();
    if (currentError) throw currentError;
    const nextCount = Math.max(0, Number(current?.likes_count ?? 1) - 1);
    const { error: countError } = await supabase.from("reels").update({ likes_count: nextCount }).eq("id", reelId);
    if (countError) throw countError;

    trackEventFireAndForget("reel_unlike", { reel_id: reelId });
    return false;
  }

  const { error: insertError } = await supabase.from("reel_reactions").insert({ reel_id: reelId, user_id: user.id, reaction: "like" });
  if (insertError) throw insertError;

  const { data: current, error: currentError } = await supabase.from("reels").select("author_id,likes_count").eq("id", reelId).maybeSingle();
  if (currentError) throw currentError;
  const nextCount = Math.max(0, Number(current?.likes_count ?? 0) + 1);
  const { error: countError } = await supabase.from("reels").update({ likes_count: nextCount }).eq("id", reelId);
  if (countError) throw countError;
  if (current?.author_id) await createNotification(current.author_id as string, "like", reelId);

  trackEventFireAndForget("reel_like", { reel_id: reelId });
  return true;
};

export const getReelComments = async (reelId: string): Promise<ReelComment[]> => {
  if (!hasSupabaseConfig) return [];
  const { data, error } = await supabase
    .from("reel_comments")
    .select("id,reel_id,author_id,content,created_at,author:profiles(id,username,full_name,avatar_url,is_premium,is_verified)")
    .eq("reel_id", reelId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((item) => ({
    id: item.id as string,
    reel_id: item.reel_id as string,
    author_id: item.author_id as string,
    content: item.content as string,
    created_at: item.created_at as string,
    author: (toSingle(item.author as ReelComment["author"] | ReelComment["author"][]) ?? undefined) as ReelComment["author"],
  }));
};

export const addReelComment = async (reelId: string, rawContent: string): Promise<void> => {
  const content = sanitizeInput(rawContent);
  if (!content) return;
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();
  const { data: reelOwner, error: reelOwnerError } = await supabase.from("reels").select("author_id").eq("id", reelId).maybeSingle();
  if (reelOwnerError) throw reelOwnerError;
  if (!reelOwner) throw new Error("Reel no encontrado.");
  await assertCanInteractWithUserContent(reelOwner.author_id as string, user.id, "reels", "comment");
  await validateMentionsAllowed(content, "reels", user.id);

  const { error } = await supabase.from("reel_comments").insert({
    reel_id: reelId,
    author_id: user.id,
    content,
  });
  if (error) throw error;

  const { data: reel, error: reelError } = await supabase.from("reels").select("author_id,comments_count").eq("id", reelId).maybeSingle();
  if (reelError) throw reelError;

  const nextCount = Math.max(0, Number(reel?.comments_count ?? 0) + 1);
  const { error: countError } = await supabase.from("reels").update({ comments_count: nextCount }).eq("id", reelId);
  if (countError) throw countError;

  if (reel?.author_id) await createNotification(reel.author_id as string, "comment", reelId);
  trackEventFireAndForget("reel_comment", { reel_id: reelId });
};

export const deleteReelComment = async (commentId: string, reelId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const { error } = await supabase
    .from("reel_comments")
    .delete()
    .eq("id", commentId)
    .eq("author_id", user.id);
  if (error) throw error;

  const { data: reel, error: reelError } = await supabase.from("reels").select("comments_count").eq("id", reelId).maybeSingle();
  if (reelError) throw reelError;

  const nextCount = Math.max(0, Number(reel?.comments_count ?? 1) - 1);
  const { error: countError } = await supabase.from("reels").update({ comments_count: nextCount }).eq("id", reelId);
  if (countError) throw countError;
};

export const shareReel = async (reelId: string, rawComment?: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();
  const shareComment = validateSocialTextRules(rawComment ?? "");

  const { data: reelForPost, error: reelForPostError } = await supabase
    .from("reels")
    .select("id,author_id,title,description,video_url,thumbnail_url,profile:profiles(username,full_name,is_premium,is_verified)")
    .eq("id", reelId)
    .maybeSingle();
  if (reelForPostError) throw reelForPostError;
  if (!reelForPost) throw new Error("Reel no encontrado");
  await assertCanInteractWithUserContent(reelForPost.author_id as string, user.id, "reels", "share");

  const reelAuthor = toSingle(
    reelForPost.profile as { username?: string | null; full_name?: string | null } | Array<{ username?: string | null; full_name?: string | null }>,
  );
  const reelHandle = reelAuthor?.username ?? "usuario";
  const marker = `Compartio un reel de @${reelHandle}`;
  const baseText = ((reelForPost.description as string | null) ?? (reelForPost.title as string | null) ?? "").trim();
  const sharedContent = sanitizeInput([shareComment, marker, baseText].filter((part) => part && part.length > 0).join("\n\n")) ?? marker;
  await validateMentionsAllowed(sharedContent, "reels", user.id);

  const { error: createPostError } = await supabase.from("posts").insert({
    author_id: user.id,
    content: sharedContent,
    media_url: (reelForPost.video_url as string | null) ?? null,
    media_type: "video",
    shared_target_type: "reel",
    shared_target_id: reelId,
  });
  if (createPostError) throw createPostError;

  const { data: existing, error: existingError } = await supabase
    .from("reel_shares")
    .select("id")
    .eq("reel_id", reelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing?.id) {
    const { error } = await supabase.from("reel_shares").insert({ reel_id: reelId, user_id: user.id });
    if (error) throw error;
    const { data: reel, error: reelError } = await supabase.from("reels").select("author_id,shares_count").eq("id", reelId).maybeSingle();
    if (reelError) throw reelError;

    const nextCount = Math.max(0, Number(reel?.shares_count ?? 0) + 1);
    const { error: countError } = await supabase.from("reels").update({ shares_count: nextCount }).eq("id", reelId);
    if (countError) throw countError;
    if (reel?.author_id) await createNotification(reel.author_id as string, "share", reelId);
  }
  trackEventFireAndForget("reel_share", { reel_id: reelId });
};

export const toggleSaveReel = async (reelId: string): Promise<boolean> => {
  if (!hasSupabaseConfig) return true;

  const user = await requireAuthUser();
  const { data: reelOwner, error: reelOwnerError } = await supabase.from("reels").select("author_id").eq("id", reelId).maybeSingle();
  if (reelOwnerError) throw reelOwnerError;
  if (!reelOwner) throw new Error("Reel no encontrado.");
  await assertCanInteractWithUserContent(reelOwner.author_id as string, user.id, "reels", "save");

  const { data: existing, error: existingError } = await supabase
    .from("reel_saves")
    .select("id")
    .eq("reel_id", reelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await supabase.from("reel_saves").delete().eq("id", existing.id);
    if (error) throw error;

    const { data: reel, error: reelError } = await supabase.from("reels").select("saves_count").eq("id", reelId).maybeSingle();
    if (reelError) throw reelError;
    const nextCount = Math.max(0, Number(reel?.saves_count ?? 1) - 1);
    const { error: countError } = await supabase.from("reels").update({ saves_count: nextCount }).eq("id", reelId);
    if (countError) throw countError;

    trackEventFireAndForget("reel_unsave", { reel_id: reelId });
    return false;
  }

  const { error } = await supabase.from("reel_saves").insert({ reel_id: reelId, user_id: user.id });
  if (error) throw error;

  const { data: reel, error: reelError } = await supabase.from("reels").select("saves_count").eq("id", reelId).maybeSingle();
  if (reelError) throw reelError;
  const nextCount = Math.max(0, Number(reel?.saves_count ?? 0) + 1);
  const { error: countError } = await supabase.from("reels").update({ saves_count: nextCount }).eq("id", reelId);
  if (countError) throw countError;

  trackEventFireAndForget("reel_save", { reel_id: reelId });
  return true;
};

export const incrementReelView = async (reelId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const userId = await getCurrentUserId();
  if (userId) {
    const { data: existing, error: existingError } = await supabase
      .from("reel_views")
      .select("id")
      .eq("reel_id", reelId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.id) return;

    const { error: insertViewError } = await supabase.from("reel_views").insert({ reel_id: reelId, user_id: userId });
    if (insertViewError) throw insertViewError;
  }

  const { data: current, error: currentError } = await supabase.from("reels").select("views_count").eq("id", reelId).maybeSingle();
  if (currentError) throw currentError;
  const nextCount = Math.max(0, Number(current?.views_count ?? 0) + 1);
  const { error: updateError } = await supabase.from("reels").update({ views_count: nextCount }).eq("id", reelId);
  if (updateError) throw updateError;

  trackEventFireAndForget("reel_view", { reel_id: reelId });
};
