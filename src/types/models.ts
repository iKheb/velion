export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Profile {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  username: string;
  full_name: string;
  role?: "user" | "admin";
  is_banned?: boolean;
  is_premium?: boolean;
  premium_expires_at?: string | null;
  is_verified?: boolean;
  verified_expires_at?: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  bio: string | null;
  country: string | null;
  city: string | null;
  birth_date: string | null;
  relationship_status: string | null;
  external_links: Json | null;
  created_at: string;
}

export type ProfileBadgeSummary = Pick<Profile, "id" | "username" | "full_name" | "avatar_url" | "is_premium" | "is_verified">;

export interface SupportTicket {
  id: string;
  requester_id: string;
  subject: string;
  category: "account_access" | "technical_issue" | "billing" | "safety_report" | "other";
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
  description: string;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface SupportTicketMessage {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  sender_role: "user" | "agent" | "system";
  message: string;
  created_at: string;
  sender?: ProfileBadgeSummary | null;
}

export interface SocialPost {
  id: string;
  author_id: string;
  content: string;
  media_url: string | null;
  media_type: "image" | "video" | null;
  shared_target_type?: "post" | "reel" | "stream_vod" | "stream" | null;
  shared_target_id?: string | null;
  shared_target_available?: boolean;
  created_at: string;
  reactions_count: number;
  comments_count: number;
  shares_count: number;
  saved_count: number;
  liked_by_me?: boolean;
  shared_by_me?: boolean;
  saved_by_me?: boolean;
  profile?: Profile;
}

export interface Story {
  id: string;
  author_id: string;
  media_url: string;
  media_type: "image" | "video";
  description: string | null;
  created_at: string;
  expires_at: string;
  profile?: ProfileBadgeSummary;
}

export interface Reel {
  id: string;
  author_id: string;
  title: string | null;
  description?: string | null;
  video_url: string;
  thumbnail_url?: string | null;
  comments_count?: number;
  shares_count?: number;
  saves_count?: number;
  views_count?: number;
  created_at: string;
  likes_count: number;
  profile?: ProfileBadgeSummary;
  liked_by_me?: boolean;
  saved_by_me?: boolean;
}

export interface ReelComment {
  id: string;
  reel_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author?: ProfileBadgeSummary;
}

export interface Stream {
  id: string;
  streamer_id: string;
  title: string;
  category: string;
  is_live: boolean;
  viewer_count: number;
  stream_key_hint: string;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  recipient_id: string;
  actor_id: string;
  event_type: string;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
  actor?: ProfileBadgeSummary | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_type: "text" | "image" | "video" | "audio" | "link" | "post";
  content: string;
  attachment_url: string | null;
  attachment_mime_type?: string | null;
  attachment_size_bytes?: number | null;
  attachment_duration_ms?: number | null;
  client_idempotency_key?: string | null;
  edited_at?: string | null;
  delivery_status?: "sent" | "delivered" | "read" | null;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface ConversationSummary {
  conversation_id: string;
  peer_id: string;
  peer_name: string;
  peer_username: string;
  peer_avatar_url: string | null;
  peer_is_premium?: boolean;
  peer_is_verified?: boolean;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface ConversationReadState {
  user_id: string;
  last_read_at: string | null;
}

export interface PostComment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author?: ProfileBadgeSummary;
}

export interface LiveMessage {
  id: string;
  stream_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender_profile?: ProfileBadgeSummary | null;
}

export interface Clip {
  id: string;
  stream_id: string;
  author_id: string;
  title: string | null;
  clip_url: string;
  start_seconds?: number | null;
  end_seconds?: number | null;
  duration_seconds?: number | null;
  thumbnail_url?: string | null;
  views_count?: number;
  status?: "draft" | "published" | "hidden";
  created_at: string;
}

export interface StreamDonation {
  id: string;
  stream_id: string;
  sender_id: string;
  amount_cents: number;
  message: string | null;
  status: "pending" | "paid" | "refunded";
  created_at: string;
}

export interface StreamReport {
  id: string;
  stream_id: string;
  message_id: string | null;
  reporter_id: string;
  reported_user_id: string | null;
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  created_at: string;
}

export interface StreamDashboardSummary {
  streams_total: number;
  live_now: number;
  total_messages: number;
  total_clips: number;
  total_donations_cents: number;
  total_subscribers: number;
}

export interface StreamSchedule {
  id: string;
  streamer_id: string;
  title: string;
  category: string | null;
  description: string | null;
  scheduled_for: string;
  status: "scheduled" | "live" | "completed" | "canceled";
  created_at: string;
  updated_at: string;
}

export interface StreamScheduleReminder {
  id: string;
  schedule_id: string;
  user_id: string;
  created_at: string;
}

export interface StreamRaid {
  id: string;
  from_stream_id: string;
  to_stream_id: string;
  raider_id: string;
  message: string | null;
  created_at: string;
}

export interface StreamGoal {
  id: string;
  stream_id: string;
  owner_id: string;
  title: string;
  target_value: number;
  current_value: number;
  metric: "donation_cents" | "subscribers" | "likes" | "custom";
  status: "active" | "completed" | "canceled";
  created_at: string;
  updated_at: string;
}

export interface StreamPoll {
  id: string;
  stream_id: string;
  owner_id: string;
  question: string;
  options: string[];
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
}

export interface StreamPollVote {
  id: string;
  poll_id: string;
  user_id: string;
  option_index: number;
  created_at: string;
}

export interface StreamVod {
  id: string;
  stream_id: string | null;
  owner_id: string;
  title: string;
  description: string | null;
  vod_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  views_count: number;
  visibility: "public" | "unlisted" | "private";
  status: "processing" | "ready" | "failed";
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StreamVodReaction {
  id: string;
  vod_id: string;
  user_id: string;
  reaction: "like" | "dislike";
  created_at: string;
}

export interface StreamVodComment {
  id: string;
  vod_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author?: ProfileBadgeSummary;
}

export interface WalletBalance {
  user_id: string;
  balance_credits: number;
  updated_at: string;
}

export interface PaymentIntent {
  intent_id: string;
  provider: "stripe" | "mercado_pago";
  status: "created" | "pending" | "pending_webhook" | "retrying" | "requires_action" | "succeeded" | "canceled" | "failed";
  amount_minor: number;
  currency: "USD";
  package_credits: number;
  reused: boolean;
}

export interface PaymentIntentRecord {
  id: string;
  provider: "stripe" | "mercado_pago";
  status: "created" | "pending" | "pending_webhook" | "retrying" | "requires_action" | "succeeded" | "canceled" | "failed";
  amount_minor: number;
  currency: "USD";
  package_credits: number;
  error_message: string | null;
  created_at: string;
  settled_at: string | null;
  metadata: Json | null;
  retry_count?: number;
  last_retry_at?: string | null;
  next_retry_at?: string | null;
  last_webhook_received_at?: string | null;
}

export interface PremiumSubscription {
  id: string;
  user_id: string;
  status: "active" | "expired" | "canceled";
  starts_at: string;
  ends_at: string;
  auto_renew: boolean;
  price_credits: number;
  created_at: string;
}

export interface IdentityVerification {
  id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected";
  price_credits: number;
  created_at: string;
  reviewed_at: string | null;
}

export interface ContentPromotion {
  id: string;
  user_id: string;
  target_type: "post" | "stream" | "stream_vod";
  target_id: string;
  credits_spent: number;
  starts_at: string;
  ends_at: string;
  status: "active" | "completed" | "canceled";
  created_at: string;
}

export interface StreamVodShare {
  id: string;
  vod_id: string;
  user_id: string;
  created_at: string;
}

export interface StreamVodChapter {
  id: string;
  vod_id: string;
  title: string;
  start_seconds: number;
  created_at: string;
}

export type RestrictionMode = "everyone" | "friends" | "friends_except";
export type MentionRestrictionMode = "everyone" | "friends" | "nobody";
export type AccountContentContext = "posts" | "photos" | "videos" | "streams" | "stories" | "reels" | "relationship";
export type InteractionAction = "share" | "comment" | "save" | "like";
export type ProfileVisibilityField = "birth_date" | "city" | "country" | "relationship_status";

export interface VisibilityRule {
  mode: RestrictionMode;
  excluded_friend_ids: string[];
}

export interface AccountSettings {
  user_id: string;
  mention_permissions: Record<AccountContentContext, MentionRestrictionMode>;
  interaction_permissions: Record<AccountContentContext, Record<InteractionAction, boolean>>;
  content_visibility: Record<AccountContentContext, VisibilityRule>;
  discoverability: {
    searchable_profile: boolean;
  };
  profile_field_visibility: Record<ProfileVisibilityField, VisibilityRule>;
  created_at: string;
  updated_at: string;
}

