import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, MessageCircle, Repeat2, Bookmark, Link2, MoreVertical, FileText, Download, Eye, Flag } from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ProfileBadges } from "@/components/ui/profile-badges";
import { getProfileRoute } from "@/lib/constants";
import { formatRelativeDate } from "@/lib/date";
import { applyMentionSelection, getMentionMatch } from "@/lib/mentions";
import { invalidateMany } from "@/lib/query-utils";
import { searchProfilesByUsernamePrefix } from "@/services/auth.service";
import { toAppError } from "@/services/error.service";
import {
  addPostComment,
  deletePost,
  getPostComments,
  reportPost,
  sharePost,
  toggleLikePost,
  toggleSavePost,
  updatePost,
  updateRetweetComment,
} from "@/services/social.service";
import { incrementStreamVodViews } from "@/services/streaming.service";
import { useAppStore } from "@/store/app.store";
import type { SocialPost } from "@/types/models";

interface PostCardProps {
  post: SocialPost;
}

const RETWEET_MARKERS = ["Compartio una publicacion de @", "Compartio un reel de @", "Compartio video:"];
const DOCUMENT_LINE_REGEX = /^Documento \((.+?)\):\s*(https?:\/\/\S+)$/i;

export function PostCard({ post }: PostCardProps) {
  const queryClient = useQueryClient();
  const profile = useAppStore((state) => state.profile);
  const shareCommentRef = useRef<HTMLTextAreaElement | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [showEditPostModal, setShowEditPostModal] = useState(false);
  const [showDeletePostModal, setShowDeletePostModal] = useState(false);
  const [showReportPostModal, setShowReportPostModal] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [commentContent, setCommentContent] = useState("");
  const [editContent, setEditContent] = useState(post.content);
  const [actionError, setActionError] = useState<string | null>(null);
  const [likedByMe, setLikedByMe] = useState(Boolean(post.liked_by_me));
  const [savedByMe, setSavedByMe] = useState(Boolean(post.saved_by_me));
  const [sharedByMe, setSharedByMe] = useState(Boolean(post.shared_by_me));
  const [likesCount, setLikesCount] = useState(post.reactions_count);
  const [commentsCount, setCommentsCount] = useState(post.comments_count);
  const [sharesCount, setSharesCount] = useState(post.shares_count);
  const [savedCount, setSavedCount] = useState(post.saved_count);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [shareComment, setShareComment] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [mentionQuery, setMentionQuery] = useState("");
  const [hasCountedVodView, setHasCountedVodView] = useState(false);
  const isOwnPost = profile?.id === post.author_id;
  const isRetweetPost = RETWEET_MARKERS.some((marker) => post.content.includes(marker));
  const isUnavailableRetweet = Boolean(post.shared_target_id && post.shared_target_available === false);

  const parsedDocument = useMemo(() => {
    const lines = post.content.split("\n");
    let documentName: string | null = null;
    let documentUrl: string | null = null;

    const contentLines = lines.filter((line) => {
      const match = line.trim().match(DOCUMENT_LINE_REGEX);
      if (!match) return true;

      if (!documentUrl) {
        documentName = match[1] ?? "archivo";
        documentUrl = match[2] ?? null;
      }
      return false;
    });

    return {
      documentName,
      documentUrl,
      contentWithoutDocument: contentLines.join("\n").trim(),
    };
  }, [post.content]);

  const vodPathMatch = useMemo(() => {
    const match = post.content.match(/\/streaming\/video\/[0-9a-f-]+/i);
    return match?.[0] ?? null;
  }, [post.content]);

  const retweetedVodId = useMemo(() => {
    if (!vodPathMatch) return null;
    return vodPathMatch.split("/").pop() ?? null;
  }, [vodPathMatch]);

  const postContentDisplay = useMemo(() => {
    if (isUnavailableRetweet) return "No Disponible";
    if (!vodPathMatch) return parsedDocument.contentWithoutDocument;
    return parsedDocument.contentWithoutDocument.replace(vodPathMatch, "").trim();
  }, [isUnavailableRetweet, parsedDocument.contentWithoutDocument, vodPathMatch]);

  const getRetweetEditableComment = (value: string): string => {
    const markerIndex = RETWEET_MARKERS
      .map((marker) => value.indexOf(marker))
      .filter((index) => index >= 0)
      .reduce((current, next) => (current === -1 ? next : Math.min(current, next)), -1);

    if (markerIndex === -1) return value;
    return value.slice(0, markerIndex).trim();
  };

  useEffect(() => {
    setLikedByMe(Boolean(post.liked_by_me));
    setSavedByMe(Boolean(post.saved_by_me));
    setSharedByMe(Boolean(post.shared_by_me));
    setLikesCount(post.reactions_count);
    setCommentsCount(post.comments_count);
    setSharesCount(post.shares_count);
    setSavedCount(post.saved_count);
    setEditContent(isRetweetPost ? getRetweetEditableComment(post.content) : post.content);
  }, [post, isRetweetPost]);

  useEffect(() => {
    setHasCountedVodView(false);
  }, [post.id]);

  useEffect(() => {
    if (!showActionsMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!actionsMenuRef.current) return;
      if (actionsMenuRef.current.contains(event.target as Node)) return;
      setShowActionsMenu(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showActionsMenu]);

  const postUrl = useMemo(() => `${window.location.origin}/?post=${encodeURIComponent(post.id)}`, [post.id]);

  const handleVodViewCount = () => {
    if (!retweetedVodId || hasCountedVodView || isUnavailableRetweet) return;
    setHasCountedVodView(true);
    void incrementStreamVodViews(retweetedVodId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ["stream-vod", retweetedVodId] });
      void queryClient.invalidateQueries({ queryKey: ["profile-vods"] });
    });
  };

  const commentsQuery = useQuery({
    queryKey: ["post-comments", post.id],
    queryFn: () => getPostComments(post.id),
    enabled: showComments,
  });

  const mentionUsersQuery = useQuery({
    queryKey: ["mention-users", "share", mentionQuery],
    queryFn: () => searchProfilesByUsernamePrefix(mentionQuery, 6),
    enabled: showShareModal && mentionQuery.length > 0,
  });

  const refreshFeed = async () => {
    await invalidateMany(queryClient, [
      ["feed"],
      ["profile-posts"],
      ["profile-saved-posts"],
    ]);
  };

  const likeMutation = useMutation({
    mutationFn: async () => toggleLikePost(post.id),
    onMutate: async () => {
      setActionError(null);
      const previousLiked = likedByMe;
      const previousLikesCount = likesCount;
      const nextLiked = !likedByMe;
      setLikedByMe(nextLiked);
      setLikesCount((previous) => Math.max(0, previous + (nextLiked ? 1 : -1)));
      return { previousLiked, previousLikesCount };
    },
    onError: (error, _variables, context) => {
      setActionError(toAppError(error));
      if (!context) return;
      setLikedByMe(context.previousLiked);
      setLikesCount(context.previousLikesCount);
    },
    onSuccess: (liked) => {
      setLikedByMe(liked);
    },
    onSettled: () => void refreshFeed(),
  });

  const commentMutation = useMutation({
    mutationFn: async () => addPostComment(post.id, commentContent),
    onSuccess: async () => {
      setCommentContent("");
      setCommentsCount((previous) => previous + 1);
      await queryClient.invalidateQueries({ queryKey: ["post-comments", post.id] });
      await refreshFeed();
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const shareMutation = useMutation({
    mutationFn: async () => sharePost(post.id, shareComment),
    onSuccess: () => {
      setSharedByMe(true);
      setSharesCount((previous) => previous + 1);
      setShowShareModal(false);
      setShareComment("");
      setMentionQuery("");
      setShareFeedback("Compartido");
      window.setTimeout(() => setShareFeedback(null), 2000);
      void refreshFeed();
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const saveMutation = useMutation({
    mutationFn: async () => toggleSavePost(post.id),
    onMutate: async () => {
      setActionError(null);
      const previousSaved = savedByMe;
      const previousSavedCount = savedCount;
      const nextSaved = !savedByMe;
      setSavedByMe(nextSaved);
      setSavedCount((previous) => Math.max(0, previous + (nextSaved ? 1 : -1)));
      return { previousSaved, previousSavedCount };
    },
    onSuccess: async (saved) => {
      setSavedByMe(saved);
      await refreshFeed();
    },
    onError: (error, _variables, context) => {
      setActionError(toAppError(error));
      if (!context) return;
      setSavedByMe(context.previousSaved);
      setSavedCount(context.previousSavedCount);
    },
  });

  const editPostMutation = useMutation({
    mutationFn: async () => (isRetweetPost ? updateRetweetComment(post.id, editContent) : updatePost(post.id, editContent)),
    onSuccess: async () => {
      setShowEditPostModal(false);
      await refreshFeed();
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const deletePostMutation = useMutation({
    mutationFn: async () => deletePost(post.id),
    onSuccess: async () => {
      setShowDeletePostModal(false);
      await refreshFeed();
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const reportPostMutation = useMutation({
    mutationFn: async () => reportPost(post.id, reportReason),
    onSuccess: () => {
      setShowReportPostModal(false);
      setReportReason("");
      setActionError(null);
      setShareFeedback("Reporte enviado");
      window.setTimeout(() => setShareFeedback(null), 2000);
    },
    onError: (error) => setActionError(toAppError(error)),
  });

  const updateShareMentionQuery = (value: string, cursor: number) => {
    const mention = getMentionMatch(value, cursor);
    setMentionQuery(mention?.query ?? "");
  };

  const insertShareMention = (username: string) => {
    const node = shareCommentRef.current;
    if (!node) return;

    const cursor = node.selectionStart ?? shareComment.length;
    const { nextValue, nextCursor } = applyMentionSelection(shareComment, cursor, username);
    setShareComment(nextValue);
    setMentionQuery("");

    window.requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card className="space-y-3 overflow-hidden">
        <header className="flex items-center gap-3">
          <img src={post.profile?.avatar_url ?? "https://placehold.co/80"} alt="avatar" className="h-10 w-10 rounded-full object-cover" />
          <div className="flex-1">
            {post.profile?.username ? (
              <div className="flex items-center gap-1">
                <Link to={getProfileRoute(post.profile.username)} className="text-sm font-semibold hover:text-velion-fuchsia">
                  {post.profile?.full_name ?? "Usuario"}
                </Link>
                <ProfileBadges isPremium={post.profile?.is_premium} isVerified={post.profile?.is_verified} />
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <p className="text-sm font-semibold">{post.profile?.full_name ?? "Usuario"}</p>
                <ProfileBadges isPremium={post.profile?.is_premium} isVerified={post.profile?.is_verified} />
              </div>
            )}
            <p className="text-xs text-zinc-400">{formatRelativeDate(post.created_at)}</p>
          </div>
          <div ref={actionsMenuRef} className="relative">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-zinc-700/60 text-zinc-100 hover:bg-zinc-600"
              onClick={() => setShowActionsMenu((prev) => !prev)}
              aria-label="Opciones de publicacion"
            >
              <MoreVertical size={15} />
            </button>
            {showActionsMenu && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[170px] rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
                {isOwnPost && (
                  <button
                    type="button"
                    className="w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-700/70"
                    onClick={() => {
                      setShowActionsMenu(false);
                      setEditContent(isRetweetPost ? getRetweetEditableComment(post.content) : post.content);
                      setShowEditPostModal(true);
                    }}
                  >
                    {isRetweetPost ? "Editar comentario" : "Editar"}
                  </button>
                )}
                {isOwnPost && (
                  <button
                    type="button"
                    className="w-full rounded-md px-3 py-2 text-left text-xs text-rose-300 hover:bg-rose-900/40"
                    onClick={() => {
                      setShowActionsMenu(false);
                      setShowDeletePostModal(true);
                    }}
                  >
                    Eliminar
                  </button>
                )}
                {!isOwnPost && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-amber-300 hover:bg-amber-900/30"
                    onClick={() => {
                      setShowActionsMenu(false);
                      setShowReportPostModal(true);
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

        {postContentDisplay ? (
          <p className="text-sm leading-relaxed text-zinc-100 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{postContentDisplay}</p>
        ) : null}

        {parsedDocument.documentUrl ? (
          <div className="rounded-xl border border-velion-steel/70 bg-velion-black/35 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-velion-fuchsia/20 text-zinc-100">
                  <FileText size={16} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-100">{parsedDocument.documentName ?? "Documento adjunto"}</p>
                  <p className="text-xs text-zinc-400">Documento adjunto</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  className="h-8 bg-zinc-700 px-3 text-xs hover:bg-zinc-600"
                  onClick={() => setShowDocumentModal(true)}
                >
                  <Eye size={13} />
                  Vista previa
                </Button>
                <a
                  href={parsedDocument.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  download={parsedDocument.documentName ?? "documento"}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-velion-fuchsia px-3 text-xs font-semibold text-white hover:bg-velion-fuchsia/90"
                >
                  <Download size={13} />
                  Descargar
                </a>
              </div>
            </div>
          </div>
        ) : null}

        {vodPathMatch && !isUnavailableRetweet && (
          <div className="flex justify-start">
            <Link
              to={vodPathMatch}
              className="inline-flex items-center rounded-lg bg-velion-fuchsia px-3 py-1.5 text-xs font-semibold text-white hover:bg-velion-fuchsia/90"
            >
              Ver video completo
            </Link>
          </div>
        )}

        {!isUnavailableRetweet && post.media_url && post.media_type === "video" ? (
          <div className="mx-auto block h-[840px] w-full max-w-full overflow-hidden rounded-xl border border-velion-steel/60 bg-black md:h-[470px]">
            <video
              src={post.media_url}
              className="h-full w-full object-contain"
              controls
              playsInline
              preload="metadata"
              onPlay={handleVodViewCount}
            />
          </div>
        ) : !isUnavailableRetweet && post.media_url ? (
          <button
            type="button"
            onClick={() => setShowMediaModal(true)}
            className="group relative mx-auto block h-[840px] w-full max-w-full overflow-hidden rounded-xl border border-velion-steel/60 bg-black text-left md:h-[470px]"
          >
            <div className="h-full w-full">
              <img src={post.media_url} alt="post media" className="h-full w-full object-contain" loading="lazy" />
            </div>
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/60 px-2 py-1 text-[11px] text-zinc-200 opacity-0 transition group-hover:opacity-100">
              Ver en grande
            </span>
          </button>
        ) : null}

        <footer className="flex items-center justify-between text-xs text-zinc-300">
          <button
            className={`flex items-center gap-1 transition hover:text-velion-fuchsia ${likedByMe ? "text-rose-400" : ""}`}
            onClick={() => likeMutation.mutate()}
            disabled={likeMutation.isPending}
          >
            <Heart size={15} fill={likedByMe ? "currentColor" : "none"} /> {likesCount}
          </button>
          <button className="flex items-center gap-1 hover:text-velion-fuchsia" onClick={() => setShowComments((prev) => !prev)}>
            <MessageCircle size={15} /> {commentsCount}
          </button>
          <button
            className={`flex items-center gap-1 transition hover:text-velion-fuchsia ${sharedByMe ? "text-emerald-400" : ""}`}
            onClick={() => setShowShareModal(true)}
          >
            <Repeat2 size={15} /> {sharesCount}
          </button>
          <button
            className={`flex items-center gap-1 transition hover:text-velion-fuchsia ${savedByMe ? "text-amber-300" : ""}`}
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            <Bookmark size={15} fill={savedByMe ? "currentColor" : "none"} /> {savedCount}
          </button>
        </footer>

        {shareFeedback && <p className="text-xs text-emerald-400">{shareFeedback}</p>}

        {actionError && <p className="text-xs text-red-400">{actionError}</p>}

        <Modal open={showComments} title="Comentarios" onClose={() => setShowComments(false)} className="max-w-2xl">
          <div className="space-y-2 rounded-xl bg-velion-black/40 p-3">
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {(commentsQuery.data ?? []).map((comment) => (
                <article key={comment.id} className="rounded-lg bg-velion-black/40 p-2 text-xs">
                  {comment.author?.username ? (
                    <span className="inline-flex items-center gap-1">
                      <Link to={getProfileRoute(comment.author.username)} className="font-semibold text-zinc-200 hover:text-velion-fuchsia">
                        {comment.author?.full_name ?? "Usuario"}
                      </Link>
                      <ProfileBadges isPremium={comment.author?.is_premium} isVerified={comment.author?.is_verified} size={12} />
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <p className="font-semibold text-zinc-200">{comment.author?.full_name ?? "Usuario"}</p>
                      <ProfileBadges isPremium={comment.author?.is_premium} isVerified={comment.author?.is_verified} size={12} />
                    </span>
                  )}
                  <p className="text-zinc-300">{comment.content}</p>
                </article>
              ))}

              {commentsQuery.isLoading && <p className="text-xs text-zinc-400">Cargando comentarios...</p>}
            </div>

            <div className="flex gap-2">
              <Input
                value={commentContent}
                onChange={(event) => setCommentContent(event.target.value)}
                placeholder="Escribe un comentario"
              />
              <button
                className="rounded-lg bg-velion-fuchsia px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                disabled={!commentContent.trim() || commentMutation.isPending}
                onClick={() => commentMutation.mutate()}
              >
                Comentar
              </button>
            </div>
          </div>
        </Modal>

        <Modal open={showShareModal} title="Compartir" onClose={() => setShowShareModal(false)} className="max-w-md">
          <div className="space-y-3">
            <div className="relative">
              <textarea
                ref={shareCommentRef}
                value={shareComment}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setShareComment(nextValue);
                  updateShareMentionQuery(nextValue, event.target.selectionStart ?? nextValue.length);
                }}
                onSelect={(event) => {
                  const target = event.target as HTMLTextAreaElement;
                  updateShareMentionQuery(target.value, target.selectionStart ?? target.value.length);
                }}
                placeholder="Agrega un comentario... Usa @usuario y #hashtag"
                className="h-24 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
              />

              {mentionQuery.length > 0 && (mentionUsersQuery.data ?? []).length > 0 && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-44 overflow-y-auto rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
                  {(mentionUsersQuery.data ?? []).map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-velion-black/60"
                      onClick={() => insertShareMention(user.username)}
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

            <Button type="button" className="w-full justify-center gap-2" onClick={() => shareMutation.mutate()} disabled={shareMutation.isPending}>
              <Repeat2 size={14} />
              {shareMutation.isPending ? "Publicando..." : "Compartir"}
            </Button>
            <Button
              type="button"
              className="w-full justify-center gap-2 bg-zinc-700 hover:bg-zinc-600"
              onClick={() => {
                void navigator.clipboard.writeText(postUrl);
                setShareFeedback("Enlace copiado");
                setShowShareModal(false);
                window.setTimeout(() => setShareFeedback(null), 2000);
              }}
            >
              <Link2 size={14} />
              Copiar enlace
            </Button>
          </div>
        </Modal>

        <Modal open={showMediaModal} title="Publicacion" onClose={() => setShowMediaModal(false)} className="max-w-5xl">
          {!isUnavailableRetweet && post.media_url ? (
            <div className="space-y-3">
              <div className="flex max-h-[75vh] min-h-[280px] items-center justify-center overflow-hidden rounded-xl bg-black">
                {post.media_type === "video" ? (
                  <video src={post.media_url} className="max-h-[75vh] w-full object-contain" controls playsInline onPlay={handleVodViewCount} />
                ) : (
                  <img src={post.media_url} alt="post media full" className="max-h-[75vh] w-full object-contain" />
                )}
              </div>
              {postContentDisplay.trim() ? (
                <div className="rounded-lg bg-velion-black/40 p-3 text-sm text-zinc-200 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {postContentDisplay}
                </div>
              ) : null}
            </div>
          ) : null}
        </Modal>

        <Modal open={showDocumentModal} title={parsedDocument.documentName ?? "Vista previa del documento"} onClose={() => setShowDocumentModal(false)} className="max-w-5xl">
          {parsedDocument.documentUrl ? (
            <div className="space-y-3">
              <div className="h-[72vh] overflow-hidden rounded-xl border border-velion-steel/60 bg-black">
                <iframe src={parsedDocument.documentUrl} title={parsedDocument.documentName ?? "Documento"} className="h-full w-full" />
              </div>
              <div className="flex justify-end">
                <a
                  href={parsedDocument.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  download={parsedDocument.documentName ?? "documento"}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-velion-fuchsia px-3 text-xs font-semibold text-white hover:bg-velion-fuchsia/90"
                >
                  <Download size={14} />
                  Descargar documento
                </a>
              </div>
            </div>
          ) : null}
        </Modal>

        <Modal
          open={showEditPostModal}
          title={isRetweetPost ? "Editar comentario de contenido compartido" : "Editar publicacion"}
          onClose={() => setShowEditPostModal(false)}
          className="max-w-xl"
        >
          <div className="space-y-3">
            <textarea
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
              placeholder={isRetweetPost ? "Actualiza tu comentario de contenido compartido" : "Actualiza el contenido de tu publicacion"}
              className="h-32 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setShowEditPostModal(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => editPostMutation.mutate()}
                disabled={editPostMutation.isPending || !editContent.trim()}
              >
                {editPostMutation.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </Modal>

        <Modal open={showDeletePostModal} title="Eliminar publicacion" onClose={() => setShowDeletePostModal(false)} className="max-w-md">
          <div className="space-y-3">
            <p className="text-sm text-zinc-300">Esta accion no se puede deshacer.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setShowDeletePostModal(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                className="bg-rose-600 hover:bg-rose-500"
                onClick={() => deletePostMutation.mutate()}
                disabled={deletePostMutation.isPending}
              >
                {deletePostMutation.isPending ? "Eliminando..." : "Eliminar"}
              </Button>
            </div>
          </div>
        </Modal>

        <Modal open={showReportPostModal} title="Reportar publicacion" onClose={() => setShowReportPostModal(false)} className="max-w-md">
          <div className="space-y-3">
            <textarea
              value={reportReason}
              onChange={(event) => setReportReason(event.target.value.slice(0, 400))}
              placeholder="Describe el motivo del reporte"
              className="h-28 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
            />
            <p className="text-right text-[11px] text-zinc-400">{reportReason.length}/400</p>
            <div className="flex justify-end gap-2">
              <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setShowReportPostModal(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => reportPostMutation.mutate()} disabled={reportPostMutation.isPending || !reportReason.trim()}>
                {reportPostMutation.isPending ? "Enviando..." : "Reportar"}
              </Button>
            </div>
          </div>
        </Modal>
      </Card>
    </motion.article>
  );
}
