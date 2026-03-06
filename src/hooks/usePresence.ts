import { useEffect } from "react";
import { setPresenceOffline, setPresenceOnline } from "@/services/presence.service";
import { hasSupabaseConfig, supabase } from "@/services/supabase";

export const usePresence = () => {
  useEffect(() => {
    const markOnline = () => void setPresenceOnline();
    const markOffline = () => void setPresenceOffline();

    markOnline();

    const handleVisibility = () => {
      if (document.hidden) {
        markOffline();
      } else {
        markOnline();
      }
    };

    const heartbeat = window.setInterval(() => {
      if (!document.hidden) {
        markOnline();
      }
    }, 30000);

    const authSubscription = hasSupabaseConfig
      ? supabase.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT") {
            markOffline();
            return;
          }
          markOnline();
        }).data.subscription
      : null;

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", markOffline);
    window.addEventListener("pagehide", markOffline);

    return () => {
      window.clearInterval(heartbeat);
      authSubscription?.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", markOffline);
      window.removeEventListener("pagehide", markOffline);
      markOffline();
    };
  }, []);
};
