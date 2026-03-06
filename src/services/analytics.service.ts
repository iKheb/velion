import { hasSupabaseConfig, supabase } from "@/services/supabase";

let lastTrackedPath: string | null = null;

export const trackEvent = async (eventName: string, payload: Record<string, unknown> = {}): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  const { error } = await supabase.from("analytics_events").insert({
    user_id: userId,
    event_name: eventName,
    payload,
  });

  if (error) {
    console.error("Analytics error", error.message);
  }
};

export const trackEventFireAndForget = (eventName: string, payload: Record<string, unknown> = {}): void => {
  void trackEvent(eventName, payload);
};

export const trackPageView = (pathname: string): void => {
  if (!pathname || pathname === lastTrackedPath) return;
  lastTrackedPath = pathname;
  trackEventFireAndForget("page_view", { path: pathname });
};
