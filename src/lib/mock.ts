import type { ChatMessage, NotificationItem, Profile, Reel, SocialPost, Story, Stream } from "@/types/models";

export const mockProfile: Profile = {
  id: "demo-user",
  username: "velion_player",
  full_name: "Velion Player",
  avatar_url: "https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=200&q=80",
  banner_url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&q=80",
  bio: "Streamer y gamer competitivo en Velion.",
  country: "USA",
  city: "Austin",
  birth_date: "1999-05-14",
  relationship_status: "Soltero",
  external_links: { twitch: "https://twitch.tv" },
  created_at: new Date().toISOString(),
};

export const mockPosts: SocialPost[] = Array.from({ length: 8 }, (_, i) => ({
  id: `post-${i}`,
  author_id: "demo-user",
  content: `Clip destacado de la squad #${i + 1}. ¿Quién se apunta para ranked?`,
  media_url:
    i % 2 === 0
      ? "https://images.unsplash.com/photo-1542751110-97427bbecf20?w=1200&q=80"
      : "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=1200&q=80",
  media_type: "image",
  created_at: new Date(Date.now() - i * 3600_000).toISOString(),
  reactions_count: 20 + i * 3,
  comments_count: 5 + i,
  shares_count: 2 + i,
  saved_count: 3 + i,
  profile: mockProfile,
}));

export const mockStories: Story[] = Array.from({ length: 6 }, (_, i) => ({
  id: `story-${i}`,
  author_id: "demo-user",
  media_url: "https://images.unsplash.com/photo-1511882150382-421056c89033?w=800&q=80",
  media_type: "image",
  description: i % 2 === 0 ? "Historia de prueba con #nuevo y @velion_player" : null,
  created_at: new Date(Date.now() - i * 7200_000).toISOString(),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
}));

export const mockReels: Reel[] = Array.from({ length: 6 }, (_, i) => ({
  id: `reel-${i}`,
  author_id: "demo-user",
  title: `Play del día #${i + 1}`,
  description: "Highlights competitivos de la comunidad.",
  video_url: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  thumbnail_url: null,
  created_at: new Date(Date.now() - i * 4800_000).toISOString(),
  likes_count: 100 + i * 15,
  comments_count: 8 + i,
  shares_count: 4 + i,
  views_count: 300 + i * 22,
}));

export const mockStreams: Stream[] = [
  {
    id: "stream-1",
    streamer_id: "demo-user",
    title: "Ranked Night - Immortal Push",
    category: "FPS",
    is_live: true,
    viewer_count: 128,
    stream_key_hint: "vl_live_xxxx",
    created_at: new Date().toISOString(),
  },
  {
    id: "stream-2",
    streamer_id: "demo-user",
    title: "Co-op con la comunidad",
    category: "Survival",
    is_live: false,
    viewer_count: 0,
    stream_key_hint: "vl_live_yyyy",
    created_at: new Date().toISOString(),
  },
];

export const mockNotifications: NotificationItem[] = Array.from({ length: 5 }, (_, i) => ({
  id: `notif-${i}`,
  recipient_id: "demo-user",
  actor_id: "friend-1",
  event_type: ["like", "comment", "follow", "friend_request", "live"][i],
  entity_id: `post-${i}`,
  read_at: null,
  created_at: new Date(Date.now() - i * 3600_000).toISOString(),
}));

export const mockMessages: ChatMessage[] = Array.from({ length: 8 }, (_, i) => ({
  id: `msg-${i}`,
  conversation_id: "conv-1",
  sender_id: i % 2 ? "friend-1" : "demo-user",
  message_type: "text" as const,
  content: i % 2 ? "¿Entramos a duo?" : "Dale, 10 minutos y voy.",
  attachment_url: null,
  created_at: new Date(Date.now() - i * 120_000).toISOString(),
})).reverse();

