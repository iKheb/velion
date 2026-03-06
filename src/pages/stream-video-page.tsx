import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Clapperboard, Flag, MoreVertical, Repeat2, ThumbsDown, ThumbsUp, UserCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { getProfileRoute } from "@/lib/constants";
import { applyMentionSelection, getMentionMatch } from "@/lib/mentions";
import { invalidateMany } from "@/lib/query-utils";
import { getProfileById, searchProfilesByUsernamePrefix } from "@/services/auth.service";
import { toAppError } from "@/services/error.service";
import { followUser, getRelationStatus, unfollowUser } from "@/services/relations.service";
import {
  addStreamVodComment,
  deleteStreamVod,
  getMyStreamVodReaction,
  getMyStreamVodShare,
  getStreamVodById,
  getStreamVodComments,
  getStreamVodReactionsSummary,
  getStreamVodSharesSummary,
  incrementStreamVodViews,
  reportStreamVod,
  retweetStreamVod,
  setStreamVodReaction,
  updateStreamVodInfo,
} from "@/services/streaming.service";
import { useAppStore } from "@/store/app.store";

export default function StreamVideoPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);
  const retweetTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retweetFeedback, setRetweetFeedback] = useState<string | null>(null);
  const [cinemaMode, setCinemaMode] = useState(false);

  const [showRetweetModal, setShowRetweetModal] = useState(false);
  const [retweetComment, setRetweetComment] = useState("");
  const [retweetMentionQuery, setRetweetMentionQuery] = useState("");

  const [showVideoActionsMenu, setShowVideoActionsMenu] = useState(false);
  const [showEditVideoModal, setShowEditVideoModal] = useState(false);
  const [showDeleteVideoModal, setShowDeleteVideoModal] = useState(false);
  const [showReportVideoModal, setShowReportVideoModal] = useState(false);

  const [videoEditTitle, setVideoEditTitle] = useState("");
  const [videoEditDescription, setVideoEditDescription] = useState("");
  const [videoReportReason, setVideoReportReason] = useState("");

  const vodQuery = useQuery({
    queryKey: ["stream-vod", id],
    queryFn: () => getStreamVodById(id ?? ""),
    enabled: Boolean(id),
  });

  const reactionsQuery = useQuery({
    queryKey: ["stream-vod-reactions", id],
    queryFn: () => getStreamVodReactionsSummary(id ?? ""),
    enabled: Boolean(id),
  });

  const myReactionQuery = useQuery({
    queryKey: ["stream-vod-my-reaction", id],
    queryFn: () => getMyStreamVodReaction(id ?? ""),
    enabled: Boolean(id),
  });

  const commentsQuery = useQuery({
    queryKey: ["stream-vod-comments", id],
    queryFn: () => getStreamVodComments(id ?? ""),
    enabled: Boolean(id),
  });

  const sharesQuery = useQuery({
    queryKey: ["stream-vod-shares", id],
    queryFn: () => getStreamVodSharesSummary(id ?? ""),
    enabled: Boolean(id),
  });

  const myShareQuery = useQuery({
    queryKey: ["stream-vod-my-share", id],
    queryFn: () => getMyStreamVodShare(id ?? ""),
    enabled: Boolean(id),
  });

  const relationQuery = useQuery({
    queryKey: ["stream-vod-owner-relation", vodQuery.data?.owner_id],
    queryFn: () => getRelationStatus(vodQuery.data?.owner_id ?? ""),
    enabled: Boolean(vodQuery.data?.owner_id && profile?.id && vodQuery.data?.owner_id !== profile.id),
  });

  const mentionUsersQuery = useQuery({
    queryKey: ["mention-users", "stream-vod-retweet", retweetMentionQuery],
    queryFn: () => searchProfilesByUsernamePrefix(retweetMentionQuery, 6),
    enabled: showRetweetModal && retweetMentionQuery.length > 0,
  });

  const ownerProfileQuery = useQuery({
    queryKey: ["stream-vod-owner-profile", vodQuery.data?.owner_id],
    queryFn: () => getProfileById(vodQuery.data?.owner_id ?? ""),
    enabled: Boolean(vodQuery.data?.owner_id),
  });

  useEffect(() => {
    if (!id) return;
    void incrementStreamVodViews(id)
      .then(() => queryClient.invalidateQueries({ queryKey: ["stream-vod", id] }))
      .catch(() => undefined);
  }, [id, queryClient]);

  useEffect(() => {
    if (!vodQuery.data) return;
    setVideoEditTitle(vodQuery.data.title ?? "");
    setVideoEditDescription(vodQuery.data.description ?? "");
  }, [vodQuery.data]);

  const reactionMutation = useMutation({
    mutationFn: async (reaction: "like" | "dislike") => setStreamVodReaction(id ?? "", reaction),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        ["stream-vod-reactions", id],
        ["stream-vod-my-reaction", id],
      ]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const commentMutation = useMutation({
    mutationFn: async () => addStreamVodComment(id ?? "", comment),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setComment("");
      await invalidateMany(queryClient, [["stream-vod-comments", id]]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const shareMutation = useMutation({
    mutationFn: async () => retweetStreamVod(id ?? "", retweetComment),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setShowRetweetModal(false);
      setRetweetComment("");
      setRetweetMentionQuery("");
      setRetweetFeedback("Compartido en inicio y en tu perfil.");
      window.setTimeout(() => setRetweetFeedback(null), 2500);
      await invalidateMany(queryClient, [
        ["stream-vod-shares", id],
        ["stream-vod-my-share", id],
        ["feed"],
        ["profile-posts"],
        ["right-panel", "trends"],
      ]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const followMutation = useMutation({
    mutationFn: async () => {
      const ownerId = vodQuery.data?.owner_id;
      if (!ownerId) throw new Error("Video invalido");
      const isFollowing = relationQuery.data?.isFollowing ?? false;
      if (isFollowing) {
        await unfollowUser(ownerId);
      } else {
        await followUser(ownerId);
      }
      return !isFollowing;
    },
    onSuccess: async () => {
      await invalidateMany(queryClient, [
        ["stream-vod-owner-relation", vodQuery.data?.owner_id],
        ["profile-stats", vodQuery.data?.owner_id],
      ]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const editVideoMutation = useMutation({
    mutationFn: async () =>
      updateStreamVodInfo(id ?? "", {
        title: videoEditTitle,
        description: videoEditDescription,
      }),
    onSuccess: async () => {
      setShowEditVideoModal(false);
      setShowVideoActionsMenu(false);
      await invalidateMany(queryClient, [
        ["stream-vod", id],
        ["profile-vods"],
      ]);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const deleteVideoMutation = useMutation({
    mutationFn: async () => deleteStreamVod(id ?? ""),
    onSuccess: () => {
      setShowDeleteVideoModal(false);
      window.history.back();
    },
    onError: (err) => setError(toAppError(err)),
  });

  const reportVideoMutation = useMutation({
    mutationFn: async () => reportStreamVod(id ?? "", videoReportReason),
    onSuccess: () => {
      setShowReportVideoModal(false);
      setVideoReportReason("");
      setRetweetFeedback("Reporte enviado.");
      window.setTimeout(() => setRetweetFeedback(null), 2500);
    },
    onError: (err) => setError(toAppError(err)),
  });

  const vod = vodQuery.data;
  const likes = reactionsQuery.data?.likes ?? 0;
  const dislikes = reactionsQuery.data?.dislikes ?? 0;
  const myReaction = myReactionQuery.data;
  const sharesCount = sharesQuery.data ?? 0;
  const myShared = myShareQuery.data ?? false;
  const isOwnVideo = Boolean(profile?.id && vod?.owner_id && profile.id === vod.owner_id);
  const isFollowingOwner = Boolean(relationQuery.data?.isFollowing);

  const updateRetweetMentionQuery = (value: string, cursor: number) => {
    const mention = getMentionMatch(value, cursor);
    setRetweetMentionQuery(mention?.query ?? "");
  };

  const insertRetweetMention = (username: string) => {
    const node = retweetTextareaRef.current;
    if (!node) return;

    const cursor = node.selectionStart ?? retweetComment.length;
    const { nextValue, nextCursor } = applyMentionSelection(retweetComment, cursor, username);
    setRetweetComment(nextValue.slice(0, 300));
    setRetweetMentionQuery("");

    window.requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const infoCard = (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-100">{vod?.title}</h2>
        {isOwnVideo && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowVideoActionsMenu((prev) => !prev)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              aria-label="Opciones de video"
            >
              <MoreVertical size={15} />
            </button>
            {showVideoActionsMenu && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-20 min-w-[150px] rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
                <button
                  type="button"
                  className="w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-700/70"
                  onClick={() => {
                    setShowEditVideoModal(true);
                    setShowVideoActionsMenu(false);
                  }}
                >
                  Editar info
                </button>
                <button
                  type="button"
                  className="w-full rounded-md px-3 py-2 text-left text-xs text-rose-300 hover:bg-rose-900/40"
                  onClick={() => {
                    setShowDeleteVideoModal(true);
                    setShowVideoActionsMenu(false);
                  }}
                >
                  Eliminar video
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <p className="text-sm text-zinc-300">{vod?.description || "Sin descripcion."}</p>
    </Card>
  );

  return (
    <section className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={ownerProfileQuery.data?.avatar_url ?? "https://placehold.co/80"}
            alt={ownerProfileQuery.data?.username ?? "creador"}
            className="h-11 w-11 rounded-full object-cover"
            loading="lazy"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-100">{ownerProfileQuery.data?.full_name ?? "Creador"}</p>
            <p className="truncate text-xs text-zinc-400">@{ownerProfileQuery.data?.username ?? "usuario"}</p>
          </div>
        </div>

        {ownerProfileQuery.data?.username ? (
          <Link to={getProfileRoute(ownerProfileQuery.data.username)}>
            <Button type="button">Ver perfil</Button>
          </Link>
        ) : (
          <Button type="button" disabled>
            Ver perfil
          </Button>
        )}
      </Card>

      {vod ? (
        <div className="space-y-4">
          <div className={cinemaMode ? "space-y-4" : "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"}>
            <Card className="overflow-hidden border border-velion-steel/60 bg-velion-black/70 p-0 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_50px_-30px_rgba(237,0,151,0.6)]">
              <div className="relative bg-black">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(237,0,151,0.16),transparent_55%)]" />
                <video
                  src={vod.vod_url}
                  controls
                  playsInline
                  poster={vod.thumbnail_url ?? undefined}
                  className={`relative z-10 h-auto w-full bg-black ${cinemaMode ? "max-h-[82vh]" : "max-h-[72vh]"}`}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-velion-steel/50 bg-gradient-to-r from-velion-black/90 via-velion-black/75 to-velion-black/90 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => reactionMutation.mutate("like")}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs ${
                      myReaction === "like" ? "bg-emerald-700 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    }`}
                  >
                    <ThumbsUp size={14} /> {likes}
                  </button>
                  <button
                    type="button"
                    onClick={() => reactionMutation.mutate("dislike")}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs ${
                      myReaction === "dislike" ? "bg-rose-700 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    }`}
                  >
                    <ThumbsDown size={14} /> {dislikes}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRetweetModal(true)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs ${
                      myShared ? "bg-velion-fuchsia text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    }`}
                  >
                    <Repeat2 size={14} /> {sharesCount}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCinemaMode((prev) => !prev)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs ${
                      cinemaMode ? "bg-velion-fuchsia text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    }`}
                  >
                    <Clapperboard size={14} /> {cinemaMode ? "Salir cine" : "Modo cine"}
                  </button>
                  {!isOwnVideo && vod.owner_id && (
                    <button
                      type="button"
                      onClick={() => followMutation.mutate()}
                      disabled={followMutation.isPending}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs ${
                        isFollowingOwner ? "bg-emerald-700 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                      } disabled:cursor-not-allowed disabled:opacity-70`}
                    >
                      {isFollowingOwner ? <UserCheck size={14} /> : <UserPlus size={14} />}
                      {followMutation.isPending ? "Actualizando..." : isFollowingOwner ? "Siguiendo" : "Seguir"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowReportVideoModal(true)}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                  >
                    <Flag size={14} /> Reportar
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                  <span className="rounded-full border border-velion-steel/60 bg-velion-black/60 px-2 py-1">{vod.views_count ?? 0} views</span>
                  <span className="rounded-full border border-velion-steel/60 bg-velion-black/60 px-2 py-1">
                    {vod.published_at ? new Date(vod.published_at).toLocaleDateString() : new Date(vod.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </Card>

            {!cinemaMode && infoCard}
          </div>

          {cinemaMode && <div className="mx-auto w-full max-w-4xl">{infoCard}</div>}

          <Card className={`${cinemaMode ? "mx-auto w-full max-w-4xl" : ""} space-y-3`}>
            <h3 className={`font-semibold ${cinemaMode ? "text-center text-lg" : ""}`}>Comentarios ({(commentsQuery.data ?? []).length})</h3>
            <div className="space-y-2">
              {(commentsQuery.data ?? []).map((item) => (
                <article key={item.id} className="rounded-lg bg-velion-black/40 p-3">
                  <div className="flex items-start gap-2">
                    <img
                      src={item.author?.avatar_url ?? "https://placehold.co/64"}
                      alt={item.author?.username ?? "avatar"}
                      className="mt-0.5 h-8 w-8 rounded-full object-cover"
                      loading="lazy"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {item.author?.username ? (
                          <Link to={getProfileRoute(item.author.username)} className="font-semibold text-zinc-200 hover:text-velion-fuchsia">
                            {item.author.full_name}
                          </Link>
                        ) : (
                          <span className="font-semibold text-zinc-200">Usuario</span>
                        )}
                        {item.author?.username ? <span className="text-zinc-500">@{item.author.username}</span> : null}
                        <span className="text-zinc-500">{new Date(item.created_at).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{item.content}</p>
                    </div>
                  </div>
                </article>
              ))}
              {commentsQuery.isLoading && <p className="text-xs text-zinc-400">Cargando comentarios...</p>}
              {!commentsQuery.isLoading && (commentsQuery.data ?? []).length === 0 && <p className="text-xs text-zinc-400">Aun no hay comentarios.</p>}
            </div>

            <div className="space-y-2 border-t border-velion-steel/50 pt-2">
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Escribe un comentario..."
                className="h-24 w-full resize-none rounded-lg border border-velion-steel/70 bg-velion-black/40 p-2 text-sm outline-none"
              />
              <div className="flex justify-end">
                <Button type="button" onClick={() => commentMutation.mutate()} disabled={!comment.trim() || commentMutation.isPending}>
                  {commentMutation.isPending ? "Publicando..." : "Comentar"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <Card>
          <p className="text-sm text-zinc-400">{vodQuery.isLoading ? "Cargando video..." : "No se encontro el video."}</p>
        </Card>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      {retweetFeedback && <p className="text-xs text-zinc-300">{retweetFeedback}</p>}

      <Modal
        open={showRetweetModal}
        onClose={() => {
          setShowRetweetModal(false);
          setRetweetMentionQuery("");
        }}
        title="Compartir video"
      >
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">Se publicara en inicio y en tu perfil con miniatura, titulo y descripcion del video.</p>
          <div className="relative">
            <textarea
              ref={retweetTextareaRef}
              value={retweetComment}
              onChange={(event) => {
                const nextValue = event.target.value.slice(0, 300);
                setRetweetComment(nextValue);
                updateRetweetMentionQuery(nextValue, event.target.selectionStart ?? nextValue.length);
              }}
              onSelect={(event) => {
                const target = event.target as HTMLTextAreaElement;
                updateRetweetMentionQuery(target.value, target.selectionStart ?? target.value.length);
              }}
              placeholder="Agrega una descripcion para compartir (opcional). Usa @usuario y #hashtag"
              className="h-24 w-full resize-none rounded-lg border border-velion-steel/70 bg-velion-black/40 p-2 text-sm outline-none"
            />

            {retweetMentionQuery.length > 0 && (mentionUsersQuery.data ?? []).length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-44 overflow-y-auto rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
                {(mentionUsersQuery.data ?? []).map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-velion-black/60"
                    onClick={() => insertRetweetMention(user.username)}
                  >
                    <img src={user.avatar_url ?? "https://placehold.co/40"} alt="avatar" className="h-6 w-6 rounded-full object-cover" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-zinc-100">{user.full_name}</p>
                      <p className="truncate text-[11px] text-zinc-400">@{user.username}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-right text-[11px] text-zinc-400">{retweetComment.length}/300</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              className="bg-zinc-700 hover:bg-zinc-600"
              onClick={() => {
                setShowRetweetModal(false);
                setRetweetMentionQuery("");
              }}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => shareMutation.mutate()} disabled={shareMutation.isPending || myShared}>
              {shareMutation.isPending ? "Publicando..." : myShared ? "Ya compartido" : "Compartir"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={showEditVideoModal} onClose={() => setShowEditVideoModal(false)} title="Editar info del video">
        <div className="space-y-3">
          <input
            value={videoEditTitle}
            onChange={(event) => setVideoEditTitle(event.target.value)}
            placeholder="Titulo"
            className="w-full rounded-lg border border-velion-steel/70 bg-velion-black/40 p-2 text-sm outline-none"
          />
          <textarea
            value={videoEditDescription}
            onChange={(event) => setVideoEditDescription(event.target.value.slice(0, 300))}
            placeholder="Descripcion (max 300)"
            className="h-24 w-full resize-none rounded-lg border border-velion-steel/70 bg-velion-black/40 p-2 text-sm outline-none"
          />
          <p className="text-right text-[11px] text-zinc-400">{videoEditDescription.length}/300</p>
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setShowEditVideoModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => editVideoMutation.mutate()} disabled={editVideoMutation.isPending || !videoEditTitle.trim()}>
              {editVideoMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={showDeleteVideoModal} onClose={() => setShowDeleteVideoModal(false)} title="Eliminar video">
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">Esta accion no se puede deshacer.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setShowDeleteVideoModal(false)}>
              Cancelar
            </Button>
            <Button type="button" className="bg-rose-600 hover:bg-rose-500" onClick={() => deleteVideoMutation.mutate()} disabled={deleteVideoMutation.isPending}>
              {deleteVideoMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={showReportVideoModal} onClose={() => setShowReportVideoModal(false)} title="Reportar video">
        <div className="space-y-3">
          <textarea
            value={videoReportReason}
            onChange={(event) => setVideoReportReason(event.target.value.slice(0, 400))}
            placeholder="Describe el motivo del reporte"
            className="h-24 w-full resize-none rounded-lg border border-velion-steel/70 bg-velion-black/40 p-2 text-sm outline-none"
          />
          <p className="text-right text-[11px] text-zinc-400">{videoReportReason.length}/400</p>
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setShowReportVideoModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => reportVideoMutation.mutate()} disabled={reportVideoMutation.isPending || !videoReportReason.trim()}>
              {reportVideoMutation.isPending ? "Enviando..." : "Reportar"}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}


