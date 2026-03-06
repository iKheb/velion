import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { PostCard } from "@/features/social/post-card";
import { toAppError } from "@/services/error.service";
import { acceptFriendRequest, listFriends, listIncomingFriendRequests } from "@/services/relations.service";
import { getReelsByAuthor } from "@/services/reels.service";
import { getPostsByAuthor, getSavedPostsByUser } from "@/services/social.service";
import { createStreamVod, getStreamsByStreamer, getStreamVodsByOwner } from "@/services/streaming.service";
import { uploadFile } from "@/services/storage.service";
import type { Reel, Stream, StreamVod } from "@/types/models";
import type { Profile } from "@/types/models";
import { getProfileRoute } from "@/lib/constants";
import { getExternalLinkLabel, getExternalLinks } from "@/lib/profile-links";
import { invalidateMany } from "@/lib/query-utils";
import { validateSocialTextRules } from "@/lib/social-text-rules";

interface ProfileTabsProps {
  profile: Profile;
  isOwnProfile: boolean;
}

const tabs = ["Posts", "Guardados", "Canal", "Amigos", "Sobre mi"] as const;
type TabKey = (typeof tabs)[number];
type ChannelFilter = "todos" | "videos" | "streams" | "reels";

const getYoutubeThumbnail = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    let videoId = "";
    if (host.includes("youtu.be")) {
      videoId = parsed.pathname.replace("/", "").trim();
    } else if (host.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/shorts/")) {
        videoId = parsed.pathname.replace("/shorts/", "").split("/")[0] ?? "";
      } else {
        videoId = parsed.searchParams.get("v") ?? "";
      }
    }

    if (!videoId) return null;
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  } catch {
    return null;
  }
};

const getVodThumbnail = (vod: StreamVod): string => {
  return vod.thumbnail_url || getYoutubeThumbnail(vod.vod_url) || "https://placehold.co/1280x720?text=Video";
};

