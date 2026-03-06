import { mockPosts, mockReels, mockStories } from "@/lib/mock";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sanitizeInput } from "@/lib/sanitize";
import { validateSocialTextRules } from "@/lib/social-text-rules";
import { assertCanInteractWithUserContent, canViewUserContent, validateMentionsAllowed } from "@/services/account-settings.service";
import { trackEventFireAndForget } from "@/services/analytics.service";
import { createNotification } from "@/services/notifications.service";
import { uploadFile } from "@/services/storage.service";
import { hasSupabaseConfig, supabase } from "@/services/supabase";
import { requireAuthUser, requireNonEmptyText } from "@/services/supabase-helpers";
import type { MentionUser } from "@/services/auth.service";
import type { PostComment, Reel, SocialPost, Stream, StreamVod, Story } from "@/types/models";

export type FeedMode = "for_you" | "following";
export type GlobalSearchScope = "all" | "profiles" | "posts" | "streams" | "vods" | "videos" | "reels";
export type GlobalSearchResultType = "profile" | "post" | "stream" | "stream_vod" | "reel";

export interface GlobalSearchResult {
  result_type: GlobalSearchResultType;
  result_id: string;
  title: string;
  subtitle: string | null;
  created_at: string;
  rank_score: number;
  payload: unknown;
}

export interface GlobalSearchGroupedResults {
  profiles: MentionUser[];
  posts: SocialPost[];
  streams: Stream[];
  vods: StreamVod[];
  reels: Reel[];
  raw: GlobalSearchResult[];
}
const RETWEET_MARKER = "Compartio una publicacion de @";
const REEL_RETWEET_MARKER = "Compartio un reel de @";
const VOD_RETWEET_MARKER = "Compartio video:";
const HASHTAG_REGEX = /#([\p{L}\p{N}_]+)/gu;
const SHARED_TARGET_TYPES = ["post", "reel", "stream_vod", "stream"] as const;
type SharedTargetType = (typeof SHARED_TARGET_TYPES)[number];
type PostContext = "posts" | "photos" | "videos";

const isSharedTargetType = (value: unknown): value is SharedTargetType =>
  typeof value === "string" && (SHARED_TARGET_TYPES as readonly string[]).includes(value);

const splitRetweetContent = (content: string): { isRetweet: boolean; comment: string; rest: string } => {
  const markers = [RETWEET_MARKER, REEL_RETWEET_MARKER, VOD_RETWEET_MARKER];
  const markerIndices = markers.map((marker) => content.indexOf(marker)).filter((index) => index >= 0);
  const markerIndex = markerIndices.length ? Math.min(...markerIndices) : -1;
  if (markerIndex === -1) {
    return { isRetweet: false, comment: "", rest: content };
  }

  const beforeMarker = content.slice(0, markerIndex).trim();
  const markerAndOriginal = content.slice(markerIndex).trim();
  return {
    isRetweet: true,
    comment: beforeMarker,
    rest: markerAndOriginal,
  };
};

const toSingle = <T>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const resolveViewerId = async (): Promise<string | null> => (await supabase.auth.getUser()).data.user?.id ?? null;

const getPostContextFromMedia = (mediaType: "image" | "video" | null | undefined): PostContext => {
  if (mediaType === "image") return "photos";
  if (mediaType === "video") return "videos";
  return "posts";
};

const filterVisiblePosts = async (posts: SocialPost[], viewerId: string | null): Promise<SocialPost[]> => {
  if (!posts.length) return posts;
  const visibility = await Promise.all(
    posts.map(async (post) => {
      const context = getPostContextFromMedia(post.media_type);
      return (await canViewUserContent(post.author_id, viewerId, context)) ? post : null;
    }),
  );
  return visibility.filter((post): post is SocialPost => Boolean(post));
};

const mapPostRows = (data: Array<Record<string, unknown>>): SocialPost[] =>
  data.map((item) => ({
    id: item.id as string,
    author_id: item.author_id as string,
    content: (item.content as string) ?? "",
    media_url: (item.media_url as string | null) ?? null,
    media_type: (item.media_type as "image" | "video" | null) ?? null,
    shared_target_type: isSharedTargetType(item.shared_target_type) ? item.shared_target_type : null,
    shared_target_id: (item.shared_target_id as string | null) ?? null,
    shared_target_available: true,
    created_at: item.created_at as string,
    profile: toSingle(item.profile as SocialPost["profile"] | SocialPost["profile"][]) ?? undefined,
    reactions_count: ((item.post_reactions as Array<{ count: number }> | undefined)?.[0]?.count ?? 0),
    comments_count: ((item.comments as Array<{ count: number }> | undefined)?.[0]?.count ?? 0),
    shares_count: ((item.shared_posts as Array<{ count: number }> | undefined)?.[0]?.count ?? 0),
    saved_count: ((item.saved_posts as Array<{ count: number }> | undefined)?.[0]?.count ?? 0),
    liked_by_me: false,
    shared_by_me: false,
    saved_by_me: false,
  }));

