import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Flag, Heart, ImagePlus, MessageCircle, MoreVertical, Repeat2, SendHorizontal, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ProfileBadges } from "@/components/ui/profile-badges";
import { Skeleton } from "@/components/ui/skeleton";
import { getProfileRoute } from "@/lib/constants";
import { formatRelativeDate } from "@/lib/date";
import { applyMentionSelection, getMentionMatch } from "@/lib/mentions";
import { invalidateMany } from "@/lib/query-utils";
import { searchProfilesByUsernamePrefix } from "@/services/auth.service";
import { toAppError } from "@/services/error.service";
import {
  addReelComment,
  createReel,
  deleteReel,
  deleteReelComment,
  getReelComments,
  getReelsFeed,
  incrementReelView,
  reportReel,
  shareReel,
  toggleLikeReel,
  toggleSaveReel,
  updateReel,
} from "@/services/reels.service";
import { useAppStore } from "@/store/app.store";
import type { Reel } from "@/types/models";

const VIDEO_ACCEPT = "video/*";
const IMAGE_ACCEPT = "image/*";

const patchReelCache = (list: Reel[] | undefined, reelId: string, patch: Partial<Reel>): Reel[] =>
  (list ?? []).map((item) => (item.id === reelId ? { ...item, ...patch } : item));