export function ProfileTabs({ profile, isOwnProfile }: ProfileTabsProps) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("Posts");
  const [error, setError] = useState<string | null>(null);
  const [openUploadVideoModal, setOpenUploadVideoModal] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDescription, setVideoDescription] = useState("");
  const [videoThumbnailUrl, setVideoThumbnailUrl] = useState("");
  const [videoDurationSeconds, setVideoDurationSeconds] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("todos");
  const videoPreviewUrl = useMemo(() => (videoFile ? URL.createObjectURL(videoFile) : null), [videoFile]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const shouldOpenUpload = Boolean(params.get("open_upload_video"));
    const targetTab = params.get("tab");

    if (targetTab?.toLowerCase() === "canal") {
      setActiveTab("Canal");
    }

    if (isOwnProfile && shouldOpenUpload) {
      setActiveTab("Canal");
      setOpenUploadVideoModal(true);
    }
  }, [isOwnProfile, location.search]);

  const extractVideoMetadata = async (file: File): Promise<{ durationSeconds: number; thumbnailDataUrl: string | null }> => {
    const localUrl = URL.createObjectURL(file);
    try {
      const durationSeconds = await new Promise<number>((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.src = localUrl;
        video.onloadedmetadata = () => {
          const duration = Number.isFinite(video.duration) ? Math.max(0, Math.floor(video.duration)) : 0;
          resolve(duration);
        };
        video.onerror = () => reject(new Error("No se pudo leer el video."));
      });

      const thumbnailDataUrl = await new Promise<string | null>((resolve) => {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;
        video.src = localUrl;
        video.currentTime = Math.min(1, Math.max(durationSeconds - 0.1, 0));
        video.onloadeddata = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth || 1280;
            canvas.height = video.videoHeight || 720;
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(null);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          } catch {
            resolve(null);
          }
        };
        video.onerror = () => resolve(null);
      });

      return { durationSeconds, thumbnailDataUrl };
    } finally {
      URL.revokeObjectURL(localUrl);
    }
  };

  const postsQuery = useQuery({
    queryKey: ["profile-posts", profile.id],
    queryFn: () => getPostsByAuthor(profile.id, 40),
    enabled: activeTab === "Posts",
  });

  const friendsQuery = useQuery({
    queryKey: ["profile-friends", profile.id],
    queryFn: () => listFriends(profile.id),
    enabled: activeTab === "Amigos",
  });

  const savedPostsQuery = useQuery({
    queryKey: ["profile-saved-posts", profile.id],
    queryFn: () => getSavedPostsByUser(profile.id, 40),
    enabled: activeTab === "Guardados" && isOwnProfile,
  });

  const streamsQuery = useQuery({
    queryKey: ["profile-streams", profile.id],
    queryFn: () => getStreamsByStreamer(profile.id),
    enabled: activeTab === "Canal",
  });

  const vodsQuery = useQuery({
    queryKey: ["profile-vods", profile.id],
    queryFn: () => getStreamVodsByOwner(profile.id),
    enabled: activeTab === "Canal",
  });

  const reelsQuery = useQuery({
    queryKey: ["profile-reels", profile.id],
    queryFn: () => getReelsByAuthor(profile.id),
    enabled: activeTab === "Canal",
  });

  const incomingRequestsQuery = useQuery({
    queryKey: ["profile-incoming-friend-requests"],
    queryFn: listIncomingFriendRequests,
    enabled: activeTab === "Amigos" && isOwnProfile,
  });

  const acceptMutation = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        ["profile-friends", profile.id],
        ["profile-incoming-friend-requests"],
        ["profile-stats", profile.id],
      ]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const createVodMutation = useMutation({
    mutationFn: async () => {
      if (!videoFile) throw new Error("Selecciona un video desde tu PC.");
      const extension = videoFile.name.split(".").pop() ?? "mp4";
      const path = `${profile.id}/vod-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      const resolvedVideoUrl = await uploadFile("clips", path, videoFile, setUploadProgress);

      await createStreamVod({
        title: videoTitle,
        description: videoDescription,
        vodUrl: resolvedVideoUrl,
        thumbnailUrl: videoThumbnailUrl || null,
        durationSeconds: videoDurationSeconds ? Number(videoDurationSeconds) : null,
        visibility: "public",
      });
    },
    onSuccess: async () => {
      setVideoTitle("");
      setVideoDescription("");
      setVideoThumbnailUrl("");
      setVideoDurationSeconds("");
      setVideoFile(null);
      setUploadProgress(0);
      setOpenUploadVideoModal(false);
      await invalidateMany(queryClient, [["profile-vods", profile.id]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const handleVideoFileChange = async (file: File | null) => {
    setVideoFile(file);
    setUploadProgress(0);
    if (!file) {
      setVideoThumbnailUrl("");
      setVideoDurationSeconds("");
      return;
    }

    try {
      const { durationSeconds, thumbnailDataUrl } = await extractVideoMetadata(file);
      setVideoDurationSeconds(String(durationSeconds));
      if (thumbnailDataUrl) setVideoThumbnailUrl(thumbnailDataUrl);
    } catch {
      // Keep modal usable even if metadata extraction fails.
    }
  };
  const profileLinks = getExternalLinks(profile);
  const links = Object.entries(profileLinks) as Array<[string, string]>;

  const streams = streamsQuery.data ?? [];
  const vods = vodsQuery.data ?? [];
  const reels = reelsQuery.data ?? [];

  const mixedChannelItems = useMemo(() => {
    const mixed = [
      ...streams.map((stream) => ({ kind: "stream" as const, id: stream.id, createdAt: stream.created_at, stream })),
      ...vods.map((vod) => ({ kind: "video" as const, id: vod.id, createdAt: vod.created_at, vod })),
      ...reels.map((reel) => ({ kind: "reel" as const, id: reel.id, createdAt: reel.created_at, reel })),
    ];

    return mixed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [reels, streams, vods]);

  const renderStreamCard = (stream: Stream) => {
    const relatedVod = vods.find((vod) => vod.stream_id === stream.id);
    const streamThumb = relatedVod ? getVodThumbnail(relatedVod) : "https://placehold.co/1280x720?text=Stream";

    return (
      <article key={stream.id} className="overflow-hidden rounded-lg bg-velion-black/40">
        <Link to={`/streaming/${stream.id}`} className="block">
          <div className="relative aspect-video w-full overflow-hidden bg-black">
            <img src={streamThumb} alt={stream.title} className="h-full w-full object-cover" loading="lazy" />
          </div>
        </Link>
        <div className="space-y-1 p-2">
          <p className="line-clamp-2 text-xs font-medium text-zinc-100">{stream.title}</p>
          <p className="text-[11px] text-zinc-400">{new Date(stream.created_at).toLocaleDateString()}</p>
        </div>
      </article>
    );
  };

  const renderVideoCard = (vod: StreamVod) => (
    <Link
      key={vod.id}
      to={`/streaming/video/${vod.id}`}
      className="group overflow-hidden rounded-lg bg-velion-black/40 hover:bg-velion-black/60"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <img
          src={getVodThumbnail(vod)}
          alt={vod.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />
      </div>
      <div className="space-y-1 p-2">
        <p className="line-clamp-2 text-xs font-medium text-zinc-100">{vod.title}</p>
        <p className="text-[11px] text-zinc-400">{new Date(vod.created_at).toLocaleDateString()}</p>
      </div>
    </Link>
  );

  const renderReelCard = (reel: Reel, widescreen = false) => (
    <article key={reel.id} className="overflow-hidden rounded-lg bg-velion-black/40">
      <a href={reel.video_url} target="_blank" rel="noreferrer" className="block">
        <div className={`relative w-full overflow-hidden bg-black ${widescreen ? "aspect-video" : "aspect-[9/16]"}`}>
          {widescreen && reel.thumbnail_url ? (
            <img src={reel.thumbnail_url} alt={reel.title || "Reel"} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <video src={reel.video_url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
          )}
        </div>
      </a>
      <div className="space-y-1 p-2">
        <p className="line-clamp-2 text-xs font-medium text-zinc-100">{reel.title || "Reel"}</p>
        <p className="text-[11px] text-zinc-400">{new Date(reel.created_at).toLocaleDateString()}</p>
      </div>
    </article>
  );

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-3 py-2 text-sm transition ${
              activeTab === tab ? "bg-velion-fuchsia/30 text-white" : "bg-velion-black/50 hover:bg-velion-fuchsia/25"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {activeTab === "Posts" && (
        <div className="space-y-4">
          {postsQuery.isLoading && (
            <>
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </>
          )}
          {(postsQuery.data ?? []).length === 0 && <p className="text-xs text-zinc-400">Este perfil aun no tiene posts.</p>}
          {(postsQuery.data ?? []).map((post) => <PostCard key={post.id} post={post} />)}
        </div>
      )}

      {activeTab === "Canal" && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {(["todos", "videos", "streams", "reels"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setChannelFilter(filter)}
                className={`rounded-lg px-3 py-1.5 text-xs transition ${
                  channelFilter === filter ? "bg-velion-fuchsia/30 text-white" : "bg-velion-black/50 text-zinc-300 hover:bg-velion-fuchsia/25"
                }`}
              >
                {filter === "todos" ? "Todos" : filter === "videos" ? "Videos" : filter === "streams" ? "Streams" : "Reels"}
              </button>
            ))}
          </div>
          {channelFilter === "todos" && (
            <div className="space-y-2">
              {(streamsQuery.isLoading || vodsQuery.isLoading || reelsQuery.isLoading) && (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="aspect-video w-full rounded-lg" />
                </div>
              )}
              {mixedChannelItems.length === 0 && (
                <p className="text-xs text-zinc-400">
                  {isOwnProfile ? "Aun no has agregado contenido al canal." : "Este perfil aun no tiene contenido en el canal."}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                {mixedChannelItems.map((item) => {
                  if (item.kind === "stream") return renderStreamCard(item.stream);
                  if (item.kind === "video") return renderVideoCard(item.vod);
                  return renderReelCard(item.reel, true);
                })}
              </div>
            </div>
          )}

          {channelFilter === "streams" && (
            <div className="space-y-2">
              {streamsQuery.isLoading && (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="aspect-video w-full rounded-lg" />
                </div>
              )}
              {streams.length === 0 && (
                <p className="text-xs text-zinc-400">
                  {isOwnProfile ? "Aun no has creado streams." : "Este perfil aun no tiene streams recientes."}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">{streams.map(renderStreamCard)}</div>
            </div>
          )}

          {channelFilter === "videos" && (
            <div className="space-y-2">
              {vodsQuery.isLoading && (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="aspect-video w-full rounded-lg" />
                </div>
              )}
              {vods.length === 0 && (
                <p className="text-xs text-zinc-400">
                  {isOwnProfile ? "Aun no has subido videos." : "Este perfil aun no tiene videos publicados."}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">{vods.map(renderVideoCard)}</div>
            </div>
          )}

          {channelFilter === "reels" && (
            <div className="space-y-2">
              {reelsQuery.isLoading && (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                  <Skeleton className="aspect-[9/16] w-full rounded-lg" />
                  <Skeleton className="aspect-[9/16] w-full rounded-lg" />
                  <Skeleton className="aspect-[9/16] w-full rounded-lg" />
                </div>
              )}
              {reels.length === 0 && (
                <p className="text-xs text-zinc-400">{isOwnProfile ? "Aun no has creado reels." : "Este perfil aun no tiene reels."}</p>
              )}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">{reels.map((reel) => renderReelCard(reel))}</div>
            </div>
          )}
        </div>
      )}

      {activeTab === "Guardados" && (
        <div className="space-y-4">
          {!isOwnProfile && <p className="text-xs text-zinc-400">Solo tu puedes ver tus publicaciones guardadas.</p>}
          {isOwnProfile && savedPostsQuery.isLoading && (
            <>
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </>
          )}
          {isOwnProfile && (savedPostsQuery.data ?? []).length === 0 && (
            <p className="text-xs text-zinc-400">No tienes publicaciones guardadas aun.</p>
          )}
          {isOwnProfile && (savedPostsQuery.data ?? []).map((post) => <PostCard key={post.id} post={post} />)}
        </div>
      )}

      {activeTab === "Amigos" && (
        <div className="space-y-3">
          {isOwnProfile && (
            <div className="space-y-2 rounded-lg bg-velion-black/40 p-3">
              <p className="text-sm font-medium">Solicitudes pendientes</p>
              {incomingRequestsQuery.isLoading && (
                <>
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </>
              )}
              {(incomingRequestsQuery.data ?? []).length === 0 && <p className="text-xs text-zinc-400">No tienes solicitudes pendientes.</p>}
              {(incomingRequestsQuery.data ?? []).map((request) => (
                <div key={request.friendship_id} className="flex items-center justify-between gap-2 rounded-lg bg-velion-black/40 p-2">
                  <div className="flex items-center gap-2">
                    <img src={request.requester.avatar_url ?? "https://placehold.co/64"} alt="avatar" className="h-8 w-8 rounded-full object-cover" />
                    <div>
                      <Link to={getProfileRoute(request.requester.username)} className="text-xs font-medium hover:text-velion-fuchsia">
                        {request.requester.full_name}
                      </Link>
                      <Link to={getProfileRoute(request.requester.username)} className="text-[11px] text-zinc-400 hover:text-white">
                        @{request.requester.username}
                      </Link>
                    </div>
                  </div>
                  <Button
                    className="px-3 py-1 text-xs"
                    disabled={acceptMutation.isPending}
                    onClick={() => acceptMutation.mutate(request.friendship_id)}
                  >
                    Aceptar
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Amigos</p>
            {friendsQuery.isLoading && (
              <>
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </>
            )}
            {(friendsQuery.data ?? []).length === 0 && <p className="text-xs text-zinc-400">Sin amistades por ahora.</p>}
            {(friendsQuery.data ?? []).map((friend) => (
              <article key={friend.id} className="flex items-center gap-2 rounded-lg bg-velion-black/40 p-2">
                <img src={friend.avatar_url ?? "https://placehold.co/64"} alt="avatar" className="h-9 w-9 rounded-full object-cover" />
                <div>
                  <Link to={getProfileRoute(friend.username)} className="text-sm font-medium hover:text-velion-fuchsia">
                    {friend.full_name}
                  </Link>
                  <Link to={getProfileRoute(friend.username)} className="text-xs text-zinc-400 hover:text-white">
                    @{friend.username}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {activeTab === "Sobre mi" && (
        <div className="space-y-2 rounded-lg bg-velion-black/40 p-3 text-sm">
          <p>
            <span className="text-zinc-400">Bio:</span> {profile.bio ?? "No definida"}
          </p>
          <p>
            <span className="text-zinc-400">Pais:</span> {profile.country ?? "No definido"}
          </p>
          <p>
            <span className="text-zinc-400">Ciudad:</span> {profile.city ?? "No definida"}
          </p>
          <p>
            <span className="text-zinc-400">Relacion:</span> {profile.relationship_status ?? "No definida"}
          </p>
          {links.length > 0 && (
            <div className="pt-1">
              <p className="text-zinc-400">Enlaces:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {links.map(([key, href]) => (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-velion-black/60 px-2 py-1 text-xs text-zinc-200 hover:bg-velion-black"
                  >
                    {getExternalLinkLabel(key)}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={openUploadVideoModal} onClose={() => setOpenUploadVideoModal(false)} title="Subir video al Stream">
        <div className="grid gap-3">
          <Input value={videoTitle} onChange={(event) => setVideoTitle(event.target.value)} placeholder="Titulo del video" />
          <textarea
            value={videoDescription}
            onChange={(event) => {
              const nextValue = event.target.value.slice(0, 300);
              setVideoDescription(nextValue);
            }}
            placeholder="Agrega una descripcion (max 300). Puedes usar #hashtags."
            className="h-24 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
          />
          <p className="text-right text-[11px] text-zinc-400">{videoDescription.length}/300</p>

          <div className="flex items-center justify-between rounded-xl border border-velion-steel/60 bg-velion-black/40 p-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-velion-fuchsia/25 text-zinc-100 hover:bg-velion-fuchsia/35"
                aria-label="Seleccionar video"
              >
                <ImagePlus size={18} />
              </button>
              <p className="text-xs text-zinc-300">{videoFile ? "Video seleccionado" : "Selecciona un video desde tu PC"}</p>
            </div>
            {videoFile && (
              <button
                type="button"
                onClick={() => {
                  void handleVideoFileChange(null);
                  if (videoInputRef.current) videoInputRef.current.value = "";
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700/70 text-zinc-100 hover:bg-zinc-600"
                aria-label="Quitar video"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              void handleVideoFileChange(event.target.files?.[0] ?? null);
            }}
          />

          {videoFile && videoPreviewUrl && (
            <div className="w-fit rounded-xl border border-velion-steel/60 bg-velion-black/40 p-2">
              <video src={videoPreviewUrl} className="h-28 w-28 rounded-lg object-cover" muted playsInline controls />
            </div>
          )}

          {videoDurationSeconds && (
            <p className="text-xs text-zinc-400">Duracion detectada: {videoDurationSeconds}s</p>
          )}

          {createVodMutation.isPending && videoFile && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-velion-fuchsia transition-all duration-200"
                  style={{ width: `${Math.max(0, Math.min(uploadProgress, 100))}%` }}
                />
              </div>
              <p className="text-right text-[11px] text-zinc-400">{Math.round(uploadProgress)}%</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenUploadVideoModal(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                try {
                  validateSocialTextRules(videoDescription);
                } catch (err) {
                  setError(toAppError(err));
                  return;
                }
                createVodMutation.mutate();
              }}
              disabled={!videoTitle.trim() || !videoFile || createVodMutation.isPending}
            >
              {createVodMutation.isPending ? "Subiendo..." : "Publicar video"}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}






