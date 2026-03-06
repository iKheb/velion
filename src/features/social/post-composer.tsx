import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, ImagePlus, SendHorizontal, Type, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { applyMentionSelection, getMentionMatch } from "@/lib/mentions";
import { searchProfilesByUsernamePrefix } from "@/services/auth.service";
import { toAppError } from "@/services/error.service";
import { createPost } from "@/services/social.service";

interface PostComposerProps {
  compact?: boolean;
}

const createTextPostImage = async (text: string): Promise<File> => {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo generar la imagen de texto");

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#1d4ed8");
  gradient.addColorStop(0.5, "#9333ea");
  gradient.addColorStop(1, "#db2777");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 58px sans-serif";

  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(nextLine).width > 860) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  }
  if (line) lines.push(line);

  const startY = canvas.height / 2 - (lines.length * 78) / 2;
  lines.forEach((current, index) => {
    ctx.fillText(current, canvas.width / 2, startY + index * 84);
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("No se pudo exportar la imagen de texto");
  return new File([blob], `post-text-${Date.now()}.jpg`, { type: "image/jpeg" });
};

export function PostComposer({ compact = false }: PostComposerProps) {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const [content, setContent] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [textImageMode, setTextImageMode] = useState(false);
  const [openComposerModal, setOpenComposerModal] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaPreviewUrl = useMemo(() => (mediaFile ? URL.createObjectURL(mediaFile) : null), [mediaFile]);

  useEffect(() => {
    return () => {
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    };
  }, [mediaPreviewUrl]);

  const mentionUsersQuery = useQuery({
    queryKey: ["mention-users", mentionQuery],
    queryFn: () => searchProfilesByUsernamePrefix(mentionQuery, 6),
    enabled: openComposerModal && mentionQuery.length > 0,
  });

  const clearComposer = () => {
    setContent("");
    setMediaFile(null);
    setDocumentFile(null);
    setTextImageMode(false);
    setMentionQuery("");
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (documentInputRef.current) {
      documentInputRef.current.value = "";
    }
  };

  const updateMentionQuery = (value: string, cursor: number) => {
    const mention = getMentionMatch(value, cursor);
    setMentionQuery(mention?.query ?? "");
  };

  const insertMention = (username: string) => {
    const node = textareaRef.current;
    if (!node) return;

    const cursor = node.selectionStart ?? content.length;
    const { nextValue, nextCursor } = applyMentionSelection(content, cursor, username);
    setContent(nextValue);
    setMentionQuery("");

    window.requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setUploadProgress(8);

    try {
      let finalMediaFile = mediaFile;
      if (textImageMode && !finalMediaFile && content.trim()) {
        finalMediaFile = await createTextPostImage(content.trim());
      }

      await createPost(content, finalMediaFile, setUploadProgress, { documentFile });
      clearComposer();
      setOpenComposerModal(false);
      await queryClient.invalidateQueries({ queryKey: ["feed"] });
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {compact ? (
        <div className="shrink-0">
          <Button type="button" onClick={() => setOpenComposerModal(true)} className="flex items-center gap-2">
            <SendHorizontal size={14} />
            Nueva publicacion
          </Button>
          {error && <p className="mt-2 text-right text-xs text-red-400">{error}</p>}
        </div>
      ) : (
        <Card className="shadow-glow">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-300">Publica contenido en un flujo limpio y enfocado.</p>
            <Button type="button" onClick={() => setOpenComposerModal(true)} className="flex items-center gap-2">
              <SendHorizontal size={14} />
              Nueva publicacion
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </Card>
      )}

      <Modal open={openComposerModal} onClose={() => setOpenComposerModal(false)} title="Crear publicacion">
        <div className="space-y-3">
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(event) => {
                const nextValue = event.target.value;
                setContent(nextValue);
                updateMentionQuery(nextValue, event.target.selectionStart ?? nextValue.length);
              }}
              onSelect={(event) => {
                const target = event.target as HTMLTextAreaElement;
                updateMentionQuery(target.value, target.selectionStart ?? target.value.length);
              }}
              placeholder="Comparte una jugada, noticia o clip... Usa @usuario y #hashtag"
              className="h-32 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
            />

            {mentionQuery.length > 0 && (mentionUsersQuery.data ?? []).length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-52 overflow-y-auto rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
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
                onClick={() => setTextImageMode((previous) => !previous)}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-100 ${textImageMode ? "bg-velion-fuchsia/45" : "bg-velion-fuchsia/25 hover:bg-velion-fuchsia/35"}`}
                aria-label="Texto estilo historia"
              >
                <Type size={18} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocumentFile(null);
                  if (documentInputRef.current) documentInputRef.current.value = "";
                  fileInputRef.current?.click();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-velion-fuchsia/25 text-zinc-100 hover:bg-velion-fuchsia/35"
                aria-label="Adjuntar archivo"
              >
                <ImagePlus size={18} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setMediaFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                  documentInputRef.current?.click();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-velion-fuchsia/25 text-zinc-100 hover:bg-velion-fuchsia/35"
                aria-label="Adjuntar documento"
              >
                <FileUp size={18} />
              </button>
              <p className="text-xs text-zinc-300">
                {documentFile ? "Documento seleccionado" : mediaFile ? "Archivo seleccionado" : textImageMode ? "Texto tipo historia activado" : "Adjunta imagen, video o documento"}
              </p>
            </div>
            {(mediaFile || documentFile) && (
              <button
                type="button"
                onClick={() => {
                  setMediaFile(null);
                  setDocumentFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                  if (documentInputRef.current) documentInputRef.current.value = "";
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700/70 text-zinc-100 hover:bg-zinc-600"
                aria-label="Quitar archivo"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={(event) => {
              setMediaFile(event.target.files?.[0] ?? null);
              setDocumentFile(null);
              if (documentInputRef.current) documentInputRef.current.value = "";
            }}
            className="hidden"
          />
          <input
            ref={documentInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt,.rtf,.ppt,.pptx,.xls,.xlsx,.csv"
            onChange={(event) => {
              setDocumentFile(event.target.files?.[0] ?? null);
              setMediaFile(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="hidden"
          />

          {mediaFile && mediaPreviewUrl && (
            <div className="w-fit rounded-xl border border-velion-steel/60 bg-velion-black/40 p-2">
              {mediaFile.type.startsWith("video/") ? (
                <video src={mediaPreviewUrl} className="h-28 w-28 rounded-lg object-cover" muted playsInline controls />
              ) : (
                <img src={mediaPreviewUrl} alt="Vista previa" className="h-28 w-28 rounded-lg object-cover" />
              )}
            </div>
          )}

          {documentFile && (
            <div className="w-fit rounded-xl border border-velion-steel/60 bg-velion-black/40 px-3 py-2">
              <p className="text-xs text-zinc-200">{documentFile.name}</p>
              <p className="text-[11px] text-zinc-400">Se publicara como enlace descargable.</p>
            </div>
          )}

          {loading && (
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
            <Button
              type="button"
              className="bg-zinc-700 hover:bg-zinc-600"
              onClick={() => {
                setOpenComposerModal(false);
                setMentionQuery("");
                setUploadProgress(0);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={loading || (!content.trim() && !mediaFile && !documentFile)}
              className="flex items-center justify-center gap-2"
            >
              <SendHorizontal size={14} />
              {loading ? "Publicando..." : "Publicar"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
