export const ROUTES = {
  login: "/login",
  resetPassword: "/reset-password",
  terms: "/terms",
  privacy: "/privacy",
  home: "/",
  reels: "/reels",
  stories: "/stories",
  streaming: "/streaming",
  streamingStudio: "/streaming/studio",
  store: "/tienda",
  channel: "/streaming/:id",
  streamVideo: "/streaming/video/:id",
  messages: "/messages",
  notifications: "/notifications",
  support: "/support",
  accountSettings: "/settings/account",
  profile: "/profile/:username",
  admin: "/admin",
} as const;

export const BUCKETS = ["avatars", "banners", "posts", "reels", "stories", "chat", "clips"] as const;

export const getProfileRoute = (username: string): string => {
  const normalized = username.replace(/^@+/, "").trim();
  return `/profile/${encodeURIComponent(normalized)}`;
};
