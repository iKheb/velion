import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedList } from "@/features/social/feed-list";
import { PostComposer } from "@/features/social/post-composer";
import { PostCard } from "@/features/social/post-card";
import { StoriesStrip } from "@/features/social/stories-strip";
import { StreamCard } from "@/features/streaming/stream-card";
import { getProfileRoute, ROUTES } from "@/lib/constants";
import { getReelsFeed, getReelsByAuthor } from "@/services/reels.service";
import { globalSearch, type FeedMode, type GlobalSearchScope } from "@/services/social.service";
import { hasSupabaseConfig, supabase } from "@/services/supabase";
import { getStreams, getStreamsByStreamer, getStreamVodsByOwner } from "@/services/streaming.service";
import type { Reel, Stream, StreamVod } from "@/types/models";

const HOME_SEARCH_SCOPE_OPTIONS: Array<{ key: GlobalSearchScope; label: string }> = [
  { key: "all", label: "Todos" },
  { key: "profiles", label: "Usuarios" },
  { key: "posts", label: "Publicaciones" },
  { key: "reels", label: "Reels" },
  { key: "streams", label: "Streams" },
  { key: "vods", label: "VODs" },
  { key: "videos", label: "Videos" },
];

type HomeFeedFilter = "all" | "posts" | "reels" | "streams" | "vods" | "videos";

const HOME_FEED_FILTER_OPTIONS: Array<{ key: HomeFeedFilter; label: string }> = [
  { key: "all", label: "Todo" },
  { key: "posts", label: "Publicaciones" },
  { key: "reels", label: "Reels" },
  { key: "streams", label: "Streams" },
  { key: "vods", label: "VODs" },
  { key: "videos", label: "Videos" },
];

