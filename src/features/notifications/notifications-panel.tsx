import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/data-state";
import { getProfileRoute } from "@/lib/constants";
import { formatRelativeDate } from "@/lib/date";
import { toAppError } from "@/services/error.service";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeNotificationsChanges,
} from "@/services/notifications.service";
import { acceptFriendRequest, declineFriendRequest } from "@/services/relations.service";
import { useAppStore } from "@/store/app.store";
import { toast } from "@/store/toast.store";

const getEventLabel = (eventType: string): string => {
  switch (eventType) {
    case "friend_request":
      return "te envio una solicitud de amistad";
    case "friend_accept":
      return "acepto tu solicitud de amistad";
    case "follow":
      return "empezo a seguirte";
    case "subscription":
      return "se suscribio a tu perfil";
    case "like":
      return "reacciono a tu publicacion";
    case "comment":
      return "comento tu publicacion";
    case "live":
      return "inicio un directo";
    case "raid":
      return "hizo un raid hacia tu stream";
    case "stream_schedule":
      return "programo un nuevo directo";
    case "stream_vod":
      return "subio un nuevo video";
    default:
      return eventType;
  }
};

const getNotificationTarget = (item: {
  event_type: string;
  entity_id: string | null;
  actor?: { username?: string | null } | null;
}): string | null => {
  if (item.event_type === "live" && item.entity_id) {
    return `/streaming/${item.entity_id}`;
  }
  if (item.event_type === "raid" && item.entity_id) {
    return `/streaming/${item.entity_id}`;
  }
  if (item.event_type === "stream_vod" && item.entity_id) {
    return `/streaming/video/${item.entity_id}`;
  }

  if (["friend_request", "friend_accept", "follow", "subscription"].includes(item.event_type) && item.actor?.username) {
    return getProfileRoute(item.actor.username);
  }

  return null;
};

