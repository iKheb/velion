import { Home, Film, Tv, MessagesSquare, Bell, User, Sparkles, LayoutDashboard, Settings, LogOut, LifeBuoy, Store } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { isFeatureEnabled } from "@/config/feature-flags";
import { getProfileRoute, ROUTES } from "@/lib/constants";
import { formatRelativeDate } from "@/lib/date";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";
import { useUnreadNotificationsCount } from "@/hooks/useUnreadNotificationsCount";
import { useUnreadMessagesCount } from "@/hooks/useUnreadMessagesCount";
import { getMyWalletBalance } from "@/services/monetization.service";
import { signOut } from "@/services/auth.service";
import { toAppError } from "@/services/error.service";
import { markAllNotificationsAsRead, markNotificationAsRead } from "@/services/notifications.service";
import { useAppStore } from "@/store/app.store";

export function AppSidebar() {
  const navigate = useNavigate();
  const unreadNotifications = useUnreadNotificationsCount();
  const unreadMessages = useUnreadMessagesCount();
  const realtimeNotifications = useRealtimeNotifications();
  const profile = useAppStore((state) => state.profile);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsFilter, setNotificationsFilter] = useState<"all" | "unread">("all");
  const [optimisticReadIds, setOptimisticReadIds] = useState<string[]>([]);
  const [markingAll, setMarkingAll] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const notificationsPanelRef = useRef<HTMLDivElement | null>(null);
  const streamsEnabled = isFeatureEnabled("streamsEnabled");
  const walletEnabled = isFeatureEnabled("walletEnabled");
  const supportEnabled = isFeatureEnabled("supportEnabled");
  const walletQuery = useQuery({
    queryKey: ["wallet-balance"],
    queryFn: getMyWalletBalance,
    enabled: walletEnabled,
  });

  const unreadRealtimeCount = useMemo(
    () => realtimeNotifications.filter((item) => !item.read_at && !optimisticReadIds.includes(item.id)).length,
    [optimisticReadIds, realtimeNotifications],
  );

  const displayedNotifications = useMemo(
    () =>
      notificationsFilter === "unread"
        ? realtimeNotifications.filter((item) => !item.read_at && !optimisticReadIds.includes(item.id))
        : realtimeNotifications,
    [notificationsFilter, optimisticReadIds, realtimeNotifications],
  );

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
  }): string => {
    if (item.event_type === "live" && item.entity_id) return `/streaming/${item.entity_id}`;
    if (item.event_type === "raid" && item.entity_id) return `/streaming/${item.entity_id}`;
    if (item.event_type === "stream_vod" && item.entity_id) return `/streaming/video/${item.entity_id}`;
    if (["friend_request", "friend_accept", "follow", "subscription"].includes(item.event_type) && item.actor?.username) {
      return getProfileRoute(item.actor.username);
    }
    return "/notifications";
  };

  useEffect(() => {
    if (!notificationsOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!notificationsPanelRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [notificationsOpen]);

  const navItems = [
    { to: ROUTES.home, icon: Home, label: "Inicio", end: true },
    { to: ROUTES.reels, icon: Film, label: "Reels", end: true },
    ...(streamsEnabled
      ? [
          { to: ROUTES.streaming, icon: Tv, label: "Streaming", end: true },
          { to: ROUTES.streamingStudio, icon: LayoutDashboard, label: "Studio", end: true },
        ]
      : []),
    { to: ROUTES.messages, icon: MessagesSquare, label: "Mensajes", end: true },
    ...(walletEnabled ? [{ to: ROUTES.store, icon: Store, label: "Tienda", end: true }] : []),
    { to: getProfileRoute(profile?.username ?? "me"), icon: User, label: "Perfil", end: true },
  ];

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setLogoutError(null);
    try {
      await signOut();
      navigate(ROUTES.login, { replace: true });
    } catch (error) {
      setLogoutError(toAppError(error));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-72 overflow-visible border-r border-velion-steel/70 bg-velion-discord/70 p-4 lg:flex lg:flex-col">
      <div ref={notificationsPanelRef} className="relative mb-6 rounded-xl bg-velion-black/70 p-3 shadow-glow">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="text-velion-fuchsia" />
            <div>
              <p className="font-bold">Velion</p>
              <p className="text-xs text-zinc-400">Social + Streaming</p>
            </div>
          </div>
          <button
            type="button"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-velion-black/60 text-zinc-200 transition hover:bg-velion-black"
            aria-label="Abrir notificaciones"
            onClick={() => setNotificationsOpen((prev) => !prev)}
          >
            <Bell size={18} />
            {unreadRealtimeCount > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {unreadRealtimeCount > 99 ? "99+" : unreadRealtimeCount}
              </span>
            )}
          </button>
        </div>

        {notificationsOpen && (
          <div className="absolute left-0 top-full z-[80] mt-2 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-velion-steel/80 bg-velion-discord/95 p-3 shadow-2xl backdrop-blur">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-zinc-100">Notificaciones</p>
              <button
                type="button"
                className="text-xs text-zinc-400 transition hover:text-white disabled:opacity-50"
                disabled={markingAll || unreadRealtimeCount === 0}
                onClick={() => {
                  if (markingAll || unreadRealtimeCount === 0) return;
                  setMarkingAll(true);
                  const unreadIds = realtimeNotifications.filter((item) => !item.read_at).map((item) => item.id);
                  setOptimisticReadIds((prev) => Array.from(new Set([...prev, ...unreadIds])));
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

            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  "rounded-lg px-2 py-1 text-xs transition",
                  notificationsFilter === "all" ? "bg-velion-fuchsia/30 text-white" : "bg-velion-black/40 text-zinc-300 hover:bg-velion-black/60",
                )}
                onClick={() => setNotificationsFilter("all")}
              >
                Todas
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-lg px-2 py-1 text-xs transition",
                  notificationsFilter === "unread"
                    ? "bg-velion-fuchsia/30 text-white"
                    : "bg-velion-black/40 text-zinc-300 hover:bg-velion-black/60",
                )}
                onClick={() => setNotificationsFilter("unread")}
              >
                No leidas {unreadRealtimeCount > 0 ? `(${unreadRealtimeCount})` : ""}
              </button>
            </div>

            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {displayedNotifications.length === 0 && (
                <p className="rounded-xl bg-velion-black/30 p-3 text-xs text-zinc-400">No hay notificaciones por ahora.</p>
              )}
              {displayedNotifications.map((item) => {
                const isRead = Boolean(item.read_at) || optimisticReadIds.includes(item.id);
                const actorName = item.actor?.full_name ?? item.actor?.username ?? "Alguien";
                const target = getNotificationTarget(item);

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "w-full rounded-xl p-3 text-left transition",
                      isRead ? "bg-velion-black/20 text-zinc-300 hover:bg-velion-black/35" : "bg-velion-black/55 text-zinc-100 hover:bg-velion-black/70",
                    )}
                    onClick={() => {
                      if (!isRead) {
                        setOptimisticReadIds((prev) => [...prev, item.id]);
                        void markNotificationAsRead(item.id);
                      }
                      setNotificationsOpen(false);
                      navigate(target);
                    }}
                  >
                    <p className="text-sm">
                      <span className="font-semibold">{actorName}</span> {getEventLabel(item.event_type)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">{formatRelativeDate(item.created_at)}</p>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="mt-2 w-full rounded-lg bg-velion-black/50 py-2 text-xs font-medium text-zinc-200 transition hover:bg-velion-black/70"
              onClick={() => {
                setNotificationsOpen(false);
                navigate("/notifications");
              }}
            >
              Ver todas las notificaciones
            </button>
          </div>
        )}
      </div>
      <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {walletEnabled && (
          <div className="mb-2 flex items-center justify-between rounded-xl bg-velion-black/35 px-3 py-2 text-xs text-zinc-300">
            <span>Creditos</span>
            <span className="font-semibold text-zinc-100">{walletQuery.data?.balance_credits ?? 0}</span>
          </div>
        )}
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition",
                isActive ? "bg-velion-fuchsia/20 text-white" : "text-zinc-300 hover:bg-velion-black/60",
              )
            }
          >
            <item.icon size={18} />
            <span>{item.label}</span>
            {item.to === "/messages" && unreadMessages > 0 && (
              <span className="ml-auto rounded-full bg-cyan-500 px-2 py-0.5 text-[10px] font-semibold leading-none text-white">
                {unreadMessages > 99 ? "99+" : unreadMessages}
              </span>
            )}
            {item.to === "/notifications" && unreadNotifications > 0 && (
              <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold leading-none text-white">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-velion-steel/50 pt-3">
        {logoutError && <p className="mb-2 text-xs text-red-400">{logoutError}</p>}
        <div className="flex items-center gap-2">
          {supportEnabled && (
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-velion-black/50 text-zinc-200 transition hover:bg-velion-black/70"
              aria-label="Centro de soporte"
              title="Centro de soporte"
              onClick={() => navigate(ROUTES.support)}
            >
              <LifeBuoy size={16} />
            </button>
          )}
          <button
            type="button"
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600/85 px-3 text-sm font-medium text-white transition hover:bg-rose-600 disabled:opacity-60"
            onClick={() => void handleLogout()}
            disabled={signingOut}
          >
            <LogOut size={16} />
            <span>{signingOut ? "Cerrando..." : "Cerrar sesion"}</span>
          </button>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-velion-black/50 text-zinc-200 transition hover:bg-velion-black/70"
            aria-label="Configuracion de cuenta"
            title="Configuracion de cuenta"
            onClick={() => navigate(ROUTES.accountSettings)}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