const mapRankedFeedRows = (data: Array<Record<string, unknown>>): SocialPost[] =>
  data.map((item) => ({
    id: item.id as string,
    author_id: item.author_id as string,
    content: (item.content as string) ?? "",
    media_url: (item.media_url as string | null) ?? null,
    media_type: ((item.media_type as "image" | "video" | null) ?? null),
    shared_target_type: isSharedTargetType(item.shared_target_type) ? item.shared_target_type : null,
    shared_target_id: (item.shared_target_id as string | null) ?? null,
    shared_target_available: true,
    created_at: item.created_at as string,
    reactions_count: Number(item.reactions_count ?? 0),
    comments_count: Number(item.comments_count ?? 0),
    shares_count: Number(item.shares_count ?? 0),
    saved_count: Number(item.saved_count ?? 0),
    liked_by_me: false,
    shared_by_me: false,
    saved_by_me: false,
    profile: (item.profile as SocialPost["profile"] | null) ?? undefined,
  }));

const withEngagementState = async (posts: SocialPost[], userId: string | null | undefined): Promise<SocialPost[]> => {
  if (!posts.length || !userId || !hasSupabaseConfig) return posts;

  const postIds = posts.map((post) => post.id);

  const [likesResult, savesResult, sharesResult] = await Promise.all([
    supabase.from("post_reactions").select("post_id").eq("user_id", userId).in("post_id", postIds),
    supabase.from("saved_posts").select("post_id").eq("user_id", userId).in("post_id", postIds),
    supabase.from("shared_posts").select("post_id").eq("user_id", userId).in("post_id", postIds),
  ]);

  if (likesResult.error) throw likesResult.error;
  if (savesResult.error) throw savesResult.error;
  if (sharesResult.error) throw sharesResult.error;

  const likedIds = new Set(((likesResult.data ?? []) as Array<{ post_id: string }>).map((row) => row.post_id));
  const savedIds = new Set(((savesResult.data ?? []) as Array<{ post_id: string }>).map((row) => row.post_id));
  const sharedIds = new Set(((sharesResult.data ?? []) as Array<{ post_id: string }>).map((row) => row.post_id));

  return posts.map((post) => ({
    ...post,
    liked_by_me: likedIds.has(post.id),
    saved_by_me: savedIds.has(post.id),
    shared_by_me: sharedIds.has(post.id),
  }));
};

const withSharedTargetAvailability = async (posts: SocialPost[]): Promise<SocialPost[]> => {
  if (!posts.length || !hasSupabaseConfig) return posts;

  const targetIdsByType: Record<SharedTargetType, string[]> = {
    post: [],
    reel: [],
    stream_vod: [],
    stream: [],
  };

  posts.forEach((post) => {
    if (post.shared_target_type && post.shared_target_id) {
      targetIdsByType[post.shared_target_type].push(post.shared_target_id);
    }
  });

  const uniquePostIds = Array.from(new Set(targetIdsByType.post));
  const uniqueReelIds = Array.from(new Set(targetIdsByType.reel));
  const uniqueVodIds = Array.from(new Set(targetIdsByType.stream_vod));
  const uniqueStreamIds = Array.from(new Set(targetIdsByType.stream));

  const availableIds: Record<SharedTargetType, Set<string>> = {
    post: new Set<string>(),
    reel: new Set<string>(),
    stream_vod: new Set<string>(),
    stream: new Set<string>(),
  };

  const [postsResult, reelsResult, vodsResult, streamsResult] = await Promise.all([
    uniquePostIds.length ? supabase.from("posts").select("id").in("id", uniquePostIds) : Promise.resolve({ data: [], error: null }),
    uniqueReelIds.length ? supabase.from("reels").select("id").in("id", uniqueReelIds) : Promise.resolve({ data: [], error: null }),
    uniqueVodIds.length ? supabase.from("stream_vods").select("id").in("id", uniqueVodIds) : Promise.resolve({ data: [], error: null }),
    uniqueStreamIds.length ? supabase.from("streams").select("id").in("id", uniqueStreamIds) : Promise.resolve({ data: [], error: null }),
  ]);

  if (postsResult.error) throw postsResult.error;
  if (reelsResult.error) throw reelsResult.error;
  if (vodsResult.error) throw vodsResult.error;
  if (streamsResult.error) throw streamsResult.error;

  ((postsResult.data ?? []) as Array<{ id: string }>).forEach((row) => availableIds.post.add(row.id));
  ((reelsResult.data ?? []) as Array<{ id: string }>).forEach((row) => availableIds.reel.add(row.id));
  ((vodsResult.data ?? []) as Array<{ id: string }>).forEach((row) => availableIds.stream_vod.add(row.id));
  ((streamsResult.data ?? []) as Array<{ id: string }>).forEach((row) => availableIds.stream.add(row.id));

  return posts.map((post) => {
    if (!post.shared_target_type || !post.shared_target_id) return { ...post, shared_target_available: true };
    const available = availableIds[post.shared_target_type].has(post.shared_target_id);
    return { ...post, shared_target_available: available };
  });
};

