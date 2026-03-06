import { Bell, MessageCircleMore, Radio, UserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { getProfileRoute, ROUTES } from "@/lib/constants";
import { formatRelativeDate } from "@/lib/date";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";
import { listConversations } from "@/services/chat.service";
import { markAllNotificationsAsRead, markNotificationAsRead } from "@/services/notifications.service";
import { useAppStore } from "@/store/app.store";

const actions = [
  { to: ROUTES.messages, label: "Ir a mensajes", icon: MessageCircleMore },
  { to: ROUTES.notifications, label: "Ver notificaciones", icon: Bell },
  { to: ROUTES.streaming, label: "Explorar streams", icon: Radio },
  { to: ROUTES.streamingStudio, label: "Gestionar canal", icon: Radio },
];

export function HomeQuickActions() {
  const profile = useAppStore((state) => state.profile);
  const [optimisticReadIds, setOptimisticReadIds] = useState<string[]>([]);
  const [markingAll, setMarkingAll] = useState(false);
  const notifications = useRealtimeNotifications();
  const { data: conversations = [] } = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  const latestConversations = conversations.slice(0, 2);
  const latestNotifications = notifications.slice(0, 3);

  const getNotificationTarget = (eventType: string, entityId: string | null, actorUsername?: string | null): string => {
    if (eventType === "live" && entityId) return `/streaming/${entityId}`;
    if (eventType === "stream_vod" && entityId) return `/streaming/video/${entityId}`;
    if (["friend_request", "friend_accept", "follow", "subscription"].includes(eventType) && actorUsername) {
      return getProfileRoute(actorUsername);
    }
    return ROUTES.notifications;
  };

  return (
    <Card className="space-y-3 bg-gradient-to-r from-velion-black/70 to-velion-discord/50">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-400">Inicio</p>
        <h2 className="text-lg font-semibold text-zinc-100">
          {profile?.full_name ? `Hola, ${profile.full_name}` : "Bienvenido a Velion"}
        </h2>
        <p className="text-xs text-zinc-400">Accesos rapidos para arrancar tu sesion.</p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <Link
          to={getProfileRoute(profile?.username ?? "me")}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-velion-fuchsia px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
        >
          <UserRound size={14} />
          Mi perfil
        </Link>
        {actions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-600"
          >
            <action.icon size={14} />
            {action.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 pt-1 lg:grid-cols-2">
        <div className="rounded-xl bg-velion-black/40 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Mensajes recientes</p>
          {latestConversations.length === 0 && <p className="text-xs text-zinc-500">Sin conversaciones recientes.</p>}
          {latestConversations.map((conversation) => (
            <Link
              key={conversation.conversation_id}
              to={`${ROUTES.messages}/${encodeURIComponent(conversation.peer_username)}?conversation=${encodeURIComponent(
                conversation.conversation_id,
              )}`}
              className="mb-1 block rounded-lg px-2 py-1 text-xs text-zinc-200 transition hover:bg-velion-black/60"
            >
              <span className="font-semibold">@{conversation.peer_username}</span>
              <span className="ml-2 text-zinc-400">{conversation.last_message ?? "Sin mensajes"}</span>
            </Link>
          ))}
        </div>

        <div className="rounded-xl bg-velion-black/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Notificaciones recientes</p>
            <button
              type="button"
              className="text-[11px] text-zinc-400 transition hover:text-white disabled:opacity-50"
              disabled={markingAll || latestNotifications.length === 0}
              onClick={() => {
                setMarkingAll(true);
                setOptimisticReadIds((prev) => Array.from(new Set([...prev, ...latestNotifications.map((item) => item.id)])));
                void (async () => {
                  try {
                    await markAllNotificationsAsRead();
                  } finally {
                    setMarkingAll(false);
                  }
                })();
              }}
            >
              {markingAll ? "Marcando..." : "Marcar todas"}
            </button>
          </div>
          {latestNotifications.length === 0 && <p className="text-xs text-zinc-500">Sin notificaciones recientes.</p>}
          {latestNotifications.map((item) => {
            const isRead = Boolean(item.read_at) || optimisticReadIds.includes(item.id);

            return (
              <div
                key={item.id}
                className={`mb-1 flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs transition ${
                  isRead ? "bg-velion-black/20 text-zinc-400" : "text-zinc-200 hover:bg-velion-black/60"
                }`}
              >
                <Link to={getNotificationTarget(item.event_type, item.entity_id, item.actor?.username)} className="min-w-0">
                  <span className="font-semibold">{item.actor?.full_name ?? item.actor?.username ?? "Alguien"}</span>
                  <span className="ml-2 text-zinc-400">{formatRelativeDate(item.created_at)}</span>
                </Link>
                {!isRead && (
                  <button
                    type="button"
                    className="shrink-0 text-[11px] text-velion-fuchsia hover:text-white"
                    onClick={() => {
                      setOptimisticReadIds((prev) => [...prev, item.id]);
                      void markNotificationAsRead(item.id);
                    }}
                  >
                    Leida
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
