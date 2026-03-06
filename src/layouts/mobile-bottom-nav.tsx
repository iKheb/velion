import { Home, Film, Tv, MessagesSquare, Bell, User } from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";
import { getProfileRoute } from "@/lib/constants";
import { isFeatureEnabled } from "@/config/feature-flags";
import { useUnreadNotificationsCount } from "@/hooks/useUnreadNotificationsCount";
import { useUnreadMessagesCount } from "@/hooks/useUnreadMessagesCount";
import { useAppStore } from "@/store/app.store";

export function MobileBottomNav() {
  const unreadNotifications = useUnreadNotificationsCount();
  const unreadMessages = useUnreadMessagesCount();
  const profile = useAppStore((state) => state.profile);

  const streamsEnabled = isFeatureEnabled("streamsEnabled");
  const items = [
    { to: "/", icon: Home, label: "Inicio" },
    { to: "/reels", icon: Film, label: "Reels" },
    ...(streamsEnabled ? [{ to: "/streaming", icon: Tv, label: "Live" }] : []),
    { to: "/messages", icon: MessagesSquare, label: "Chats" },
    { to: "/notifications", icon: Bell, label: "Avisos" },
    { to: getProfileRoute(profile?.username ?? "me"), icon: User, label: "Perfil" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-velion-steel bg-velion-discord/95 p-2 lg:hidden">
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "relative grid place-items-center rounded-lg py-2 text-xs text-zinc-300",
                isActive && "bg-velion-fuchsia/20 text-white",
              )
            }
          >
            <item.icon size={16} />
            {item.label}
            {item.to === "/messages" && unreadMessages > 0 && (
              <span className="absolute right-1 top-1 rounded-full bg-cyan-500 px-1.5 text-[9px] font-semibold leading-4 text-white">
                {unreadMessages > 99 ? "99+" : unreadMessages}
              </span>
            )}
            {item.to === "/notifications" && unreadNotifications > 0 && (
              <span className="absolute right-1 top-1 rounded-full bg-rose-500 px-1.5 text-[9px] font-semibold leading-4 text-white">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