export const getFeed = async (page = 0, size = 10, mode: FeedMode = "for_you"): Promise<SocialPost[]> => {
  if (!hasSupabaseConfig) return mockPosts.slice(page * size, page * size + size);
  const me = await resolveViewerId();
  const safePage = Math.max(page, 0);
  const safeSize = Math.min(Math.max(size, 1), 50);
  const { data, error } = await supabase.rpc("get_ranked_feed", {
    p_mode: mode,
    p_page: safePage,
    p_size: safeSize,
    p_content_type: "all",
  });
  if (error) throw error;
  const posts = mapRankedFeedRows((data ?? []) as Array<Record<string, unknown>>);
  const visiblePosts = await filterVisiblePosts(posts, me);
  const withEngagement = await withEngagementState(visiblePosts, me);
  return withSharedTargetAvailability(withEngagement);
};

export const globalSearch = async (
  query: string,
  scope: GlobalSearchScope = "all",
  limit = 40,
): Promise<GlobalSearchGroupedResults> => {
  const normalized = query.trim();
  if (!normalized) {
    return { profiles: [], posts: [], streams: [], vods: [], reels: [], raw: [] };
  }

  if (!hasSupabaseConfig) {
    return { profiles: [], posts: [], streams: [], vods: [], reels: [], raw: [] };
  }

  const safeLimit = Math.min(Math.max(limit, 1), 120);
  const { data, error } = await supabase.rpc("global_search", {
    p_query: normalized,
    p_scope: scope,
    p_limit: safeLimit,
  });
  if (error) throw error;

  const raw = ((data ?? []) as Array<Record<string, unknown>>).map(
    (row) =>
      ({
        result_type: row.result_type as GlobalSearchResultType,
        result_id: row.result_id as string,
        title: (row.title as string) ?? "",
        subtitle: (row.subtitle as string | null) ?? null,
        created_at: row.created_at as string,
        rank_score: Number(row.rank_score ?? 0),
        payload: row.payload,
      }) satisfies GlobalSearchResult,
  );

  const profiles = raw
    .filter((row) => row.result_type === "profile")
    .map((row) => row.payload as MentionUser);
  const posts = raw
    .filter((row) => row.result_type === "post")
    .map((row) => row.payload as SocialPost);
  const streams = raw
    .filter((row) => row.result_type === "stream")
    .map((row) => row.payload as Stream);
  const vods = raw
    .filter((row) => row.result_type === "stream_vod")
    .map((row) => row.payload as StreamVod);
  const reels = raw
    .filter((row) => row.result_type === "reel")
    .map((row) => row.payload as Reel);

  return { profiles, posts, streams, vods, reels, raw };
};

interface SearchPostsOptions {
  mediaType?: "image" | "video";
}