export default function HomePage() {
  const [feedMode, setFeedMode] = useState<FeedMode>("for_you");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [searchScope, setSearchScope] = useState<GlobalSearchScope>("all");
  const [feedFilter, setFeedFilter] = useState<HomeFeedFilter>("all");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchText(searchText.trim());
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [searchText]);

  const isSearching = debouncedSearchText.length > 0;
  const searchQuery = useQuery({
    queryKey: ["home-global-search", debouncedSearchText, searchScope],
    queryFn: () => globalSearch(debouncedSearchText, searchScope, 40),
    enabled: isSearching,
  });

  const profileResults = searchQuery.data?.profiles ?? [];
  const postResults = searchQuery.data?.posts ?? [];
  const reelResults = searchQuery.data?.reels ?? [];
  const streamResults = searchQuery.data?.streams ?? [];
  const vodResults = searchQuery.data?.vods ?? [];
  const videoEntries = [...postResults.filter((post) => post.media_type === "video"), ...vodResults, ...reelResults];
  const showProfiles = searchScope === "all" || searchScope === "profiles";
  const showPosts = searchScope === "all" || searchScope === "posts";
  const showReels = searchScope === "all" || searchScope === "reels";
  const showStreams = searchScope === "all" || searchScope === "streams";
  const showVods = searchScope === "all" || searchScope === "vods";
  const showVideos = searchScope === "videos";
  const isSearchLoading = searchQuery.isLoading;

  const followingIdsQuery = useQuery({
    queryKey: ["home-following-ids", feedMode],
    enabled: !isSearching && feedMode === "following" && (feedFilter === "reels" || feedFilter === "streams" || feedFilter === "vods" || feedFilter === "videos"),
    queryFn: async () => {
      if (!hasSupabaseConfig) return [] as string[];
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!me) return [] as string[];
      const { data, error } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", me);
      if (error) throw error;
      const ids = ((data ?? []) as Array<{ following_id: string }>).map((row) => row.following_id);
      return Array.from(new Set([me, ...ids]));
    },
  });

  const filteredContentQuery = useQuery({
    queryKey: ["home-filtered-content", feedMode, feedFilter, followingIdsQuery.data],
    enabled: !isSearching && (feedFilter === "reels" || feedFilter === "streams" || feedFilter === "vods" || feedFilter === "videos"),
    queryFn: async () => {
      const shouldUseFollowing = feedMode === "following";
      const followedIds = shouldUseFollowing ? (followingIdsQuery.data ?? []) : [];

      if (feedFilter === "reels" || feedFilter === "videos") {
        if (!shouldUseFollowing) {
          const reels = await getReelsFeed(40);
          return { reels, streams: [] as Stream[], vods: [] as StreamVod[] };
        }

        if (!followedIds.length) return { reels: [] as Reel[], streams: [] as Stream[], vods: [] as StreamVod[] };
        const reelsByAuthor = await Promise.all(followedIds.map((authorId) => getReelsByAuthor(authorId, 20)));
        const reels = reelsByAuthor
          .flat()
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 60);
        return { reels, streams: [] as Stream[], vods: [] as StreamVod[] };
      }

      if (feedFilter === "streams") {
        if (!shouldUseFollowing) {
          const streams = await getStreams();
          return { reels: [] as Reel[], streams: streams.slice(0, 40), vods: [] as StreamVod[] };
        }

        if (!followedIds.length) return { reels: [] as Reel[], streams: [] as Stream[], vods: [] as StreamVod[] };
        const streamsByAuthor = await Promise.all(followedIds.map((streamerId) => getStreamsByStreamer(streamerId)));
        const streams = streamsByAuthor
          .flat()
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 60);
        return { reels: [] as Reel[], streams, vods: [] as StreamVod[] };
      }

      if (feedFilter === "vods") {
        if (shouldUseFollowing && !followedIds.length) return { reels: [] as Reel[], streams: [] as Stream[], vods: [] as StreamVod[] };

        if (!shouldUseFollowing) {
          if (!hasSupabaseConfig) return { reels: [] as Reel[], streams: [] as Stream[], vods: [] as StreamVod[] };
          const { data, error } = await supabase
            .from("stream_vods")
            .select("*")
            .eq("status", "ready")
            .in("visibility", ["public", "unlisted"])
            .order("promoted_until", { ascending: false, nullsFirst: false })
            .order("promotion_credits", { ascending: false })
            .order("published_at", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(60);
          if (error) throw error;
          return { reels: [] as Reel[], streams: [] as Stream[], vods: ((data ?? []) as StreamVod[]) };
        }

        const vodsByOwner = await Promise.all(followedIds.map((ownerId) => getStreamVodsByOwner(ownerId)));
        const vods = vodsByOwner
          .flat()
          .sort((a, b) => {
            const left = a.published_at ?? a.created_at;
            const right = b.published_at ?? b.created_at;
            return new Date(right).getTime() - new Date(left).getTime();
          })
          .slice(0, 60);
        return { reels: [] as Reel[], streams: [] as Stream[], vods };
      }

      return { reels: [] as Reel[], streams: [] as Stream[], vods: [] as StreamVod[] };
    },
  });

  const filteredReels = filteredContentQuery.data?.reels ?? [];
  const filteredStreams = filteredContentQuery.data?.streams ?? [];
  const filteredVods = filteredContentQuery.data?.vods ?? [];
  const isFilteredLoading = filteredContentQuery.isLoading || (feedMode === "following" && followingIdsQuery.isLoading);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <section className="rounded-2xl border border-velion-steel/70 bg-velion-discord/40 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Buscar publicaciones, videos, streams y reels"
            className="pl-10"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {isSearching
            ? HOME_SEARCH_SCOPE_OPTIONS.map((scope) => (
                <Button
                  key={scope.key}
                  type="button"
                  className={`text-xs ${searchScope === scope.key ? "" : "bg-zinc-700 hover:bg-zinc-600"}`}
                  onClick={() => setSearchScope(scope.key)}
                >
                  {scope.label}
                </Button>
              ))
            : HOME_FEED_FILTER_OPTIONS.map((option) => (
                <Button
                  key={option.key}
                  type="button"
                  className={`text-xs ${feedFilter === option.key ? "" : "bg-zinc-700 hover:bg-zinc-600"}`}
                  onClick={() => setFeedFilter(option.key)}
                >
                  {option.label}
                </Button>
              ))}
        </div>
      </section>
      <StoriesStrip />
      <div className="flex items-end justify-between gap-3">
        <div className="grid w-full grid-cols-2 gap-2 sm:w-[280px]">
          <Button className={`text-xs ${feedMode === "for_you" ? "" : "bg-zinc-700 hover:bg-zinc-600"}`} onClick={() => setFeedMode("for_you")}>
            Para ti
          </Button>
          <Button className={`text-xs ${feedMode === "following" ? "" : "bg-zinc-700 hover:bg-zinc-600"}`} onClick={() => setFeedMode("following")}>
            Siguiendo
          </Button>
        </div>
        <PostComposer compact />
      </div>
      {isSearching ? (
        <section className="space-y-4">
          {isSearchLoading && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {!isSearchLoading && (
            <>
              {showProfiles && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-zinc-200">Perfiles</h2>
                  {profileResults.length === 0 && (
                    <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No se encontraron perfiles.</p>
                  )}
                  {profileResults.map((profile) => (
                    <Link
                      key={profile.id}
                      to={getProfileRoute(profile.username)}
                      className="flex items-center gap-3 rounded-xl border border-velion-steel/60 bg-velion-black/30 p-3 transition hover:bg-velion-black/50"
                    >
                      <img src={profile.avatar_url ?? "https://placehold.co/80"} alt="avatar" className="h-10 w-10 rounded-full object-cover" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-100">{profile.full_name}</p>
                        <p className="truncate text-xs text-zinc-400">@{profile.username}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {showPosts && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-zinc-200">Publicaciones</h2>
                  {postResults.length === 0 && (
                    <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No se encontraron publicaciones.</p>
                  )}
                  {postResults.map((post) => <PostCard key={post.id} post={post} />)}
                </div>
              )}

              {showReels && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-zinc-200">Reels</h2>
                  {reelResults.length === 0 && (
                    <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No se encontraron reels.</p>
                  )}
                  {reelResults.map((reel) => (
                    <Link
                      key={reel.id}
                      to={ROUTES.reels}
                      className="block rounded-xl border border-velion-steel/60 bg-velion-black/30 p-3 transition hover:bg-velion-black/50"
                    >
                      <div className="relative h-40 overflow-hidden rounded-xl bg-black">
                        {reel.thumbnail_url ? (
                          <img src={reel.thumbnail_url} alt={reel.title ?? "Reel"} className="h-full w-full object-cover" />
                        ) : (
                          <video src={reel.video_url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                        )}
                        <span className="absolute left-2 top-2 rounded bg-zinc-900/80 px-2 py-1 text-xs font-semibold text-zinc-100">REEL</span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-zinc-100">{reel.title || "Reel"}</p>
                      {reel.description ? <p className="mt-1 line-clamp-2 text-xs text-zinc-300">{reel.description}</p> : null}
                      <p className="mt-2 text-xs text-zinc-400">{reel.views_count ?? 0} views</p>
                    </Link>
                  ))}
                </div>
              )}

              {showVods && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-zinc-200">VODs</h2>
                  {vodResults.length === 0 && (
                    <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No se encontraron VODs.</p>
                  )}
                  {vodResults.map((vod) => (
                    <Link
                        key={vod.id}
                        to={`${ROUTES.streaming}/video/${vod.id}`}
                        className="block rounded-xl border border-velion-steel/60 bg-velion-black/30 p-3 transition hover:bg-velion-black/50"
                      >
                        <div className="relative h-40 overflow-hidden rounded-xl bg-black">
                          {vod.thumbnail_url ? (
                            <img src={vod.thumbnail_url} alt={vod.title} className="h-full w-full object-cover" />
                          ) : (
                            <div className="grid h-full place-content-center text-zinc-400">Miniatura no disponible</div>
                          )}
                          <span className="absolute left-2 top-2 rounded bg-zinc-900/80 px-2 py-1 text-xs font-semibold text-zinc-100">VIDEO</span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-zinc-100">{vod.title}</p>
                        {vod.description ? <p className="mt-1 line-clamp-2 text-xs text-zinc-300">{vod.description}</p> : null}
                        <p className="mt-2 text-xs text-zinc-400">{vod.views_count ?? 0} views</p>
                      </Link>
                    ))}
                </div>
              )}

              {showStreams && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-zinc-200">Streams</h2>
                  {streamResults.length === 0 && (
                    <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No se encontraron streams.</p>
                  )}
                  {streamResults.map((stream) => <StreamCard key={stream.id} stream={stream} />)}
                </div>
              )}

              {showVideos && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-zinc-200">Videos</h2>
                  {videoEntries.length === 0 && (
                    <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No se encontraron videos.</p>
                  )}
                  {videoEntries.map((item) =>
                    "media_type" in item ? (
                      <PostCard key={`post-${item.id}`} post={item} />
                    ) : "video_url" in item ? (
                      <Link
                        key={`reel-${item.id}`}
                        to={ROUTES.reels}
                        className="block rounded-xl border border-velion-steel/60 bg-velion-black/30 p-3 transition hover:bg-velion-black/50"
                      >
                        <p className="text-sm font-semibold text-zinc-100">{item.title || "Reel"}</p>
                        {item.description ? <p className="mt-1 text-xs text-zinc-300">{item.description}</p> : null}
                        <p className="mt-2 text-xs text-zinc-400">{item.views_count ?? 0} views</p>
                      </Link>
                    ) : (
                      <Link
                        key={`vod-${item.id}`}
                        to={`${ROUTES.streaming}/video/${item.id}`}
                        className="block rounded-xl border border-velion-steel/60 bg-velion-black/30 p-3 transition hover:bg-velion-black/50"
                      >
                        <p className="text-sm font-semibold text-zinc-100">{item.title}</p>
                        {item.description ? <p className="mt-1 text-xs text-zinc-300">{item.description}</p> : null}
                        <p className="mt-2 text-xs text-zinc-400">{item.views_count ?? 0} views</p>
                      </Link>
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="space-y-4">
          {(feedFilter === "all" || feedFilter === "posts") && <FeedList mode={feedMode} />}

          {(feedFilter === "reels" || feedFilter === "videos") && (
            <div className="space-y-3">
              {feedFilter === "reels" && <h2 className="text-sm font-semibold text-zinc-200">Reels</h2>}
              {feedFilter === "videos" && <h2 className="text-sm font-semibold text-zinc-200">Videos</h2>}
              {isFilteredLoading && (
                <div className="space-y-3">
                  <Skeleton className="h-44 w-full" />
                  <Skeleton className="h-44 w-full" />
                </div>
              )}
              {!isFilteredLoading && filteredReels.length === 0 && feedFilter === "reels" && (
                <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No hay reels para mostrar.</p>
              )}
              {!isFilteredLoading && filteredReels.length === 0 && feedFilter === "videos" && filteredVods.length === 0 && (
                <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No hay videos para mostrar.</p>
              )}
              {filteredReels.map((reel) => (
                <Link
                  key={reel.id}
                  to={ROUTES.reels}
                  className="block rounded-xl border border-velion-steel/60 bg-velion-black/30 p-3 transition hover:bg-velion-black/50"
                >
                  <div className="relative h-40 overflow-hidden rounded-xl bg-black">
                    {reel.thumbnail_url ? (
                      <img src={reel.thumbnail_url} alt={reel.title ?? "Reel"} className="h-full w-full object-cover" />
                    ) : (
                      <video src={reel.video_url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                    )}
                    <span className="absolute left-2 top-2 rounded bg-zinc-900/80 px-2 py-1 text-xs font-semibold text-zinc-100">REEL</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-zinc-100">{reel.title || "Reel"}</p>
                  {reel.description ? <p className="mt-1 line-clamp-2 text-xs text-zinc-300">{reel.description}</p> : null}
                  <p className="mt-2 text-xs text-zinc-400">{reel.views_count ?? 0} views</p>
                </Link>
              ))}
            </div>
          )}

          {feedFilter === "streams" && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-zinc-200">Streams</h2>
              {isFilteredLoading && (
                <div className="space-y-3">
                  <Skeleton className="h-56 w-full" />
                  <Skeleton className="h-56 w-full" />
                </div>
              )}
              {!isFilteredLoading && filteredStreams.length === 0 && (
                <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No hay streams para mostrar.</p>
              )}
              {filteredStreams.map((stream) => <StreamCard key={stream.id} stream={stream} />)}
            </div>
          )}

          {(feedFilter === "vods" || feedFilter === "videos") && (
            <div className="space-y-3">
              {feedFilter === "vods" && <h2 className="text-sm font-semibold text-zinc-200">VODs</h2>}
              {feedFilter === "videos" && filteredVods.length > 0 && <h2 className="text-sm font-semibold text-zinc-200">VODs</h2>}
              {isFilteredLoading && (
                <div className="space-y-3">
                  <Skeleton className="h-44 w-full" />
                  <Skeleton className="h-44 w-full" />
                </div>
              )}
              {!isFilteredLoading && filteredVods.length === 0 && feedFilter === "vods" && (
                <p className="rounded-xl bg-velion-black/40 p-3 text-sm text-zinc-400">No hay videos de canal para mostrar.</p>
              )}
              {filteredVods.map((vod) => (
                <Link
                  key={vod.id}
                  to={`${ROUTES.streaming}/video/${vod.id}`}
                  className="block rounded-xl border border-velion-steel/60 bg-velion-black/30 p-3 transition hover:bg-velion-black/50"
                >
                  <div className="relative h-40 overflow-hidden rounded-xl bg-black">
                    {vod.thumbnail_url ? (
                      <img src={vod.thumbnail_url} alt={vod.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-content-center text-zinc-400">Miniatura no disponible</div>
                    )}
                    <span className="absolute left-2 top-2 rounded bg-zinc-900/80 px-2 py-1 text-xs font-semibold text-zinc-100">VIDEO</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-zinc-100">{vod.title}</p>
                  {vod.description ? <p className="mt-1 line-clamp-2 text-xs text-zinc-300">{vod.description}</p> : null}
                  <p className="mt-2 text-xs text-zinc-400">{vod.views_count ?? 0} views</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </motion.div>
  );
}
