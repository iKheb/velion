import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ProfileBadges } from "@/components/ui/profile-badges";
import { banUserFromStream, getLiveMessages, reportLiveMessage, sendLiveMessage, subscribeLiveMessages } from "@/services/streaming.service";
import { toAppError } from "@/services/error.service";
import type { LiveMessage } from "@/types/models";

interface LiveChatProps {
  streamId: string;
  canModerate?: boolean;
  currentUserId?: string | null;
}

export function LiveChat({ streamId, canModerate = false, currentUserId = null }: LiveChatProps) {
  const [content, setContent] = useState("");
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data = [] } = useQuery({
    queryKey: ["live-messages", streamId],
    queryFn: () => getLiveMessages(streamId),
    enabled: Boolean(streamId),
  });

  useEffect(() => {
    setMessages(data);
  }, [data]);

  useEffect(() => {
    if (!streamId) return;

    return subscribeLiveMessages(streamId, (message) => {
      setMessages((prev) => [...prev.slice(-99), message]);
    });
  }, [streamId]);

  const onSend = async () => {
    try {
      await sendLiveMessage(streamId, content);
      setContent("");
      setError(null);
    } catch (err) {
      setError(toAppError(err));
    }
  };

  const onReport = async (message: LiveMessage) => {
    const reason = window.prompt("Motivo del reporte:", "spam o abuso");
    if (!reason?.trim()) return;

    try {
      await reportLiveMessage({
        streamId,
        messageId: message.id,
        reportedUserId: message.sender_id,
        reason,
      });
      setError(null);
    } catch (err) {
      setError(toAppError(err));
    }
  };

  const onBan = async (message: LiveMessage) => {
    const reason = window.prompt("Motivo del baneo:", "comportamiento abusivo");
    if (!reason?.trim()) return;

    try {
      await banUserFromStream({ streamId, userId: message.sender_id, reason });
      setError(null);
    } catch (err) {
      setError(toAppError(err));
    }
  };

  return (
    <Card className="flex h-[62vh] flex-col gap-3">
      <h3 className="text-sm font-semibold">Chat en vivo</h3>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.map((message) => (
          <div key={message.id} className="flex items-start gap-2 rounded-lg bg-velion-black/50 px-2 py-1 text-xs text-zinc-200">
            <img
              src={message.sender_profile?.avatar_url ?? "https://placehold.co/24x24?text=U"}
              alt={message.sender_profile?.username ?? "usuario"}
              className="h-6 w-6 rounded-full border border-zinc-700 object-cover"
            />
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1 font-semibold text-zinc-100">
                @{message.sender_profile?.username ?? "usuario"}
                <ProfileBadges isPremium={message.sender_profile?.is_premium} isVerified={message.sender_profile?.is_verified} size={11} />
              </p>
              <p className="break-words">{message.content}</p>
            </div>
            {canModerate && message.sender_id !== currentUserId && (
              <div className="ml-auto flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded bg-zinc-700 px-2 py-1 text-[10px] hover:bg-zinc-600"
                  onClick={() => void onReport(message)}
                >
                  Reportar
                </button>
                <button
                  type="button"
                  className="rounded bg-red-700 px-2 py-1 text-[10px] hover:bg-red-600"
                  onClick={() => void onBan(message)}
                >
                  Ban
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input value={content} onChange={(event) => setContent(event.target.value)} placeholder="Enviar mensaje" />
        <Button onClick={() => void onSend()} disabled={!content.trim()}>
          Enviar
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </Card>
  );
}