export const searchPosts = async (query: string, limit = 30, options: SearchPostsOptions = {}): Promise<SocialPost[]> => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const hashtagTerms = Array.from(normalized.matchAll(HASHTAG_REGEX)).map((match) => match[1]).filter(Boolean);
  const plainQuery = normalized.replace(HASHTAG_REGEX, " ").replace(/\s+/g, " ").trim();

  const matchesSearch = (contentRaw: string): boolean => {
    const content = contentRaw.toLowerCase();
    const matchesPlain = !plainQuery || content.includes(plainQuery);
    const matchesHashtags = hashtagTerms.every((tag) => content.includes(`#${tag}`));
    return matchesPlain && matchesHashtags;
  };

  const forcedMediaType = options.mediaType ?? null;

  if (!hasSupabaseConfig) {
    return mockPosts
      .filter((post) => {
        const content = post.content ?? "";
        const lowered = content.toLowerCase();
        const isRetweet = lowered.includes(RETWEET_MARKER.toLowerCase());
        const wantsRetweet = /retuit|retweet|compart/.test(normalized);
        const wantsImage = /foto|fotos|imagen|imagenes/.test(normalized);
        const wantsVideo = /video|videos/.test(normalized);

        if (forcedMediaType) return post.media_type === forcedMediaType && matchesSearch(content);
        if (wantsRetweet) return isRetweet;
        if (wantsImage) return post.media_type === "image" || matchesSearch(content);
        if (wantsVideo) return post.media_type === "video" || matchesSearch(content);
        return matchesSearch(content);
      })
      .slice(0, safeLimit);
  }

  const me = await resolveViewerId();
  const wantsRetweet = /retuit|retweet|compart/.test(normalized);
  const wantsImage = /foto|fotos|imagen|imagenes/.test(normalized);
  const wantsVideo = /video|videos/.test(normalized);

  let queryBuilder = supabase
    .from("posts")
    .select(`
      id,
      author_id,
      content,
      media_url,
      media_type,
      shared_target_type,
      shared_target_id,
      created_at,
      profile:profiles(*),
      post_reactions(count),
      comments(count),
      shared_posts(count),
      saved_posts(count)
    `)
    .order("promoted_until", { ascending: false, nullsFirst: false })
    .order("promotion_credits", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (forcedMediaType) {
    queryBuilder = queryBuilder.eq("media_type", forcedMediaType);
    if (plainQuery) {
      queryBuilder = queryBuilder.ilike("content", `%${plainQuery}%`);
    }
  } else if (wantsRetweet) {
    queryBuilder = queryBuilder.ilike("content", `%${RETWEET_MARKER}%`);
  } else if (wantsImage && !wantsVideo) {
    queryBuilder = queryBuilder.eq("media_type", "image");
  } else if (wantsVideo && !wantsImage) {
    queryBuilder = queryBuilder.eq("media_type", "video");
  } else if (plainQuery) {
    queryBuilder = queryBuilder.ilike("content", `%${plainQuery}%`);
  } else if (hashtagTerms.length > 0) {
    queryBuilder = queryBuilder.ilike("content", `%#${hashtagTerms[0]}%`);
  } else {
    queryBuilder = queryBuilder.ilike("content", `%${normalized}%`);
  }

  const { data, error } = await queryBuilder;
  if (error) throw error;
  const posts = mapPostRows((data ?? []) as Array<Record<string, unknown>>).filter((post) => matchesSearch(post.content ?? ""));
  const visiblePosts = await filterVisiblePosts(posts, me);
  const withEngagement = await withEngagementState(visiblePosts.slice(0, safeLimit), me);
  return withSharedTargetAvailability(withEngagement);
};