export function NotificationsPanel() {
  const profile = useAppStore((state) => state.profile);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [optimisticReadIds, setOptimisticReadIds] = useState<string[]>([]);
  const [acceptingIds, setAcceptingIds] = useState<string[]>([]);
  const [decliningIds, setDecliningIds] = useState<string[]>([]);
  const [markingAll, setMarkingAll] = useState(false);
  const [openMarkAllModal, setOpenMarkAllModal] = useState(false);

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
  });

  useEffect(() => {
    if (!profile?.id) return;
    return subscribeNotificationsChanges(profile.id, () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
  }, [profile?.id, queryClient]);

  const realtimeItems = notificationsQuery.data ?? [];

  const hasUnread = realtimeItems.some((item) => !item.read_at && !optimisticReadIds.includes(item.id));
  const unreadCount = realtimeItems.filter((item) => !item.read_at && !optimisticReadIds.includes(item.id)).length;
  const displayedItems =
    filter === "unread"
      ? realtimeItems.filter((item) => !item.read_at && !optimisticReadIds.includes(item.id))
      : realtimeItems;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Notificaciones</h3>
        <button
          type="button"
          className="text-xs text-zinc-400 transition hover:text-white disabled:opacity-50"
          disabled={markingAll || !hasUnread}
          onClick={() => {
            if (markingAll || !hasUnread) return;
            setOpenMarkAllModal(true);
          }}
        >
          {markingAll ? "Marcando..." : "Marcar todas"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`rounded-lg px-2 py-1 text-xs transition ${
            filter === "all" ? "bg-velion-fuchsia/30 text-white" : "bg-velion-black/40 text-zinc-300 hover:bg-velion-black/60"
          }`}
          onClick={() => setFilter("all")}
        >
          Todas
        </button>
        <button
          type="button"
          className={`rounded-lg px-2 py-1 text-xs transition ${
            filter === "unread"
              ? "bg-velion-fuchsia/30 text-white"
              : "bg-velion-black/40 text-zinc-300 hover:bg-velion-black/60"
          }`}
          onClick={() => setFilter("unread")}
        >
          No leidas {unreadCount > 0 ? `(${unreadCount})` : ""}
        </button>
      </div>
      <div className="space-y-2">
        {notificationsQuery.isLoading && <ListSkeleton rows={4} />}
        {notificationsQuery.error && (
          <ErrorState title="No se pudieron cargar notificaciones" description={toAppError(notificationsQuery.error)} />
        )}
        {!notificationsQuery.isLoading && !notificationsQuery.error && displayedItems.length === 0 && (
          <EmptyState
            title={filter === "unread" ? "No tienes notificaciones pendientes" : "No hay notificaciones por ahora"}
            description="Te avisaremos aqui cuando haya actividad relevante."
          />
        )}

        {!notificationsQuery.isLoading &&
          !notificationsQuery.error &&
          displayedItems.map((item) => {
            const isRead = Boolean(item.read_at) || optimisticReadIds.includes(item.id);
            const actorName = item.actor?.full_name ?? item.actor?.username ?? "Alguien";
            const canAcceptFriendRequest = item.event_type === "friend_request" && Boolean(item.entity_id);
            const isAccepting = acceptingIds.includes(item.id);
            const isDeclining = decliningIds.includes(item.id);
            const target = getNotificationTarget(item);

            return (
              <article key={item.id} className={`rounded-xl p-3 text-sm ${isRead ? "bg-velion-black/20" : "bg-velion-black/50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">
                    {actorName} {getEventLabel(item.event_type)}
                  </p>
                  <div className="flex items-center gap-3">
                    {canAcceptFriendRequest && (
                      <>
                        <button
                          className="text-xs text-emerald-400 disabled:opacity-50"
                          disabled={isAccepting || isDeclining || isRead}
                          onClick={() => {
                            if (!item.entity_id) return;
                            setAcceptingIds((prev) => [...prev, item.id]);
                            setOptimisticReadIds((prev) => [...prev, item.id]);
                            void (async () => {
                              try {
                                await acceptFriendRequest(item.entity_id as string);
                                await markNotificationAsRead(item.id);
                                toast.success("Solicitud aceptada");
                              } catch (err) {
                                toast.error("No se pudo aceptar la solicitud", toAppError(err));
                              } finally {
                                setAcceptingIds((prev) => prev.filter((id) => id !== item.id));
                              }
                            })();
                          }}
                        >
                          {isAccepting ? "Aceptando..." : "Aceptar"}
                        </button>
                        <button
                          className="text-xs text-rose-400 disabled:opacity-50"
                          disabled={isAccepting || isDeclining || isRead}
                          onClick={() => {
                            if (!item.entity_id) return;
                            setDecliningIds((prev) => [...prev, item.id]);
                            setOptimisticReadIds((prev) => [...prev, item.id]);
                            void (async () => {
                              try {
                                await declineFriendRequest(item.entity_id as string);
                                await markNotificationAsRead(item.id);
                                toast.success("Solicitud declinada");
                              } catch (err) {
                                toast.error("No se pudo declinar la solicitud", toAppError(err));
                              } finally {
                                setDecliningIds((prev) => prev.filter((id) => id !== item.id));
                              }
                            })();
                          }}
                        >
                          {isDeclining ? "Declinando..." : "Declinar"}
                        </button>
                      </>
                    )}
                    {target && (
                      <button
                        className="text-xs text-sky-400"
                        onClick={() => {
                          if (!isRead) {
                            setOptimisticReadIds((prev) => [...prev, item.id]);
                            void markNotificationAsRead(item.id).catch((err) => {
                              toast.error("No se pudo marcar como leida", toAppError(err));
                            });
                          }
                          navigate(target);
                        }}
                      >
                        Ver
                      </button>
                    )}
                    {!isRead && (
                      <button
                        className="text-xs text-velion-fuchsia"
                        onClick={() => {
                          setOptimisticReadIds((prev) => [...prev, item.id]);
                          void markNotificationAsRead(item.id).catch((err) => {
                            toast.error("No se pudo marcar como leida", toAppError(err));
                          });
                        }}
                      >
                        Marcar leida
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-zinc-400">{formatRelativeDate(item.created_at)}</p>
              </article>
            );
          })}
      </div>

      <ConfirmModal
        open={openMarkAllModal}
        title="Marcar todas como leidas"
        description="Todas las notificaciones pendientes pasarán a estado leido."
        confirmLabel="Marcar todo"
        loading={markingAll}
        onClose={() => setOpenMarkAllModal(false)}
        onConfirm={() => {
          setMarkingAll(true);
          const unreadIds = realtimeItems.filter((item) => !item.read_at).map((item) => item.id);
          setOptimisticReadIds((prev) => Array.from(new Set([...prev, ...unreadIds])));
          void (async () => {
            try {
              await markAllNotificationsAsRead();
              toast.success("Notificaciones actualizadas");
            } catch (err) {
              toast.error("No se pudieron actualizar notificaciones", toAppError(err));
            } finally {
              setMarkingAll(false);
              setOpenMarkAllModal(false);
            }
          })();
        }}
      />
    </Card>
  );
}
