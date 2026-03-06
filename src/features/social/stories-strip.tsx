import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Circle, Flag, ImagePlus, MoreVertical, Plus, Square, Type, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ProfileBadges } from "@/components/ui/profile-badges";
import { formatRelativeDate } from "@/lib/date";
import { applyMentionSelection, getMentionMatch } from "@/lib/mentions";
import { invalidateMany } from "@/lib/query-utils";
import { searchProfilesByUsernamePrefix } from "@/services/auth.service";
import { createStory, deleteStory, getStories, reportStory, updateStory } from "@/services/social.service";
import { toAppError } from "@/services/error.service";
import { useAppStore } from "@/store/app.store";

type CreateMode = "upload" | "text" | "camera";
type CameraMode = "photo" | "video";

const createTextStoryImage = async (text: string): Promise<File> => {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo generar la historia de texto");

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#1d4ed8");
  gradient.addColorStop(0.5, "#9333ea");
  gradient.addColorStop(1, "#db2777");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 64px sans-serif";

  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > 860) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);

  const startY = canvas.height / 2 - (lines.length * 80) / 2;
  lines.forEach((current, index) => {
    ctx.fillText(current, canvas.width / 2, startY + index * 90);
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("No se pudo exportar la historia de texto");

  return new File([blob], `story-text-${Date.now()}.jpg`, { type: "image/jpeg" });
};

export function StoriesStrip() {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["stories"], queryFn: getStories });
  const profile = useAppStore((state) => state.profile);

  const [activeAuthorId, setActiveAuthorId] = useState<string | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [seenStoryIds, setSeenStoryIds] = useState<string[]>([]);

  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [openEditStoryModal, setOpenEditStoryModal] = useState(false);
  const [openDeleteStoryModal, setOpenDeleteStoryModal] = useState(false);
  const [openReportStoryModal, setOpenReportStoryModal] = useState(false);
  const [showStoryActionsMenu, setShowStoryActionsMenu] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("upload");
  const [textStory, setTextStory] = useState("");
  const [storyDescription, setStoryDescription] = useState("");
  const [editStoryDescription, setEditStoryDescription] = useState("");
  const [reportStoryReason, setReportStoryReason] = useState("");
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [storyPreviewUrl, setStoryPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mentionQuery, setMentionQuery] = useState("");

  const [cameraMode, setCameraMode] = useState<CameraMode>("photo");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const storyActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const groupedStories = useMemo(() => {
    const groups = new Map<
      string,
      {
        authorId: string;
        latestStory: (typeof data)[number];
        stories: Array<(typeof data)[number]>;
      }
    >();

    data.forEach((story) => {
      const key = story.author_id;
      const current = groups.get(key);
      if (!current) {
        groups.set(key, {
          authorId: key,
          latestStory: story,
          stories: [story],
        });
        return;
      }
      current.stories.push(story);
    });

    return Array.from(groups.values());
  }, [data]);
  const activeGroupStories = useMemo(() => {
    if (!activeAuthorId) return [];
    return groupedStories.find((group) => group.authorId === activeAuthorId)?.stories ?? [];
  }, [activeAuthorId, groupedStories]);
  const activeStory = useMemo(() => {
    return activeGroupStories[activeStoryIndex] ?? null;
  }, [activeGroupStories, activeStoryIndex]);
  const mentionUsersQuery = useQuery({
    queryKey: ["story-mention-users", mentionQuery],
    queryFn: () => searchProfilesByUsernamePrefix(mentionQuery, 6),
    enabled: openCreateModal && mentionQuery.length > 0,
  });
  const isOwnActiveStory = Boolean(activeStory && profile?.id === activeStory.author_id);

  const updateMentionQuery = (value: string, cursor: number) => {
    const mention = getMentionMatch(value, cursor);
    setMentionQuery(mention?.query ?? "");
  };

  const insertMention = (username: string) => {
    const node = descriptionRef.current;
    if (!node) return;

    const cursor = node.selectionStart ?? storyDescription.length;
    const { nextValue, nextCursor } = applyMentionSelection(storyDescription, cursor, username);
    setStoryDescription(nextValue);
    setMentionQuery("");

    window.requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const createStoryMutation = useMutation({
    mutationFn: async () => {
      let fileToPublish = storyFile;

      if (createMode === "text") {
        const trimmed = textStory.trim();
        if (!trimmed) throw new Error("Escribe texto para tu historia");
        fileToPublish = await createTextStoryImage(trimmed);
      }

      if (!fileToPublish) throw new Error("Selecciona o captura un archivo para publicar");

      await createStory(fileToPublish, setUploadProgress, storyDescription);
    },
    onMutate: () => {
      setUploadProgress(8);
    },
    onSuccess: async () => {
      setStoryFile(null);
      setTextStory("");
      setStoryDescription("");
      setCreateError(null);
      setMentionQuery("");
      setUploadProgress(0);
      setOpenCreateModal(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      await invalidateMany(queryClient, [["stories"], ["stories-view"], ["right-panel", "trends"]]);
    },
    onError: (error) => {
      setUploadProgress(0);
      setCreateError(toAppError(error));
    },
  });
  const updateStoryMutation = useMutation({
    mutationFn: async () => {
      if (!activeStory) throw new Error("Historia no disponible");
      await updateStory(activeStory.id, editStoryDescription);
    },
    onSuccess: async () => {
      setOpenEditStoryModal(false);
      await invalidateMany(queryClient, [["stories"], ["stories-view"], ["right-panel", "trends"]]);
    },
    onError: (error) => setCreateError(toAppError(error)),
  });

  const deleteStoryMutation = useMutation({
    mutationFn: async () => {
      if (!activeStory) throw new Error("Historia no disponible");
      await deleteStory(activeStory.id);
    },
    onSuccess: async () => {
      setOpenDeleteStoryModal(false);
      closeStory();
      await invalidateMany(queryClient, [["stories"], ["stories-view"], ["right-panel", "trends"]]);
    },
    onError: (error) => setCreateError(toAppError(error)),
  });
  const reportStoryMutation = useMutation({
    mutationFn: async () => {
      if (!activeStory) throw new Error("Historia no disponible");
      await reportStory(activeStory.id, reportStoryReason);
    },
    onSuccess: () => {
      setOpenReportStoryModal(false);
      setReportStoryReason("");
      setCreateError(null);
    },
    onError: (error) => setCreateError(toAppError(error)),
  });

  const markStoryAsSeen = (storyId: string) => {
    setSeenStoryIds((previous) => (previous.includes(storyId) ? previous : [...previous, storyId]));
  };

  const openStoryGroup = (authorId: string, index = 0) => {
    const stories = groupedStories.find((group) => group.authorId === authorId)?.stories ?? [];
    const story = stories[index];
    if (!story) return;
    setActiveAuthorId(authorId);
    setActiveStoryIndex(index);
    markStoryAsSeen(story.id);
  };

  const goToStoryInGroup = (nextIndex: number) => {
    const story = activeGroupStories[nextIndex];
    if (!story) return;
    setActiveStoryIndex(nextIndex);
    markStoryAsSeen(story.id);
  };

  const closeStory = () => {
    setActiveAuthorId(null);
    setActiveStoryIndex(0);
    setShowStoryActionsMenu(false);
  };

  const stopCamera = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setIsRecording(false);
  };

  const startCamera = async () => {
    try {
      setCameraError(null);
      stopCamera();
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("La camara no esta disponible en este navegador o contexto.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: cameraMode === "video",
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setCameraError("No se pudo acceder a la camara. Revisa permisos del navegador.");
    }
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return;

    setStoryFile(new File([blob], `story-camera-${Date.now()}.jpg`, { type: "image/jpeg" }));
  };

  const startVideoRecording = () => {
    if (!streamRef.current) return;
    try {
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        if (blob.size > 0) {
          setStoryFile(new File([blob], `story-camera-${Date.now()}.webm`, { type: "video/webm" }));
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      setCameraError("No se pudo iniciar la grabacion de video en este dispositivo.");
    }
  };

  const stopVideoRecording = () => {
    recorderRef.current?.stop();
    setIsRecording(false);
  };

  useEffect(() => {
    if (!storyFile) {
      setStoryPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(storyFile);
    setStoryPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [storyFile]);

  useEffect(() => {
    if (!openCreateModal) {
      stopCamera();
      setStoryFile(null);
      setTextStory("");
      setStoryDescription("");
      setCreateError(null);
      setMentionQuery("");
      setCameraError(null);
      setUploadProgress(0);
      setCreateMode("upload");
      setCameraMode("photo");
    }
  }, [openCreateModal]);

  useEffect(() => {
    if (!openCreateModal || createMode !== "camera") return;
    void startCamera();
    return () => stopCamera();
  }, [openCreateModal, createMode, cameraMode]);

  useEffect(() => {
    if (!showStoryActionsMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!storyActionsMenuRef.current) return;
      if (storyActionsMenuRef.current.contains(event.target as Node)) return;
      setShowStoryActionsMenu(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showStoryActionsMenu]);

  return (
    <>
      <div className="rounded-2xl border border-velion-steel/70 bg-velion-black/25 p-3">
        <div className="flex gap-3 overflow-x-auto pb-1">
          <button
            type="button"
            className="flex w-20 shrink-0 flex-col items-center gap-1 text-center"
            aria-label="Crear historia"
            onClick={() => setOpenCreateModal(true)}
          >
            <span className="grid h-[70px] w-[70px] place-items-center rounded-full border border-dashed border-velion-fuchsia/70 bg-velion-black/70 text-velion-fuchsia">
              <Plus size={18} />
            </span>
            <span className="w-full truncate text-[11px] text-zinc-300">{profile?.full_name ?? "Tu historia"}</span>
          </button>

          {groupedStories.map((group) => {
            const story = group.latestStory;
            const isSeen = group.stories.every((item) => seenStoryIds.includes(item.id));
            const storyName = story.profile?.full_name ?? story.profile?.username ?? group.authorId;

            return (
              <button
                type="button"
                key={group.authorId}
                className="flex w-20 shrink-0 flex-col items-center gap-1 text-center"
                onClick={() => openStoryGroup(group.authorId, 0)}
                aria-label={`Historia de ${storyName}`}
              >
                <span
                  className={`rounded-full p-[2px] ${
                    isSeen ? "bg-zinc-700" : "bg-gradient-to-br from-amber-400 via-fuchsia-500 to-violet-500"
                  }`}
                >
                  <span className="block rounded-full bg-velion-discord p-[2px]">
                    <img src={story.media_url} alt="story" className="h-[66px] w-[66px] rounded-full object-cover" loading="lazy" />
                  </span>
                </span>
                <span className="w-full truncate text-[11px] text-zinc-300">{story.profile?.username ? `@${story.profile.username}` : "@usuario"}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Modal open={activeStory !== null} title="Historias" onClose={closeStory} className="max-w-2xl">
        {activeStory && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-300">
              <span className="inline-flex items-center gap-1 font-medium">
                {activeStory.profile?.full_name ?? activeStory.profile?.username ?? "Usuario"}
                <ProfileBadges isPremium={activeStory.profile?.is_premium} isVerified={activeStory.profile?.is_verified} size={12} />
              </span>
              <div className="flex items-center gap-2">
                <span>{formatRelativeDate(activeStory.created_at)}</span>
                <div ref={storyActionsMenuRef} className="relative">
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-700/60 text-zinc-100 hover:bg-zinc-600"
                    onClick={() => setShowStoryActionsMenu((prev) => !prev)}
                    aria-label="Opciones de historia"
                  >
                    <MoreVertical size={13} />
                  </button>
                  {showStoryActionsMenu && (
                    <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[160px] rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
                      {isOwnActiveStory && (
                        <button
                          type="button"
                          className="w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-700/70"
                          onClick={() => {
                            setShowStoryActionsMenu(false);
                            setEditStoryDescription(activeStory.description ?? "");
                            setOpenEditStoryModal(true);
                          }}
                        >
                          Editar
                        </button>
                      )}
                      {isOwnActiveStory && (
                        <button
                          type="button"
                          className="w-full rounded-md px-3 py-2 text-left text-xs text-rose-300 hover:bg-rose-900/40"
                          onClick={() => {
                            setShowStoryActionsMenu(false);
                            setOpenDeleteStoryModal(true);
                          }}
                        >
                          Eliminar
                        </button>
                      )}
                      {!isOwnActiveStory && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-amber-300 hover:bg-amber-900/30"
                          onClick={() => {
                            setShowStoryActionsMenu(false);
                            setOpenReportStoryModal(true);
                          }}
                        >
                          <Flag size={13} />
                          Reportar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-velion-steel/60 bg-black">
              {activeStory.media_type === "video" ? (
                <video src={activeStory.media_url} controls autoPlay className="h-[420px] w-full object-cover" />
              ) : (
                <img src={activeStory.media_url} alt="Historia" className="h-[420px] w-full object-cover" />
              )}
            </div>
            {activeStory.description && <p className="rounded-xl border border-velion-steel/60 bg-velion-black/40 p-3 text-sm text-zinc-200">{activeStory.description}</p>}
            <div className="flex items-center justify-between">
              <Button
                type="button"
                className="bg-zinc-700 text-xs"
                disabled={activeStoryIndex <= 0}
                onClick={() => {
                  if (activeStoryIndex <= 0) return;
                  goToStoryInGroup(activeStoryIndex - 1);
                }}
              >
                Anterior
              </Button>
              <span className="text-xs text-zinc-400">
                {activeStory ? activeStoryIndex + 1 : 0} / {activeGroupStories.length}
              </span>
              <Button
                type="button"
                className="bg-zinc-700 text-xs"
                disabled={activeStoryIndex >= activeGroupStories.length - 1}
                onClick={() => {
                  if (activeStoryIndex >= activeGroupStories.length - 1) return;
                  goToStoryInGroup(activeStoryIndex + 1);
                }}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={openEditStoryModal} title="Editar historia" onClose={() => setOpenEditStoryModal(false)} className="max-w-md">
        <div className="space-y-3">
          <textarea
            value={editStoryDescription}
            onChange={(event) => setEditStoryDescription(event.target.value)}
            placeholder="Descripcion de la historia"
            className="h-28 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenEditStoryModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => updateStoryMutation.mutate()} disabled={updateStoryMutation.isPending}>
              {updateStoryMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={openDeleteStoryModal} title="Eliminar historia" onClose={() => setOpenDeleteStoryModal(false)} className="max-w-md">
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">Esta accion no se puede deshacer.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenDeleteStoryModal(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-rose-600 hover:bg-rose-500"
              onClick={() => deleteStoryMutation.mutate()}
              disabled={deleteStoryMutation.isPending}
            >
              {deleteStoryMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={openReportStoryModal} title="Reportar historia" onClose={() => setOpenReportStoryModal(false)} className="max-w-md">
        <div className="space-y-3">
          <textarea
            value={reportStoryReason}
            onChange={(event) => setReportStoryReason(event.target.value.slice(0, 400))}
            placeholder="Describe el motivo del reporte"
            className="h-28 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
          />
          <p className="text-right text-[11px] text-zinc-400">{reportStoryReason.length}/400</p>
          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenReportStoryModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => reportStoryMutation.mutate()} disabled={reportStoryMutation.isPending || !reportStoryReason.trim()}>
              {reportStoryMutation.isPending ? "Enviando..." : "Reportar"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={openCreateModal} title="Crear historia" onClose={() => setOpenCreateModal(false)} className="max-w-2xl">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" className={createMode === "upload" ? "" : "bg-zinc-700 hover:bg-zinc-600"} onClick={() => setCreateMode("upload")}> 
              <Upload size={14} /> Archivo
            </Button>
            <Button type="button" className={createMode === "text" ? "" : "bg-zinc-700 hover:bg-zinc-600"} onClick={() => setCreateMode("text")}> 
              <Type size={14} /> Texto
            </Button>
            <Button type="button" className={createMode === "camera" ? "" : "bg-zinc-700 hover:bg-zinc-600"} onClick={() => setCreateMode("camera")}> 
              <Camera size={14} /> Camara
            </Button>
          </div>

          {createMode === "upload" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-velion-fuchsia/25 text-zinc-100 hover:bg-velion-fuchsia/35"
                  aria-label="Elegir archivo"
                >
                  <ImagePlus size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                  aria-label="Abrir camara"
                >
                  <Camera size={18} />
                </button>
                <p className="text-xs text-zinc-400">Sube desde galeria o abre camara</p>
              </div>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(event) => setStoryFile(event.target.files?.[0] ?? null)}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*,video/*"
                capture="environment"
                className="hidden"
                onChange={(event) => setStoryFile(event.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-zinc-500">Tip movil: el segundo selector abre camara directamente en muchos dispositivos.</p>
            </div>
          )}

          {createMode === "text" && (
            <div className="space-y-2">
              <textarea
                value={textStory}
                onChange={(event) => setTextStory(event.target.value)}
                placeholder="Escribe el texto de tu historia..."
                className="h-32 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
              />
              <p className="text-xs text-zinc-500">Se publicara como imagen de texto estilo historia.</p>
            </div>
          )}

          {createMode === "camera" && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button type="button" className={cameraMode === "photo" ? "" : "bg-zinc-700 hover:bg-zinc-600"} onClick={() => setCameraMode("photo")}>Foto</Button>
                <Button type="button" className={cameraMode === "video" ? "" : "bg-zinc-700 hover:bg-zinc-600"} onClick={() => setCameraMode("video")}>Video</Button>
              </div>

              <video ref={videoRef} playsInline muted className="h-72 w-full rounded-xl bg-black object-cover" />

              <div className="flex flex-wrap gap-2">
                <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => void startCamera()}>Activar camara</Button>
                {cameraMode === "photo" && (
                  <Button type="button" onClick={() => void capturePhoto()} disabled={!cameraReady}>
                    <Camera size={14} /> Capturar foto
                  </Button>
                )}
                {cameraMode === "video" && !isRecording && (
                  <Button type="button" onClick={() => startVideoRecording()} disabled={!cameraReady}>
                    <Circle size={14} /> Grabar video
                  </Button>
                )}
                {cameraMode === "video" && isRecording && (
                  <Button type="button" className="bg-rose-600 hover:bg-rose-500" onClick={() => stopVideoRecording()}>
                    <Square size={14} /> Detener
                  </Button>
                )}
              </div>

              {cameraError && <p className="text-xs text-red-400">{cameraError}</p>}
            </div>
          )}

          {storyFile && (
            <div className="w-fit rounded-xl bg-velion-black/40 p-2">
              {storyPreviewUrl &&
                (storyFile.type.startsWith("video/") ? (
                  <video src={storyPreviewUrl} controls className="h-28 w-28 rounded-lg object-cover" />
                ) : (
                  <img src={storyPreviewUrl} alt="preview" className="h-28 w-28 rounded-lg object-cover" />
                ))}
            </div>
          )}

          <div className="relative space-y-2">
            <textarea
              ref={descriptionRef}
              value={storyDescription}
              onChange={(event) => {
                const nextValue = event.target.value;
                setStoryDescription(nextValue);
                updateMentionQuery(nextValue, event.target.selectionStart ?? nextValue.length);
              }}
              onSelect={(event) => {
                const target = event.target as HTMLTextAreaElement;
                updateMentionQuery(target.value, target.selectionStart ?? target.value.length);
              }}
              placeholder="Descripcion opcional... usa @usuario y #hashtag"
              className="h-24 w-full resize-none rounded-xl border border-velion-steel bg-velion-black/60 p-3 text-sm outline-none"
            />
            {mentionQuery.length > 0 && (mentionUsersQuery.data ?? []).length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+2px)] z-20 max-h-52 overflow-y-auto rounded-lg border border-velion-steel/70 bg-velion-black/95 p-1">
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

          {createStoryMutation.isPending && (
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

          {createError && <p className="text-xs text-red-400">{createError}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" className="bg-zinc-700 hover:bg-zinc-600" onClick={() => setOpenCreateModal(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => createStoryMutation.mutate()} disabled={createStoryMutation.isPending}>
              {createStoryMutation.isPending ? "Publicando..." : "Publicar historia"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