export const getPostsByAuthor = async (authorId: string, limit = 30): Promise<SocialPost[]> => {
  if (!hasSupabaseConfig) return mockPosts.filter((post) => post.author_id === authorId).slice(0, limit);
  const me = await resolveViewerId();

  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const { data: authoredData, error: authoredError } = await supabase
    .from("posts")
    .select(`
      id,
      author_id,
      content,
      media_url,
      media_type,
      shared_target_type,
      shared_target_id,
      created_at,
      profile:profiles(*),
      post_reactions(count),
      comments(count),
      shared_posts(count),
      saved_posts(count)
    `)
    .eq("author_id", authorId)
    .order("promoted_until", { ascending: false, nullsFirst: false })
    .order("promotion_credits", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (authoredError) throw authoredError;

  const { data: sharedData, error: sharedError } = await supabase
    .from("shared_posts")
    .select(`
      created_at,
      post:posts(
        id,
        author_id,
        content,
        media_url,
        media_type,
        shared_target_type,
        shared_target_id,
        created_at,
        profile:profiles(*),
        post_reactions(count),
        comments(count),
        shared_posts(count),
        saved_posts(count)
      )
    `)
    .eq("user_id", authorId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (sharedError) throw sharedError;

  const authoredPosts = mapPostRows((authoredData ?? []) as Array<Record<string, unknown>>);
  const sharedPosts = ((sharedData ?? []) as Array<Record<string, unknown>>)
    .map((item) => {
      const post = toSingle(item.post as Record<string, unknown> | Array<Record<string, unknown>> | null | undefined);
      if (!post) return null;
      const mapped = mapPostRows([post])[0];
      return {
        ...mapped,
        created_at: (item.created_at as string) ?? mapped.created_at,
      } satisfies SocialPost;
    })
    .filter((post): post is SocialPost => Boolean(post));

  const merged = [...authoredPosts, ...sharedPosts].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const deduped = merged.filter((post, index, array) => index === array.findIndex((candidate) => candidate.id === post.id));
  const limited = deduped.slice(0, safeLimit);

  const visiblePosts = await filterVisiblePosts(limited, me);
  const withEngagement = await withEngagementState(visiblePosts, me);
  return withSharedTargetAvailability(withEngagement);
};

export const getSavedPostsByUser = async (userId: string, limit = 30): Promise<SocialPost[]> => {
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  if (!hasSupabaseConfig) {
    return mockPosts.slice(0, safeLimit).map((post) => ({ ...post, saved_by_me: true }));
  }

  const me = await resolveViewerId();
  const { data, error } = await supabase
    .from("saved_posts")
    .select(`
      created_at,
      post:posts(
        id,
        author_id,
        content,
        media_url,
        media_type,
        shared_target_type,
        shared_target_id,
        created_at,
        profile:profiles(*),
        post_reactions(count),
        comments(count),
        shared_posts(count),
        saved_posts(count)
      )
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw error;

  const posts = ((data ?? []) as Array<Record<string, unknown>>)
    .map((item) => toSingle(item.post as Record<string, unknown> | Array<Record<string, unknown>> | null | undefined))
    .filter((post): post is Record<string, unknown> => Boolean(post));

  const mappedPosts = mapPostRows(posts);
  const visiblePosts = await filterVisiblePosts(mappedPosts, me);
  const withEngagement = await withEngagementState(visiblePosts, me);
  return withSharedTargetAvailability(withEngagement);
};

export const createPost = async (
  content: string,
  mediaFile?: File | null,
  onProgress?: (progress: number) => void,
  options?: { documentFile?: File | null },
): Promise<void> => {
  const sanitized = validateSocialTextRules(content);
  const documentFile = options?.documentFile ?? null;
  if (!sanitized && !mediaFile && !documentFile) return;

  if (!hasSupabaseConfig) return;
  const user = await requireAuthUser();

  onProgress?.(10);
  let mediaUrl: string | null = null;
  let mediaType: "image" | "video" | null = null;
  let documentUrl: string | null = null;

  if (mediaFile) {
    const extension = mediaFile.name.split(".").pop() ?? "bin";
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    mediaUrl = await uploadFile("posts", path, mediaFile, (progress) => {
      const normalized = Math.min(Math.max(progress, 10), 90);
      onProgress?.(normalized);
    });
    mediaType = mediaFile.type.startsWith("video/") ? "video" : "image";
  }

  if (documentFile) {
    const extension = documentFile.name.split(".").pop() ?? "bin";
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    documentUrl = await uploadFile("posts", path, documentFile, (progress) => {
      const normalized = Math.min(Math.max(progress, 20), 90);
      onProgress?.(normalized);
    });
  }

  const documentLine = documentUrl ? `Documento (${documentFile?.name ?? "archivo"}): ${documentUrl}` : "";
  const finalContent = [sanitized || "", documentLine].filter(Boolean).join("\n\n");
  const context = getPostContextFromMedia(mediaType);
  await validateMentionsAllowed(finalContent, context, user.id);

  onProgress?.(95);
  const { error } = await supabase.from("posts").insert({
    author_id: user.id,
    content: finalContent,
    media_url: mediaUrl,
    media_type: mediaType,
  });

  if (error) throw error;
  onProgress?.(100);
  trackEventFireAndForget("post_create", { has_media: Boolean(mediaUrl), media_type: mediaType, has_document: Boolean(documentUrl) });
};

export const updatePost = async (postId: string, rawContent: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const content = requireNonEmptyText(validateSocialTextRules(rawContent), "El contenido no puede estar vacio");
  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("media_type")
    .eq("id", postId)
    .eq("author_id", user.id)
    .maybeSingle();
  if (postError) throw postError;

  const context = getPostContextFromMedia((post?.media_type as "image" | "video" | null | undefined) ?? null);
  await validateMentionsAllowed(content, context, user.id);

  const { error } = await supabase
    .from("posts")
    .update({ content })
    .eq("id", postId)
    .eq("author_id", user.id);
  if (error) throw error;
};

export const updateRetweetComment = async (postId: string, rawComment: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const { data, error } = await supabase
    .from("posts")
    .select("id,author_id,content,media_type")
    .eq("id", postId)
    .eq("author_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Publicacion no encontrada");

  const currentContent = (data.content as string | null) ?? "";
  const parsed = splitRetweetContent(currentContent);
  if (!parsed.isRetweet) throw new Error("Solo puedes editar el comentario de un contenido compartido");

  const nextComment = validateSocialTextRules(rawComment ?? "");
  const context = getPostContextFromMedia((data.media_type as "image" | "video" | null | undefined) ?? null);
  await validateMentionsAllowed(nextComment, context, user.id);
  const nextContent = nextComment ? `${nextComment}\n\n${parsed.rest}` : parsed.rest;

  const { error: updateError } = await supabase
    .from("posts")
    .update({ content: nextContent })
    .eq("id", postId)
    .eq("author_id", user.id);
  if (updateError) throw updateError;
};

export const deletePost = async (postId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", user.id);
  if (error) throw error;
};

export const reportPost = async (postId: string, reason: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!postId) throw new Error("Publicacion invalida");

  const reporterId = (await supabase.auth.getUser()).data.user?.id;
  if (!reporterId) throw new Error("No autenticado");

  const cleanedReason = validateSocialTextRules(reason.trim());
  if (!cleanedReason) throw new Error("Describe el motivo del reporte");
  if (cleanedReason.length > 400) throw new Error("El reporte no puede superar 400 caracteres.");
  enforceRateLimit({
    key: `report:post:${reporterId}`,
    maxRequests: 5,
    windowMs: 60_000,
    message: "Has enviado muchos reportes en poco tiempo. Espera un minuto.",
  });

  const { error } = await supabase.from("reports").insert({
    reporter_id: reporterId,
    target_type: "post",
    target_id: postId,
    reason: cleanedReason,
    status: "open",
  });

  if (error) throw error;
  trackEventFireAndForget("post_report_create", { post_id: postId });
};

export const getPostComments = async (postId: string): Promise<PostComment[]> => {
  if (!hasSupabaseConfig) return [];

  const { data, error } = await supabase
    .from("comments")
    .select("id,post_id,author_id,content,created_at,author:profiles(id,username,full_name,avatar_url,is_premium,is_verified)")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((item) => {
    const author = toSingle(item.author as Record<string, unknown> | Array<Record<string, unknown>> | null | undefined);

    return {
      id: item.id as string,
      post_id: item.post_id as string,
      author_id: item.author_id as string,
      content: item.content as string,
      created_at: item.created_at as string,
      author: author
        ? {
            id: author.id as string,
            username: author.username as string,
            full_name: author.full_name as string,
            avatar_url: (author.avatar_url as string | null) ?? null,
            is_premium: Boolean(author.is_premium),
            is_verified: Boolean(author.is_verified),
          }
        : undefined,
    } satisfies PostComment;
  });
};

export const addPostComment = async (postId: string, rawContent: string): Promise<void> => {
  const content = sanitizeInput(rawContent);
  if (!content) return;

  if (!hasSupabaseConfig) return;
  const user = await requireAuthUser();
  const { data: post, error: postError } = await supabase.from("posts").select("author_id,media_type").eq("id", postId).maybeSingle();
  if (postError) throw postError;
  if (!post) throw new Error("Publicacion no encontrada.");

  const context = getPostContextFromMedia((post.media_type as "image" | "video" | null | undefined) ?? null);
  await assertCanInteractWithUserContent(post.author_id as string, user.id, context, "comment");
  await validateMentionsAllowed(content, context, user.id);

  const { error } = await supabase.from("comments").insert({
    post_id: postId,
    author_id: user.id,
    content,
  });

  if (error) throw error;

  if (post?.author_id) {
    await createNotification(post.author_id as string, "comment", postId);
  }
  trackEventFireAndForget("comment_create", { post_id: postId });
};

export const toggleSavePost = async (postId: string): Promise<boolean> => {
  if (!hasSupabaseConfig) return true;

  const user = await requireAuthUser();
  const { data: post, error: postError } = await supabase.from("posts").select("author_id,media_type").eq("id", postId).maybeSingle();
  if (postError) throw postError;
  if (!post) throw new Error("Publicacion no encontrada.");

  const context = getPostContextFromMedia((post.media_type as "image" | "video" | null | undefined) ?? null);
  await assertCanInteractWithUserContent(post.author_id as string, user.id, context, "save");

  const { data: existing, error: existingError } = await supabase
    .from("saved_posts")
    .select("id")
    .eq("user_id", user.id)
    .eq("post_id", postId)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await supabase.from("saved_posts").delete().eq("id", existing.id);
    if (error) throw error;
    trackEventFireAndForget("post_unsave", { post_id: postId });
    return false;
  }

  const { error } = await supabase.from("saved_posts").insert({ user_id: user.id, post_id: postId });
  if (error) throw error;
  trackEventFireAndForget("post_save", { post_id: postId });
  return true;
};

export const sharePost = async (postId: string, rawComment?: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const { data: originalPost, error: originalPostError } = await supabase
    .from("posts")
    .select("id,author_id,content,media_url,media_type,profile:profiles(username,full_name,is_premium,is_verified)")
    .eq("id", postId)
    .maybeSingle();
  if (originalPostError) throw originalPostError;
  if (!originalPost) throw new Error("Publicacion no encontrada");

  const context = getPostContextFromMedia((originalPost.media_type as "image" | "video" | null | undefined) ?? null);
  await assertCanInteractWithUserContent(originalPost.author_id as string, user.id, context, "share");

  const originalAuthor = toSingle(
    originalPost.profile as { username?: string | null; full_name?: string | null } | Array<{ username?: string | null; full_name?: string | null }>,
  );
  const originalHandle = originalAuthor?.username ?? "usuario";
  const shareComment = validateSocialTextRules(rawComment ?? "");
  const originalText = ((originalPost.content as string | null) ?? "").trim();
  const shareTextBase = `Compartio una publicacion de @${originalHandle}`;
  const sharedPostContent = sanitizeInput(
    [shareComment, shareTextBase, originalText].filter((part) => part && part.length > 0).join("\n\n"),
  ) ?? shareTextBase;
  await validateMentionsAllowed(sharedPostContent, context, user.id);

  const { data: createdSharedPost, error: createdSharedPostError } = await supabase
    .from("posts")
    .insert({
      author_id: user.id,
      content: sharedPostContent,
      media_url: (originalPost.media_url as string | null) ?? null,
      media_type: (originalPost.media_type as "image" | "video" | null) ?? null,
      shared_target_type: "post",
      shared_target_id: postId,
    })
    .select("id")
    .maybeSingle();
  if (createdSharedPostError) throw createdSharedPostError;

  const { error } = await supabase.from("shared_posts").insert({ user_id: user.id, post_id: postId });
  if (error) throw error;

  const { data: post, error: postError } = await supabase.from("posts").select("author_id").eq("id", postId).maybeSingle();
  if (postError) throw postError;
  if (post?.author_id) {
    await createNotification(post.author_id as string, "share", postId);
  }
  trackEventFireAndForget("post_share", { post_id: postId, shared_post_id: createdSharedPost?.id ?? null });
};

export const getStories = async (): Promise<Story[]> => {
  if (!hasSupabaseConfig) return mockStories;
  const viewerId = await resolveViewerId();
  const { data, error } = await supabase
    .from("stories")
    .select("id,author_id,media_url,media_type,description,created_at,expires_at,profile:profiles(id,username,full_name,avatar_url,is_premium,is_verified)")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) throw error;
  const stories: Story[] = ((data ?? []) as Array<Record<string, unknown>>).map((item) => {
    const profile = toSingle(item.profile as Story["profile"] | Story["profile"][]);
    return {
    id: item.id as string,
    author_id: item.author_id as string,
    media_url: item.media_url as string,
    media_type: item.media_type as "image" | "video",
    description: (item.description as string | null) ?? null,
    created_at: item.created_at as string,
    expires_at: item.expires_at as string,
    ...(profile ? { profile } : {}),
  }});

  const visibility = await Promise.all(
    stories.map(async (story) => ((await canViewUserContent(story.author_id, viewerId, "stories")) ? story : null)),
  );
  return visibility.filter((story): story is Story => Boolean(story));
};

export const createStory = async (
  file: File,
  onProgress?: (progress: number) => void,
  rawDescription?: string,
): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const description = validateSocialTextRules(rawDescription ?? "");
  await validateMentionsAllowed(description, "stories", user.id);
  const mediaType: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
  const extension = file.name.split(".").pop() ?? (mediaType === "video" ? "mp4" : "jpg");
  const path = `${user.id}/story-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  onProgress?.(10);
  const mediaUrl = await uploadFile("stories", path, file, (progress) => {
    const normalized = Math.min(Math.max(progress, 10), 95);
    onProgress?.(normalized);
  });

  const { error } = await supabase.from("stories").insert({
    author_id: user.id,
    media_url: mediaUrl,
    media_type: mediaType,
    description,
  });
  if (error) throw error;

  onProgress?.(100);
  trackEventFireAndForget("story_create", { media_type: mediaType });
};

export const updateStory = async (storyId: string, rawDescription: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const description = validateSocialTextRules(rawDescription ?? "");
  await validateMentionsAllowed(description, "stories", user.id);
  const { error } = await supabase
    .from("stories")
    .update({ description })
    .eq("id", storyId)
    .eq("author_id", user.id);
  if (error) throw error;
};

export const deleteStory = async (storyId: string): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const user = await requireAuthUser();

  const { error } = await supabase
    .from("stories")
    .delete()
    .eq("id", storyId)
    .eq("author_id", user.id);
  if (error) throw error;
};

export const reportStory = async (storyId: string, reason: string): Promise<void> => {
  if (!hasSupabaseConfig) return;
  if (!storyId) throw new Error("Historia invalida");

  const reporterId = (await supabase.auth.getUser()).data.user?.id;
  if (!reporterId) throw new Error("No autenticado");

  const cleanedReason = validateSocialTextRules(reason.trim());
  if (!cleanedReason) throw new Error("Describe el motivo del reporte");
  if (cleanedReason.length > 400) throw new Error("El reporte no puede superar 400 caracteres.");
  enforceRateLimit({
    key: `report:story:${reporterId}`,
    maxRequests: 5,
    windowMs: 60_000,
    message: "Has enviado muchos reportes en poco tiempo. Espera un minuto.",
  });

  const { error } = await supabase.from("reports").insert({
    reporter_id: reporterId,
    target_type: "story",
    target_id: storyId,
    reason: cleanedReason,
    status: "open",
  });
  if (error) throw error;

  trackEventFireAndForget("story_report_create", { story_id: storyId });
};

export const getReels = async (): Promise<Reel[]> => {
  if (!hasSupabaseConfig) return mockReels;
  const { data, error } = await supabase.from("reels").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Reel[]) ?? [];
};

export const getReelsByAuthor = async (authorId: string): Promise<Reel[]> => {
  if (!authorId) return [];
  if (!hasSupabaseConfig) return mockReels.filter((reel) => reel.author_id === authorId);

  const { data, error } = await supabase
    .from("reels")
    .select("*")
    .eq("author_id", authorId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as Reel[]) ?? [];
};

export const toggleLikePost = async (postId: string): Promise<boolean> => {
  if (!hasSupabaseConfig) return true;
  const user = await requireAuthUser();
  const { data: post, error: postError } = await supabase.from("posts").select("author_id,media_type").eq("id", postId).maybeSingle();
  if (postError) throw postError;
  if (!post) throw new Error("Publicacion no encontrada.");

  const context = getPostContextFromMedia((post.media_type as "image" | "video" | null | undefined) ?? null);
  await assertCanInteractWithUserContent(post.author_id as string, user.id, context, "like");

  const { data: existing, error: existingError } = await supabase
    .from("post_reactions")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { error: deleteError } = await supabase.from("post_reactions").delete().eq("id", existing.id);
    if (deleteError) throw deleteError;
    trackEventFireAndForget("post_unlike", { post_id: postId });
    return false;
  }

  const { error } = await supabase.from("post_reactions").upsert({ post_id: postId, user_id: user.id, reaction: "like" });
  if (error) throw error;

  if (post?.author_id) {
    await createNotification(post.author_id as string, "like", postId);
  }
  trackEventFireAndForget("post_like", { post_id: postId });
  return true;
};

export const reactToPost = async (postId: string): Promise<void> => {
  await toggleLikePost(postId);
};