export function ReelsVertical() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [openCommentsModal, setOpenCommentsModal] = useState(false);
  const [openEditModal, setOpenEditModal] = useState(false);
  const [openDeleteModal, setOpenDeleteModal] = useState(false);
  const [openShareModal, setOpenShareModal] = useState(false);
  const [openReportModal, setOpenReportModal] = useState(false);
  const [selectedReel, setSelectedReel] = useState<Reel | null>(null);
  const [openActionsMenuId, setOpenActionsMenuId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newVideoFile, setNewVideoFile] = useState<File | null>(null);
  const [newThumbnailFile, setNewThumbnailFile] = useState<File | null>(null);
  const [newComment, setNewComment] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [shareComment, setShareComment] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionTarget, setMentionTarget] = useState<"create" | "edit" | "share" | null>(null);

  const viewedReelsRef = useRef<Set<string>>(new Set());
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const createDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const editDescriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const shareCommentRef = useRef<HTMLTextAreaElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const { data: reels = [], isLoading } = useQuery({
    queryKey: ["reels-feed"],
    queryFn: () => getReelsFeed(50),
  });

  const activeReel = reels[activeIndex] ?? null;

  const mentionUsersQuery = useQuery({
    queryKey: ["mention-users", "reels", mentionTarget, mentionQuery],
    queryFn: () => searchProfilesByUsernamePrefix(mentionQuery, 6),
    enabled: (openCreateModal || openEditModal || openShareModal) && mentionQuery.length > 0,
  });

  useEffect(() => {
    const video = document.querySelector<HTMLVideoElement>(`[data-reel-index='${activeIndex}']`);
    if (video) {
      void video.play().catch(() => undefined);
    }
  }, [activeIndex, reels.length]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("open_create_reel")) setOpenCreateModal(true);
  }, [location.search]);

  useEffect(() => {
    if (!activeReel?.id || viewedReelsRef.current.has(activeReel.id)) return;
    viewedReelsRef.current.add(activeReel.id);
    void incrementReelView(activeReel.id).then(() => {
      queryClient.setQueryData<Reel[]>(["reels-feed"], (current) =>
        patchReelCache(current, activeReel.id, { views_count: Number(activeReel.views_count ?? 0) + 1 }),
      );
    });
  }, [activeReel?.id, activeReel?.views_count, queryClient]);

  useEffect(() => {
    if (!openActionsMenuId) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!actionMenuRef.current) return;
      if (actionMenuRef.current.contains(event.target as Node)) return;
      setOpenActionsMenuId(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openActionsMenuId]);

  const commentsQuery = useQuery({
    queryKey: ["reel-comments", selectedReel?.id],
    queryFn: () => getReelComments(selectedReel!.id),
    enabled: openCommentsModal && Boolean(selectedReel?.id),
  });

  const refreshAll = async () => {
    await invalidateMany(queryClient, [
      ["reels-feed"],
      ["profile-reels"],
    ]);
  };

  const updateMentionQuery = (value: string, cursor: number) => {
    const mention = getMentionMatch(value, cursor);
    setMentionQuery(mention?.query ?? "");
  };

  const insertMention = (username: string) => {
    const isCreate = mentionTarget === "create";
    const isEdit = mentionTarget === "edit";
    const isShare = mentionTarget === "share";
    if (!isCreate && !isEdit && !isShare) return;

    const node = isCreate ? createDescriptionRef.current : isEdit ? editDescriptionRef.current : shareCommentRef.current;
    const value = isCreate ? newDescription : isEdit ? editDescription : shareComment;
    if (!node) return;

    const cursor = node.selectionStart ?? value.length;
    const { nextValue, nextCursor } = applyMentionSelection(value, cursor, username);
    if (isCreate) setNewDescription(nextValue);
    if (isEdit) setEditDescription(nextValue);
    if (isShare) setShareComment(nextValue);
    setMentionQuery("");

    window.requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const createMutation = useMutation({
    mutationFn: async () =>
      createReel(
        {
          title: newTitle,
          description: newDescription,
          videoFile: newVideoFile as File,
          thumbnailFile: newThumbnailFile,
        },
        setUploadProgress,
      ),
    onSuccess: async () => {
      setOpenCreateModal(false);
      setNewTitle("");
      setNewDescription("");
      setNewVideoFile(null);
      setNewThumbnailFile(null);
      setUploadProgress(0);
      setMentionQuery("");
      setMentionTarget(null);
      if (videoInputRef.current) videoInputRef.current.value = "";
      if (thumbnailInputRef.current) thumbnailInputRef.current.value = "";
      await refreshAll();
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const likeMutation = useMutation({
    mutationFn: async (reel: Reel) => toggleLikeReel(reel.id),
    onMutate: async (reel) => {
      setActionError(null);
      const nextLiked = !reel.liked_by_me;
      const nextLikes = Math.max(0, Number(reel.likes_count ?? 0) + (nextLiked ? 1 : -1));
      queryClient.setQueryData<Reel[]>(["reels-feed"], (current) =>
        patchReelCache(current, reel.id, { liked_by_me: nextLiked, likes_count: nextLikes }),
      );
    },
    onError: async (error) => {
      setActionError(toAppError(error));
      await refreshAll();
    },
    onSuccess: async (liked, reel) => {
      queryClient.setQueryData<Reel[]>(["reels-feed"], (current) =>
        patchReelCache(current, reel.id, { liked_by_me: liked }),
      );
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (reel: Reel) => toggleSaveReel(reel.id),
    onMutate: async (reel) => {
      setActionError(null);
      const nextSaved = !reel.saved_by_me;
      const nextCount = Math.max(0, Number(reel.saves_count ?? 0) + (nextSaved ? 1 : -1));
      queryClient.setQueryData<Reel[]>(["reels-feed"], (current) =>
        patchReelCache(current, reel.id, { saved_by_me: nextSaved, saves_count: nextCount }),
      );
    },
    onError: async (error) => {
      setActionError(toAppError(error));
      await refreshAll();
    },
    onSuccess: async (saved, reel) => {
      queryClient.setQueryData<Reel[]>(["reels-feed"], (current) =>
        patchReelCache(current, reel.id, { saved_by_me: saved }),
      );
    },
  });

  const shareMutation = useMutation({
    mutationFn: async () => shareReel(selectedReel!.id, shareComment),
    onSuccess: async () => {
      setOpenShareModal(false);
      setShareComment("");
      setMentionQuery("");
      setMentionTarget(null);
      setShareFeedback("Compartido");
      window.setTimeout(() => setShareFeedback(null), 2000);
      await refreshAll();
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const commentMutation = useMutation({
    mutationFn: async () => addReelComment(selectedReel!.id, newComment),
    onSuccess: async () => {
      setNewComment("");
      await queryClient.invalidateQueries({ queryKey: ["reel-comments", selectedReel?.id] });
      await refreshAll();
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => deleteReelComment(commentId, selectedReel!.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reel-comments", selectedReel?.id] });
      await refreshAll();
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => updateReel(selectedReel!.id, { title: editTitle, description: editDescription }),
    onSuccess: async () => {
      setOpenEditModal(false);
      setMentionQuery("");
      setMentionTarget(null);
      await refreshAll();
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => deleteReel(selectedReel!.id),
    onSuccess: async () => {
      setOpenDeleteModal(false);
      setSelectedReel(null);
      await refreshAll();
    },
    onError: (error) => setActionError(toAppError(error)),
  });
  const reportMutation = useMutation({
    mutationFn: async () => reportReel(selectedReel!.id, reportReason),
    onSuccess: () => {
      setOpenReportModal(false);
      setReportReason("");
      setActionError(null);
      setShareFeedback("Reporte enviado");
      window.setTimeout(() => setShareFeedback(null), 2000);
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const canCreate = useMemo(() => Boolean(newTitle.trim()) && Boolean(newVideoFile), [newTitle, newVideoFile]);

  return (
    <div className="space-y-3">
      {actionError && <p className="text-xs text-red-400">{actionError}</p>}
      {isLoading && (
        <div className="mx-auto grid max-w-3xl gap-6">
          <Skeleton className="h-[70vh] w-full rounded-2xl" />
          <Skeleton className="h-[70vh] w-full rounded-2xl" />
        </div>
      )}
      {!isLoading && reels.length === 0 && <p className="text-sm text-zinc-400">Aun no hay reels publicados.</p>}

      <div className="mx-auto flex max-w-3xl snap-y snap-mandatory flex-col gap-6 overflow-y-auto pb-24">
        {reels.map((reel, index) => {
          const isOwn = profile?.id === reel.author_id;
          return (
            <article
              key={reel.id}
              className="snap-start overflow-hidden rounded-2xl border border-velion-steel/80 bg-black/40"
              onMouseEnter={() => setActiveIndex(index)}
            >
              <video
                data-reel-index={index}
                src={reel.video_url}
                controls
                loop
                muted
                playsInline
                preload="metadata"
                className="h-[70vh] w-full rounded-t-2xl object-cover"
              />

              <div className="space-y-2 p-3">
                <header className="flex items-center gap-3">
                  <img src={reel.profile?.avatar_url ?? "https://placehold.co/80"} alt="avatar" className="h-9 w-9 rounded-full object-cover" />
                  <div className="min-w-0 flex-1">
                    {reel.profile?.username ? (
                      <span className="inline-flex items-center gap-1">
                        <Link to={getProfileRoute(reel.profile.username)} className="text-sm font-semibold hover:text-velion-fuchsia">
                          {reel.profile.full_name}
                        </Link>
                        <ProfileBadges isPremium={reel.profile?.is_premium} isVerified={reel.profile?.is_verified} size={12} />
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <p className="text-sm font-semibold">{reel.profile?.full_name ?? "Usuario"}</p>
                        <ProfileBadges isPremium={reel.profile?.is_premium} isVerified={reel.profile?.is_verified} size={12} />
                      </span>
                    )}
                    <p className="text-xs text-zinc-400">{formatRelativeDate(reel.created_at)}</p>
                  </div>
                  <div ref={openActionsMenuId === reel.id ? actionMenuRef : undefined} className="relative">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-zinc-700/60 text-zinc-100 hover:bg-zinc-600"
                      onClick={() => setOpenActionsMenuId((prev) => (prev === reel.id ? null : reel.id))}
                      aria-label="Opciones del reel"
                    >
                      <MoreVertical size={15} />
                    </button>
                    {openActionsMenuId === reel.id && (
                      <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[160px] rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
                        {isOwn && (
                          <button
                            type="button"
                            className="w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-700/70"
                            onClick={() => {
                              setOpenActionsMenuId(null);
                              setSelectedReel(reel);
                              setEditTitle(reel.title ?? "");
                              setEditDescription(reel.description ?? "");
                              setOpenEditModal(true);
                            }}
                          >
                            Editar
                          </button>
                        )}
                        {isOwn && (
                          <button
                            type="button"
                            className="w-full rounded-md px-3 py-2 text-left text-xs text-rose-300 hover:bg-rose-900/40"
                            onClick={() => {
                              setOpenActionsMenuId(null);
                              setSelectedReel(reel);
                              setOpenDeleteModal(true);
                            }}
                          >
                            Eliminar
                          </button>
                        )}
                        {!isOwn && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-amber-300 hover:bg-amber-900/30"
                            onClick={() => {
                              setOpenActionsMenuId(null);
                              setSelectedReel(reel);
                              setOpenReportModal(true);
                            }}
                          >
                            <Flag size={13} />
                            Reportar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </header>

                <p className="text-sm font-semibold text-white">{reel.title || "Reel"}</p>
                {reel.description && <p className="text-sm whitespace-pre-wrap break-words text-zinc-300">{reel.description}</p>}

                <footer className="flex items-center justify-between border-t border-velion-steel/40 pt-2 text-xs text-zinc-300">
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 transition hover:text-velion-fuchsia ${reel.liked_by_me ? "text-rose-300" : ""}`}
                    onClick={() => likeMutation.mutate(reel)}
                    disabled={likeMutation.isPending}
                  >
                    <Heart size={15} fill={reel.liked_by_me ? "currentColor" : "none"} />
                    {reel.likes_count}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 transition hover:text-velion-fuchsia"
                    onClick={() => {
                      setSelectedReel(reel);
                      setOpenCommentsModal(true);
                    }}
                  >
                    <MessageCircle size={15} />
                    {reel.comments_count ?? 0}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 transition hover:text-velion-fuchsia"
                    onClick={() => {
                      setSelectedReel(reel);
                      setOpenShareModal(true);
                      setMentionTarget("share");
                    }}
                    disabled={shareMutation.isPending}
                  >
                    <Repeat2 size={15} />
                    {reel.shares_count ?? 0}
                  </button>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 transition hover:text-velion-fuchsia ${reel.saved_by_me ? "text-amber-300" : ""}`}
                    onClick={() => saveMutation.mutate(reel)}
                    disabled={saveMutation.isPending}
                  >
                    <Bookmark size={15} fill={reel.saved_by_me ? "currentColor" : "none"} />
                    {reel.saves_count ?? 0}
                  </button>
                </footer>
              </div>
            </article>
          );
        })}
      </div>
      {shareFeedback && <p className="text-xs text-emerald-400">{shareFeedback}</p>}

      <Modal open={openCreateModal} onClose={() => setOpenCreateModal(false)} title="Subir Reel" className="max-w-xl">
        <div className="space-y-3">
          <Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Titulo del reel" />
          <div className="relative">
            <textarea
              ref={createDescriptionRef}
              value={newDescription}
              onChange={(event) => {
                const nextValue = event.target.value.slice(0, 240);
                setNewDescription(nextValue);
                setMentionTarget("create");
                updateMentionQuery(nextValue, event.target.selectionStart ?? nextValue.length);
              }}
              onSelect={(event) => {
                const target = event.target as HTMLTextAreaElement;
                setMentionTarget("create");
                updateMentionQuery(target.value, target.selectionStart ?? target.value.length);
              }}
              placeholder="Descripcion (opcional). Usa @usuario y #hashtag"
              className="h-24 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
            />
            {mentionTarget === "create" && mentionQuery.length > 0 && (mentionUsersQuery.data ?? []).length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-48 overflow-y-auto rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
                {(mentionUsersQuery.data ?? []).map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-velion-black/60"
                    onClick={() => insertMention(user.username)}
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

          <div className="flex items-center justify-between rounded-xl border border-velion-steel/60 bg-velion-black/40 p-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => videoInputRef.current?.click()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-velion-fuchsia/25 text-zinc-100 hover:bg-velion-fuchsia/35"
                aria-label="Seleccionar video"
              >
                <Video size={18} />
              </button>
              <p className="text-xs text-zinc-300">{newVideoFile ? "Video seleccionado" : "Video"}</p>
            </div>
            {newVideoFile && (
              <button
                type="button"
                onClick={() => {
                  setNewVideoFile(null);
                  if (videoInputRef.current) videoInputRef.current.value = "";
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700/70 text-zinc-100 hover:bg-zinc-600"
                aria-label="Quitar video"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <input ref={videoInputRef} type="file" accept={VIDEO_ACCEPT} onChange={(event) => setNewVideoFile(event.target.files?.[0] ?? null)} className="hidden" />

          <div className="flex items-center justify-between rounded-xl border border-velion-steel/60 bg-velion-black/40 p-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => thumbnailInputRef.current?.click()}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-velion-fuchsia/25 text-zinc-100 hover:bg-velion-fuchsia/35"
                aria-label="Seleccionar thumbnail"
              >
                <ImagePlus size={18} />
              </button>
              <p className="text-xs text-zinc-300">{newThumbnailFile ? "Thumbnail seleccionada" : "Thumbnail (opcional)"}</p>
            </div>
            {newThumbnailFile && (
              <button
                type="button"
                onClick={() => {
                  setNewThumbnailFile(null);
                  if (thumbnailInputRef.current) thumbnailInputRef.current.value = "";
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700/70 text-zinc-100 hover:bg-zinc-600"
                aria-label="Quitar thumbnail"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <input
            ref={thumbnailInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            onChange={(event) => setNewThumbnailFile(event.target.files?.[0] ?? null)}
            className="hidden"
          />

          {createMutation.isPending && (
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
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => createMutation.mutate()} disabled={!canCreate || createMutation.isPending} className="flex items-center gap-2">
              <SendHorizontal size={14} />
              Publicar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={openCommentsModal} onClose={() => setOpenCommentsModal(false)} title="Comentarios" className="max-w-2xl">
        <div className="space-y-3">
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {commentsQuery.isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full rounded-lg" />
                <Skeleton className="h-14 w-[92%] rounded-lg" />
                <Skeleton className="h-14 w-[85%] rounded-lg" />
              </div>
            )}
            {(commentsQuery.data ?? []).length === 0 && <p className="text-xs text-zinc-400">Sin comentarios todavia.</p>}
            {(commentsQuery.data ?? []).map((comment) => {
              const canDelete = profile?.id === comment.author_id;
              return (
                <article key={comment.id} className="rounded-lg bg-velion-black/40 p-2 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-zinc-300">@{comment.author?.username ?? "usuario"}</p>
                    {canDelete && (
                      <button
                        type="button"
                        className="text-xs text-rose-300 hover:text-rose-200"
                        onClick={() => deleteCommentMutation.mutate(comment.id)}
                        disabled={deleteCommentMutation.isPending}
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                  <p className="text-zinc-100">{comment.content}</p>
                </article>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Input
              value={newComment}
              onChange={(event) => setNewComment(event.target.value)}
              placeholder="Escribe un comentario..."
            />
            <Button type="button" onClick={() => commentMutation.mutate()} disabled={!newComment.trim() || commentMutation.isPending}>
              Enviar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={openShareModal} onClose={() => setOpenShareModal(false)} title="Compartir" className="max-w-md">
        <div className="space-y-3">
          <div className="relative">
            <textarea
              ref={shareCommentRef}
              value={shareComment}
              onChange={(event) => {
                const nextValue = event.target.value;
                setShareComment(nextValue);
                setMentionTarget("share");
                updateMentionQuery(nextValue, event.target.selectionStart ?? nextValue.length);
              }}
              onSelect={(event) => {
                const target = event.target as HTMLTextAreaElement;
                setMentionTarget("share");
                updateMentionQuery(target.value, target.selectionStart ?? target.value.length);
              }}
              placeholder="Agrega un comentario... Usa @usuario y #hashtag"
              className="h-24 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
            />

            {mentionTarget === "share" && mentionQuery.length > 0 && (mentionUsersQuery.data ?? []).length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-44 overflow-y-auto rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
                {(mentionUsersQuery.data ?? []).map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-velion-black/60"
                    onClick={() => insertMention(user.username)}
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

          <Button
            type="button"
            className="w-full justify-center gap-2"
            onClick={() => shareMutation.mutate()}
            disabled={shareMutation.isPending || !selectedReel}
          >
            <Repeat2 size={14} />
            {shareMutation.isPending ? "Publicando..." : "Compartir"}
          </Button>
        </div>
      </Modal>

      <Modal open={openEditModal} onClose={() => setOpenEditModal(false)} title="Editar Reel" className="max-w-md">
        <div className="space-y-3">
          <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder="Titulo" />
          <div className="relative">
            <textarea
              ref={editDescriptionRef}
              value={editDescription}
              onChange={(event) => {
                const nextValue = event.target.value.slice(0, 240);
                setEditDescription(nextValue);
                setMentionTarget("edit");
                updateMentionQuery(nextValue, event.target.selectionStart ?? nextValue.length);
              }}
              onSelect={(event) => {
                const target = event.target as HTMLTextAreaElement;
                setMentionTarget("edit");
                updateMentionQuery(target.value, target.selectionStart ?? target.value.length);
              }}
              placeholder="Descripcion (opcional). Usa @usuario y #hashtag"
              className="h-24 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
            />
            {mentionTarget === "edit" && mentionQuery.length > 0 && (mentionUsersQuery.data ?? []).length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-48 overflow-y-auto rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
                {(mentionUsersQuery.data ?? []).map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-velion-black/60"
                    onClick={() => insertMention(user.username)}
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
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenEditModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => updateMutation.mutate()} disabled={!editTitle.trim() || updateMutation.isPending}>
              Guardar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={openDeleteModal} onClose={() => setOpenDeleteModal(false)} title="Eliminar Reel" className="max-w-md">
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">Esta accion eliminara el reel de forma permanente.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenDeleteModal(false)}>
              Cancelar
            </Button>
            <Button type="button" className="bg-rose-700 hover:bg-rose-800" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              Eliminar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={openReportModal} onClose={() => setOpenReportModal(false)} title="Reportar Reel" className="max-w-md">
        <div className="space-y-3">
          <textarea
            value={reportReason}
            onChange={(event) => setReportReason(event.target.value.slice(0, 400))}
            placeholder="Describe el motivo del reporte"
            className="h-28 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
          />
          <p className="text-right text-[11px] text-zinc-400">{reportReason.length}/400</p>
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenReportModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => reportMutation.mutate()} disabled={reportMutation.isPending || !reportReason.trim()}>
              {reportMutation.isPending ? "Enviando..." : "Reportar"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
