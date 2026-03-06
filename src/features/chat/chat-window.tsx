import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getConversationMessages,
  getConversationReadState,
  markConversationAsDelivered,
  markConversationAsRead,
  sendMediaMessage,
  sendMessage,
  subscribeConversationReadState,
  subscribeMessages,
} from "@/services/chat.service";
import { formatRelativeDate } from "@/lib/date";
import { useChatStore } from "@/store/chat.store";
import { useAppStore } from "@/store/app.store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProfileBadges } from "@/components/ui/profile-badges";
import type { ChatMessage } from "@/types/models";

const EMPTY_MESSAGES: ChatMessage[] = [];

interface ChatWindowProps {
  conversationId: string;
  peerUsername?: string;
  peerAvatarUrl?: string | null;
  peerIsPremium?: boolean;
  peerIsVerified?: boolean;
}

export function ChatWindow({ conversationId, peerUsername, peerAvatarUrl, peerIsPremium = false, peerIsVerified = false }: ChatWindowProps) {
  const [message, setMessage] = useState("");
  const [typing, setTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const profile = useAppStore((state) => state.profile);
  const upsertMessage = useChatStore((state) => state.upsertMessage);
  const setConversationMessages = useChatStore((state) => state.setConversationMessages);
  const setTypingFlag = useChatStore((state) => state.setTyping);
  const latestMessages = useChatStore((state) => state.latestMessages[conversationId] ?? EMPTY_MESSAGES);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const uploadTimerRef = useRef<number | null>(null);

  const { data, refetch: refetchMessages } = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => getConversationMessages(conversationId),
    enabled: Boolean(conversationId),
  });

  const { data: readState = [], refetch: refetchReadState } = useQuery({
    queryKey: ["conversation-read-state", conversationId],
    queryFn: () => getConversationReadState(conversationId),
    enabled: Boolean(conversationId && profile?.id),
  });

  useEffect(() => {
    if (!data) return;
    setConversationMessages(conversationId, data);
  }, [conversationId, data, setConversationMessages]);

  useEffect(() => {
    if (!conversationId) return;
    void markConversationAsDelivered(conversationId);
    const timer = window.setTimeout(() => {
      void markConversationAsRead(conversationId);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [conversationId, latestMessages.length]);

  useEffect(() => subscribeMessages(conversationId, upsertMessage), [conversationId, upsertMessage]);
  useEffect(
    () =>
      subscribeConversationReadState(conversationId, () => {
        void refetchReadState();
        void refetchMessages();
      }),
    [conversationId, refetchMessages, refetchReadState],
  );

  useEffect(
    () => () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (uploadTimerRef.current) {
        window.clearInterval(uploadTimerRef.current);
      }
    },
    [],
  );

  const startUploadProgress = () => {
    setUploadProgress(10);
    if (uploadTimerRef.current) {
      window.clearInterval(uploadTimerRef.current);
    }
    uploadTimerRef.current = window.setInterval(() => {
      setUploadProgress((prev) => (prev >= 90 ? prev : prev + 8));
    }, 180);
  };

  const finishUploadProgress = () => {
    if (uploadTimerRef.current) {
      window.clearInterval(uploadTimerRef.current);
      uploadTimerRef.current = null;
    }
    setUploadProgress(100);
    window.setTimeout(() => setUploadProgress(0), 450);
  };

  const peerLastReadAtMs = useMemo(() => {
    const peerLastReadAt = readState[0]?.last_read_at ?? null;
    return peerLastReadAt ? new Date(peerLastReadAt).getTime() : null;
  }, [readState]);

  const onSend = async () => {
    await sendMessage(conversationId, message);
    setMessage("");
    setTyping(false);
    setTypingFlag(conversationId, false);
  };

  const onUploadMedia = async (file: File) => {
    if (!conversationId) return;
    setUploadError(null);

    const normalizedType = file.type.toLowerCase();
    const messageType = normalizedType.startsWith("image/")
      ? "image"
      : normalizedType.startsWith("video/")
        ? "video"
        : normalizedType.startsWith("audio/")
          ? "audio"
          : null;

    if (!messageType) {
      setUploadError("Formato no soportado. Usa imagen, video o audio.");
      return;
    }

    const limitsByType = {
      image: 10 * 1024 * 1024,
      video: 20 * 1024 * 1024,
      audio: 12 * 1024 * 1024,
    } as const;

    const maxBytes = limitsByType[messageType];
    if (file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      setUploadError(`El archivo supera el limite de ${maxMb}MB para ${messageType}.`);
      return;
    }

    setIsUploading(true);
    startUploadProgress();
    try {
      await sendMediaMessage(conversationId, file, messageType);
      finishUploadProgress();
    } catch {
      setUploadError("No se pudo subir el archivo. Intenta de nuevo.");
      if (uploadTimerRef.current) {
        window.clearInterval(uploadTimerRef.current);
        uploadTimerRef.current = null;
      }
      setUploadProgress(0);
    } finally {
      setIsUploading(false);
    }
  };

  const onFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    if (!selectedFile) return;

    await onUploadMedia(selectedFile);
    event.target.value = "";
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    setIsRecording(false);
  };

  const startRecording = async () => {
    if (isRecording || !conversationId) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

    mediaStreamRef.current = stream;
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };

    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      if (!blob.size) return;

      const voiceFile = new File([blob], `voice-note-${Date.now()}.webm`, { type: "audio/webm" });
      await onUploadMedia(voiceFile);
      audioChunksRef.current = [];
    };

    recorder.start();
    setIsRecording(true);
  };

  return (
    <section className="flex h-[72vh] flex-col rounded-2xl border border-velion-steel bg-velion-discord/70 p-3">
      <div className="flex-1 space-y-2 overflow-y-auto pr-2">
        {latestMessages.map((item) => {
          const isMine = item.sender_id === profile?.id;
          const avatarSrc = isMine ? profile?.avatar_url : peerAvatarUrl;

          return (
            <div key={item.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
              <div className={`flex max-w-[88%] items-end gap-2 ${isMine ? "flex-row-reverse" : ""}`}>
                <img
                  src={avatarSrc ?? "https://placehold.co/40x40?text=U"}
                  alt={isMine ? "Tu avatar" : `Avatar de ${peerUsername ?? "usuario"}`}
                  className="h-7 w-7 shrink-0 rounded-full border border-zinc-700 object-cover"
                />
                <div
                  className={`max-w-full rounded-xl px-3 py-2 text-sm ${
                    isMine ? "bg-velion-fuchsia/30 text-zinc-100" : "bg-velion-black/60 text-zinc-200"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-zinc-200">
                    <span>{isMine ? "Tu" : `@${peerUsername ?? "usuario"}`}</span>
                    <ProfileBadges
                      isPremium={isMine ? profile?.is_premium : peerIsPremium}
                      isVerified={isMine ? profile?.is_verified : peerIsVerified}
                      size={12}
                    />
                  </div>
                  <p className="whitespace-pre-wrap break-words">{item.content}</p>

                  {item.attachment_url && item.message_type === "image" && (
                    <img
                      src={item.attachment_url}
                      alt="Adjunto"
                      className="mt-2 max-h-64 w-full rounded-lg border border-zinc-700 object-cover"
                    />
                  )}

                  {item.attachment_url && item.message_type === "video" && (
                    <video src={item.attachment_url} controls className="mt-2 max-h-72 w-full rounded-lg border border-zinc-700" />
                  )}

                  {item.attachment_url && item.message_type === "audio" && (
                    <audio src={item.attachment_url} controls className="mt-2 w-full" />
                  )}

                  <p className={`mt-1 text-[10px] ${isMine ? "text-zinc-200/80" : "text-zinc-400"}`}>
                    {isMine
                      ? `${
                          item.delivery_status === "read"
                            ? "Leido"
                            : item.delivery_status === "delivered"
                              ? "Entregado"
                              : peerLastReadAtMs && new Date(item.created_at).getTime() <= peerLastReadAtMs
                                ? "Leido"
                                : "Enviado"
                        } · ${formatRelativeDate(item.created_at)}`
                      : `@${peerUsername ?? "usuario"} · ${formatRelativeDate(item.created_at)}`}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {typing && <p className="pt-2 text-xs text-zinc-400">Escribiendo...</p>}
      {uploadError && <p className="pt-2 text-xs text-red-400">{uploadError}</p>}
      {isUploading && (
        <div className="pt-2">
          <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-700/80">
            <div
              className="h-full bg-velion-fuchsia transition-[width] duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">Subiendo archivo... {uploadProgress}%</p>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          className="hidden"
          onChange={(event) => void onFileSelected(event)}
        />

        <Button type="button" className="bg-zinc-700 px-3" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          {isUploading ? "Subiendo..." : "Adjuntar"}
        </Button>

        <Button
          type="button"
          className={`px-3 ${isRecording ? "bg-red-700 hover:bg-red-600" : "bg-zinc-700"}`}
          onClick={() => void (isRecording ? stopRecording() : startRecording())}
          disabled={isUploading}
        >
          {isRecording ? "Detener voz" : "Nota de voz"}
        </Button>

        <Input
          value={message}
          placeholder="Escribe un mensaje..."
          onChange={(event) => {
            const next = event.target.value;
            setMessage(next);
            const currentlyTyping = next.length > 0;
            setTyping(currentlyTyping);
            setTypingFlag(conversationId, currentlyTyping);
          }}
        />

        <Button onClick={() => void onSend()} disabled={!conversationId || !message.trim() || isUploading}>
          Enviar
        </Button>
      </div>
    </section>
  );
}
