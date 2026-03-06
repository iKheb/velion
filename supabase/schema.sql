-- Velion schema for Supabase SQL Editor
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  username text unique not null check (char_length(username) between 2 and 32),
  full_name text not null,
  avatar_url text,
  banner_url text,
  bio text,
  country text,
  city text,
  birth_date date,
  relationship_status text,
  external_links jsonb,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists is_banned boolean not null default false;

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id)
);

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.profiles(id) on delete cascade,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'canceled')),
  created_at timestamptz not null default now(),
  unique (subscriber_id, creator_id)
);

create table if not exists public.profile_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  media_url text,
  media_type text check (media_type in ('image', 'video')),
  shared_target_type text,
  shared_target_id uuid,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'posts_shared_target_type_check'
  ) then
    alter table public.posts
      add constraint posts_shared_target_type_check
      check (
        shared_target_type is null
        or shared_target_type in ('post', 'reel', 'stream_vod', 'stream')
      );
  end if;
end;
$$;

-- Account settings phase: privacy, restrictions, permissions, and secure self-delete
create table if not exists public.account_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mention_permissions jsonb not null default jsonb_build_object(
    'posts', 'everyone',
    'photos', 'everyone',
    'videos', 'everyone',
    'streams', 'everyone',
    'stories', 'everyone',
    'reels', 'everyone',
    'relationship', 'everyone'
  ),
  interaction_permissions jsonb not null default jsonb_build_object(
    'posts', jsonb_build_object('share', true, 'comment', true, 'save', true, 'like', true),
    'photos', jsonb_build_object('share', true, 'comment', true, 'save', true, 'like', true),
    'videos', jsonb_build_object('share', true, 'comment', true, 'save', true, 'like', true),
    'streams', jsonb_build_object('share', true, 'comment', true, 'save', true, 'like', true),
    'stories', jsonb_build_object('share', true, 'comment', true, 'save', true, 'like', true),
    'reels', jsonb_build_object('share', true, 'comment', true, 'save', true, 'like', true),
    'relationship', jsonb_build_object('share', true, 'comment', true, 'save', true, 'like', true)
  ),
  content_visibility jsonb not null default jsonb_build_object(
    'posts', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb),
    'photos', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb),
    'videos', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb),
    'streams', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb),
    'stories', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb),
    'reels', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb),
    'relationship', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb)
  ),
  discoverability jsonb not null default jsonb_build_object('searchable_profile', true),
  profile_field_visibility jsonb not null default jsonb_build_object(
    'birth_date', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb),
    'city', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb),
    'country', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb),
    'relationship_status', jsonb_build_object('mode', 'everyone', 'excluded_friend_ids', '[]'::jsonb)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_settings enable row level security;

drop policy if exists "account settings own read" on public.account_settings;
drop policy if exists "account settings own write" on public.account_settings;
drop policy if exists "account settings authenticated read" on public.account_settings;

create policy "account settings own read" on public.account_settings
for select using (auth.uid() = user_id);

create policy "account settings own write" on public.account_settings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "account settings authenticated read" on public.account_settings
for select using (auth.role() = 'authenticated' or auth.role() = 'service_role');

grant select on public.account_settings to authenticated, service_role;
grant insert, update on public.account_settings to authenticated;

insert into public.account_settings (user_id)
select p.id
from public.profiles p
where not exists (
  select 1
  from public.account_settings s
  where s.user_id = p.id
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, username, full_name, country, city, birth_date)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    split_part(new.email, '@', 1),
    coalesce(new.raw_user_meta_data ->> 'full_name', 'Velion User'),
    nullif(new.raw_user_meta_data ->> 'country', ''),
    nullif(new.raw_user_meta_data ->> 'city', ''),
    case
      when coalesce(new.raw_user_meta_data ->> 'birth_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (new.raw_user_meta_data ->> 'birth_date')::date
      else null
    end
  )
  on conflict (id) do nothing;

  insert into public.account_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from auth.users where id = caller_id;
  return true;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

create or replace function public.block_profile_user(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_user_id is null then
    raise exception 'Invalid target profile';
  end if;
  if target_user_id = caller_id then
    raise exception 'You cannot block your own profile';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = target_user_id
      and coalesce(p.is_banned, false) = false
  ) then
    raise exception 'Profile not found';
  end if;

  insert into public.profile_blocks (blocker_id, blocked_id, created_at)
  values (caller_id, target_user_id, now())
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.subscriptions
  where (subscriber_id = caller_id and creator_id = target_user_id)
     or (subscriber_id = target_user_id and creator_id = caller_id);

  delete from public.follows
  where (follower_id = caller_id and following_id = target_user_id)
     or (follower_id = target_user_id and following_id = caller_id);

  delete from public.friendships
  where (requester_id = caller_id and addressee_id = target_user_id)
     or (requester_id = target_user_id and addressee_id = caller_id);

  return true;
end;
$$;

create or replace function public.unblock_profile_user(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_user_id is null then
    raise exception 'Invalid target profile';
  end if;

  delete from public.profile_blocks
  where blocker_id = caller_id
    and blocked_id = target_user_id;

  return true;
end;
$$;

create table if not exists public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

create table if not exists public.shared_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  description text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  video_url text not null,
  likes_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text,
  is_live boolean not null default false,
  viewer_count integer not null default 0,
  stream_key_hint text,
  created_at timestamptz not null default now()
);

create table if not exists public.live_messages (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  clip_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  message_type text not null default 'text' check (message_type in ('text', 'emoji', 'image', 'video', 'audio', 'link', 'post')),
  content text not null,
  attachment_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  is_typing boolean not null default false,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

do $$
begin
  -- Normalize historical values before enforcing the constraint.
  update public.reports
  set target_type = case lower(trim(target_type))
    when 'profile' then 'profile'
    when 'profiles' then 'profile'
    when 'post' then 'post'
    when 'posts' then 'post'
    when 'video' then 'video'
    when 'videos' then 'video'
    when 'stream_vod' then 'video'
    when 'vod' then 'video'
    when 'vods' then 'video'
    when 'story' then 'story'
    when 'stories' then 'story'
    when 'reel' then 'reel'
    when 'reels' then 'reel'
    when 'rells' then 'reel'
    when 'stream' then 'stream'
    when 'streams' then 'stream'
    else target_type
  end
  where target_type is not null;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'reports_target_type_check'
  ) then
    alter table public.reports
      add constraint reports_target_type_check
      check (target_type in ('profile', 'post', 'video', 'story', 'reel', 'stream'));
  end if;
end;
$$;

create table if not exists public.analytics_events (
  id bigint generated by default as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  event_name text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text unique not null,
  message text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  metadata jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_alert_sync_runs (
  id uuid primary key default gen_random_uuid(),
  range_days integer not null check (range_days in (1, 7, 30)),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  alerts_detected integer,
  alerts_upserted integer,
  alerts_resolved integer,
  result jsonb,
  error_message text,
  triggered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

create or replace function public.is_conversation_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.user_id = auth.uid()
  );
$$;

create index if not exists idx_posts_author_created on public.posts(author_id, created_at desc);
create index if not exists idx_posts_shared_target on public.posts(shared_target_type, shared_target_id);
create index if not exists idx_profile_blocks_blocker_created on public.profile_blocks(blocker_id, created_at desc);
create index if not exists idx_notifications_recipient_created on public.notifications(recipient_id, created_at desc);
create index if not exists idx_messages_conversation_created on public.messages(conversation_id, created_at);
create index if not exists idx_streams_live on public.streams(is_live, created_at desc);
create index if not exists idx_reports_status_target_created on public.reports(status, target_type, created_at desc);
create index if not exists idx_analytics_created_at on public.analytics_events(created_at desc);
create index if not exists idx_analytics_event_created_at on public.analytics_events(event_name, created_at desc);
create index if not exists idx_admin_alerts_status_last_seen on public.admin_alerts(status, last_seen_at desc);
create index if not exists idx_admin_alert_sync_runs_created_at on public.admin_alert_sync_runs(created_at desc);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke select on tables from anon;

grant select on public.profiles to anon;
grant select on public.posts to anon;
grant select on public.post_reactions to anon;
grant select on public.comments to anon;
grant select on public.follows to anon;
grant select on public.subscriptions to anon;
grant select on public.stories to anon;
grant select on public.reels to anon;
grant select on public.streams to anon;
grant select on public.live_messages to anon;
grant select on public.clips to anon;
grant select on public.stream_donations to anon;
grant select on public.clip_reactions to anon;
grant select on public.stream_schedules to anon;
grant select on public.stream_raids to anon;
grant select on public.reel_reactions to anon;
grant select on public.reel_comments to anon;
grant select on public.reel_shares to anon;
grant select on public.reel_saves to anon;
grant select on public.stream_vods to anon;
grant select on public.stream_vod_chapters to anon;
grant select on public.stream_vod_reactions to anon;
grant select on public.stream_vod_comments to anon;
grant select on public.stream_vod_shares to anon;
grant select on public.stream_goals to anon;
grant select on public.stream_goal_contributions to anon;
grant select on public.stream_polls to anon;
grant select on public.stream_poll_votes to anon;

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.follows enable row level security;
alter table public.subscriptions enable row level security;
alter table public.profile_blocks enable row level security;
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.comments enable row level security;
alter table public.saved_posts enable row level security;
alter table public.shared_posts enable row level security;
alter table public.stories enable row level security;
alter table public.reels enable row level security;
alter table public.streams enable row level security;
alter table public.live_messages enable row level security;
alter table public.clips enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.presence enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.analytics_events enable row level security;
alter table public.admin_alerts enable row level security;
alter table public.admin_alert_sync_runs enable row level security;

drop policy if exists "profiles read all" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
drop policy if exists "profiles admin update all" on public.profiles;

drop policy if exists "friendships members" on public.friendships;
drop policy if exists "friendships create" on public.friendships;
drop policy if exists "friendships update addressee" on public.friendships;
drop policy if exists "friendships delete member" on public.friendships;

drop policy if exists "follows read all" on public.follows;
drop policy if exists "follows create own" on public.follows;
drop policy if exists "follows delete own" on public.follows;

drop policy if exists "subscriptions read all" on public.subscriptions;
drop policy if exists "subscriptions create own" on public.subscriptions;
drop policy if exists "subscriptions update own" on public.subscriptions;
drop policy if exists "subscriptions delete own" on public.subscriptions;

drop policy if exists "profile blocks own read" on public.profile_blocks;
drop policy if exists "profile blocks own write" on public.profile_blocks;

drop policy if exists "posts read all" on public.posts;
drop policy if exists "posts create own" on public.posts;
drop policy if exists "posts update own" on public.posts;
drop policy if exists "posts delete own" on public.posts;
drop policy if exists "posts admin delete" on public.posts;

drop policy if exists "post_reactions read all" on public.post_reactions;
drop policy if exists "post_reactions own" on public.post_reactions;

drop policy if exists "comments read all" on public.comments;
drop policy if exists "comments own" on public.comments;

drop policy if exists "saved_posts own" on public.saved_posts;
drop policy if exists "shared_posts own" on public.shared_posts;

drop policy if exists "stories read active" on public.stories;
drop policy if exists "stories own create" on public.stories;
drop policy if exists "stories own manage" on public.stories;
drop policy if exists "stories own delete" on public.stories;
drop policy if exists "stories admin delete" on public.stories;

drop policy if exists "reels read all" on public.reels;
drop policy if exists "reels own manage" on public.reels;
drop policy if exists "reels admin delete" on public.reels;

drop policy if exists "streams read all" on public.streams;
drop policy if exists "streams own manage" on public.streams;
drop policy if exists "streams admin delete" on public.streams;

drop policy if exists "live_messages read all" on public.live_messages;
drop policy if exists "live_messages create own" on public.live_messages;

drop policy if exists "clips read all" on public.clips;
drop policy if exists "clips own manage" on public.clips;

drop policy if exists "conversation read member" on public.conversations;
drop policy if exists "conversation member manage" on public.conversation_members;
drop policy if exists "conversation member read conversation" on public.conversation_members;
drop policy if exists "conversation member own write" on public.conversation_members;
drop policy if exists "messages read member" on public.messages;
drop policy if exists "messages create member" on public.messages;

drop policy if exists "presence read all" on public.presence;
drop policy if exists "presence own manage" on public.presence;

drop policy if exists "notifications read own" on public.notifications;
drop policy if exists "notifications update own" on public.notifications;
drop policy if exists "notifications insert actor" on public.notifications;

drop policy if exists "reports create own" on public.reports;
drop policy if exists "reports read own_or_admin" on public.reports;
drop policy if exists "reports admin update" on public.reports;

drop policy if exists "analytics insert" on public.analytics_events;
drop policy if exists "analytics admin read" on public.analytics_events;
drop policy if exists "admin_alerts admin read" on public.admin_alerts;
drop policy if exists "admin_alerts admin upsert" on public.admin_alerts;
drop policy if exists "admin_alerts admin update" on public.admin_alerts;
drop policy if exists "admin_alert_sync_runs admin read" on public.admin_alert_sync_runs;
drop policy if exists "admin_alert_sync_runs admin write" on public.admin_alert_sync_runs;

create policy "profiles read all" on public.profiles for select using (
  auth.uid() is null
  or public.is_admin()
  or not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = auth.uid() and pb.blocked_id = profiles.id)
       or (pb.blocker_id = profiles.id and pb.blocked_id = auth.uid())
  )
);
create policy "profiles update own" on public.profiles for update using (auth.uid() = id);
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles admin update all" on public.profiles for update using (public.is_admin()) with check (public.is_admin());

create policy "friendships members" on public.friendships for select using (auth.uid() in (requester_id, addressee_id));
create policy "friendships create" on public.friendships for insert with check (
  auth.uid() = requester_id
  and not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = requester_id and pb.blocked_id = addressee_id)
       or (pb.blocker_id = addressee_id and pb.blocked_id = requester_id)
  )
);
create policy "friendships update addressee" on public.friendships for update using (auth.uid() = addressee_id);
create policy "friendships delete member" on public.friendships for delete using (auth.uid() in (requester_id, addressee_id));

create policy "follows read all" on public.follows for select using (
  auth.uid() is null
  or public.is_admin()
  or not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = auth.uid() and pb.blocked_id in (follows.follower_id, follows.following_id))
       or (pb.blocked_id = auth.uid() and pb.blocker_id in (follows.follower_id, follows.following_id))
  )
);
create policy "follows create own" on public.follows for insert with check (
  auth.uid() = follower_id
  and not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = follower_id and pb.blocked_id = following_id)
       or (pb.blocker_id = following_id and pb.blocked_id = follower_id)
  )
);
create policy "follows delete own" on public.follows for delete using (auth.uid() = follower_id);

create policy "subscriptions read all" on public.subscriptions for select using (
  auth.uid() is null
  or public.is_admin()
  or not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = auth.uid() and pb.blocked_id in (subscriptions.subscriber_id, subscriptions.creator_id))
       or (pb.blocked_id = auth.uid() and pb.blocker_id in (subscriptions.subscriber_id, subscriptions.creator_id))
  )
);
create policy "subscriptions create own" on public.subscriptions for insert with check (
  auth.uid() = subscriber_id
  and not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = subscriber_id and pb.blocked_id = creator_id)
       or (pb.blocker_id = creator_id and pb.blocked_id = subscriber_id)
  )
);
create policy "subscriptions update own" on public.subscriptions for update using (auth.uid() = subscriber_id);
create policy "subscriptions delete own" on public.subscriptions for delete using (auth.uid() = subscriber_id);

create policy "profile blocks own read" on public.profile_blocks for select using (auth.uid() = blocker_id);
create policy "profile blocks own write" on public.profile_blocks for all
using (auth.uid() = blocker_id)
with check (auth.uid() = blocker_id);

create policy "posts read all" on public.posts for select using (
  not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = auth.uid() and pb.blocked_id = author_id)
       or (pb.blocker_id = author_id and pb.blocked_id = auth.uid())
  )
);
create policy "posts create own" on public.posts for insert with check (auth.uid() = author_id);
create policy "posts update own" on public.posts for update using (auth.uid() = author_id);
create policy "posts delete own" on public.posts for delete using (auth.uid() = author_id);
create policy "posts admin delete" on public.posts for delete using (public.is_admin());

create policy "post_reactions read all" on public.post_reactions for select using (true);
create policy "post_reactions own" on public.post_reactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "comments read all" on public.comments for select using (true);
create policy "comments own" on public.comments for all using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy "saved_posts own" on public.saved_posts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "shared_posts own" on public.shared_posts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "stories read active" on public.stories for select using (
  expires_at > now()
  and not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = auth.uid() and pb.blocked_id = author_id)
       or (pb.blocker_id = author_id and pb.blocked_id = auth.uid())
  )
);
create policy "stories own create" on public.stories for insert with check (auth.uid() = author_id);
create policy "stories own manage" on public.stories for update using (auth.uid() = author_id);
create policy "stories own delete" on public.stories for delete using (auth.uid() = author_id);
create policy "stories admin delete" on public.stories for delete using (public.is_admin());

create policy "reels read all" on public.reels for select using (
  not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = auth.uid() and pb.blocked_id = author_id)
       or (pb.blocker_id = author_id and pb.blocked_id = auth.uid())
  )
);
create policy "reels own manage" on public.reels for all using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy "reels admin delete" on public.reels for delete using (public.is_admin());

create policy "streams read all" on public.streams for select using (
  not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = auth.uid() and pb.blocked_id = streamer_id)
       or (pb.blocker_id = streamer_id and pb.blocked_id = auth.uid())
  )
);
create policy "streams own manage" on public.streams for all using (auth.uid() = streamer_id) with check (auth.uid() = streamer_id);
create policy "streams admin delete" on public.streams for delete using (public.is_admin());

create policy "live_messages read all" on public.live_messages for select using (true);
create policy "live_messages create own" on public.live_messages for insert with check (
  auth.uid() = sender_id
  and not exists (
    select 1
    from public.streams s
    join public.profile_blocks pb
      on (pb.blocker_id = sender_id and pb.blocked_id = s.streamer_id)
      or (pb.blocker_id = s.streamer_id and pb.blocked_id = sender_id)
    where s.id = live_messages.stream_id
  )
);

create policy "clips read all" on public.clips for select using (true);
create policy "clips own manage" on public.clips for all using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy "conversation read member" on public.conversations for select using (
  public.is_conversation_member(conversations.id)
);

create policy "conversation member read conversation" on public.conversation_members for select using (
  public.is_conversation_member(conversation_members.conversation_id)
);

create policy "conversation member own write" on public.conversation_members for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "messages read member" on public.messages for select using (
  public.is_conversation_member(messages.conversation_id)
);

create policy "messages create member" on public.messages for insert with check (
  auth.uid() = sender_id and public.is_conversation_member(messages.conversation_id)
);

create policy "presence read all" on public.presence for select using (true);
create policy "presence own manage" on public.presence for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notifications read own" on public.notifications for select using (auth.uid() = recipient_id);
create policy "notifications update own" on public.notifications for update using (auth.uid() = recipient_id);
create policy "notifications insert actor" on public.notifications for insert with check (auth.uid() = actor_id);

create policy "reports create own" on public.reports for insert with check (auth.uid() = reporter_id);
create policy "reports read own_or_admin" on public.reports for select using (
  auth.uid() = reporter_id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "reports admin update" on public.reports for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

create policy "analytics insert" on public.analytics_events for insert with check (auth.uid() = user_id or user_id is null);
create policy "analytics admin read" on public.analytics_events for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "admin_alerts admin read" on public.admin_alerts for select using (public.is_admin());
create policy "admin_alerts admin upsert" on public.admin_alerts for insert with check (public.is_admin());
create policy "admin_alerts admin update" on public.admin_alerts for update using (public.is_admin()) with check (public.is_admin());
create policy "admin_alert_sync_runs admin read" on public.admin_alert_sync_runs for select using (public.is_admin());
create policy "admin_alert_sync_runs admin write" on public.admin_alert_sync_runs for all using (public.is_admin()) with check (public.is_admin());

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('banners', 'banners', true),
  ('posts', 'posts', true),
  ('reels', 'reels', true),
  ('stories', 'stories', true),
  ('chat', 'chat', false),
  ('clips', 'clips', true)
on conflict (id) do nothing;

drop policy if exists "avatars public read" on storage.objects;
drop policy if exists "avatars own write" on storage.objects;
drop policy if exists "avatars own update" on storage.objects;
drop policy if exists "banners public read" on storage.objects;
drop policy if exists "banners own write" on storage.objects;
drop policy if exists "banners own update" on storage.objects;
drop policy if exists "posts public read" on storage.objects;
drop policy if exists "posts own write" on storage.objects;
drop policy if exists "posts own update" on storage.objects;
drop policy if exists "reels public read" on storage.objects;
drop policy if exists "reels own write" on storage.objects;
drop policy if exists "reels own update" on storage.objects;
drop policy if exists "stories public read" on storage.objects;
drop policy if exists "stories own write" on storage.objects;
drop policy if exists "stories own update" on storage.objects;
drop policy if exists "chat member write" on storage.objects;
drop policy if exists "chat member update" on storage.objects;
drop policy if exists "chat member read" on storage.objects;
drop policy if exists "clips public read" on storage.objects;
drop policy if exists "clips own write" on storage.objects;
drop policy if exists "clips own update" on storage.objects;

create policy "avatars public read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars own write" on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "avatars own update" on storage.objects for update using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]) with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "banners public read" on storage.objects for select using (bucket_id = 'banners');
create policy "banners own write" on storage.objects for insert with check (bucket_id = 'banners' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "banners own update" on storage.objects for update using (bucket_id = 'banners' and auth.uid()::text = (storage.foldername(name))[1]) with check (bucket_id = 'banners' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "posts public read" on storage.objects for select using (bucket_id = 'posts');
create policy "posts own write" on storage.objects for insert with check (bucket_id = 'posts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "posts own update" on storage.objects for update using (bucket_id = 'posts' and auth.uid()::text = (storage.foldername(name))[1]) with check (bucket_id = 'posts' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "reels public read" on storage.objects for select using (bucket_id = 'reels');
create policy "reels own write" on storage.objects for insert with check (bucket_id = 'reels' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "reels own update" on storage.objects for update using (bucket_id = 'reels' and auth.uid()::text = (storage.foldername(name))[1]) with check (bucket_id = 'reels' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "stories public read" on storage.objects for select using (bucket_id = 'stories');
create policy "stories own write" on storage.objects for insert with check (bucket_id = 'stories' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "stories own update" on storage.objects for update using (bucket_id = 'stories' and auth.uid()::text = (storage.foldername(name))[1]) with check (bucket_id = 'stories' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "chat member write" on storage.objects for insert with check (
  bucket_id = 'chat'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
  and split_part(name, '/', 2) <> ''
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id::text = split_part(name, '/', 2)
      and cm.user_id = auth.uid()
  )
);
create policy "chat member update" on storage.objects for update
using (
  bucket_id = 'chat'
  and auth.uid() is not null
  and split_part(name, '/', 2) <> ''
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id::text = split_part(name, '/', 2)
      and cm.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'chat'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
  and split_part(name, '/', 2) <> ''
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id::text = split_part(name, '/', 2)
      and cm.user_id = auth.uid()
  )
);
create policy "chat member read" on storage.objects for select using (
  bucket_id = 'chat'
  and auth.uid() is not null
  and split_part(name, '/', 2) <> ''
  and exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id::text = split_part(name, '/', 2)
      and cm.user_id = auth.uid()
  )
);
create policy "clips public read" on storage.objects for select using (bucket_id = 'clips');
create policy "clips own write" on storage.objects for insert with check (bucket_id = 'clips' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "clips own update" on storage.objects for update using (bucket_id = 'clips' and auth.uid()::text = (storage.foldername(name))[1]) with check (bucket_id = 'clips' and auth.uid()::text = (storage.foldername(name))[1]);

create or replace function public.sync_admin_alerts(range_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_days integer := case when range_days in (1, 7, 30) then range_days else 7 end;
  caller_id uuid := auth.uid();
  run_id uuid;
  now_ts timestamptz := now();
  current_start timestamptz := now_ts - make_interval(days => normalized_days);
  previous_start timestamptz := now_ts - make_interval(days => normalized_days * 2);
  current_total integer := 0;
  previous_total integer := 0;
  current_anonymous integer := 0;
  page_view_current integer := 0;
  page_view_previous integer := 0;
  total_delta numeric := null;
  page_view_delta numeric := null;
  anonymous_ratio numeric := 0;
  alert_messages text[] := array[]::text[];
  alert_keys text[] := array[]::text[];
  alert_message text;
  alert_key text;
  upserted_count integer := 0;
  resolved_count integer := 0;
  result_payload jsonb;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'Forbidden';
  end if;

  insert into public.admin_alert_sync_runs (range_days, started_at, status, triggered_by, created_at)
  values (normalized_days, now_ts, 'running', caller_id, now_ts)
  returning id into run_id;

  select count(*) into current_total
  from public.analytics_events
  where created_at >= current_start;

  select count(*) into previous_total
  from public.analytics_events
  where created_at >= previous_start and created_at < current_start;

  select count(*) into current_anonymous
  from public.analytics_events
  where created_at >= current_start and user_id is null;

  select count(*) into page_view_current
  from public.analytics_events
  where created_at >= current_start and event_name = 'page_view';

  select count(*) into page_view_previous
  from public.analytics_events
  where created_at >= previous_start and created_at < current_start and event_name = 'page_view';

  if previous_total > 0 then
    total_delta := ((current_total - previous_total)::numeric / previous_total::numeric) * 100;
  end if;

  if page_view_previous > 0 then
    page_view_delta := ((page_view_current - page_view_previous)::numeric / page_view_previous::numeric) * 100;
  end if;

  if current_total > 0 then
    anonymous_ratio := current_anonymous::numeric / current_total::numeric;
  end if;

  if previous_total >= 50 and total_delta is not null and total_delta < -40 then
    alert_messages := array_append(alert_messages, 'Caida fuerte de eventos totales frente al periodo anterior.');
  end if;

  if page_view_previous >= 30 and page_view_delta is not null and page_view_delta < -50 then
    alert_messages := array_append(alert_messages, 'Caida fuerte de page_view; posible problema de adquisicion o tracking.');
  end if;

  if current_total >= 50 and anonymous_ratio > 0.7 then
    alert_messages := array_append(alert_messages, 'Proporcion alta de eventos anonimos; revisar sesiones/autenticacion.');
  end if;

  foreach alert_message in array alert_messages loop
    alert_key := normalized_days::text || ':' || regexp_replace(lower(alert_message), '[^a-z0-9]+', '_', 'g');
    alert_key := regexp_replace(alert_key, '_+$', '', 'g');
    alert_keys := array_append(alert_keys, alert_key);

    insert into public.admin_alerts (alert_key, message, severity, status, metadata, first_seen_at, last_seen_at, created_at, updated_at)
    values (
      alert_key,
      alert_message,
      'warning',
      'open',
      jsonb_build_object('range_days', normalized_days),
      now_ts,
      now_ts,
      now_ts,
      now_ts
    )
    on conflict (alert_key) do update
      set message = excluded.message,
          severity = excluded.severity,
          status = 'open',
          last_seen_at = now_ts,
          updated_at = now_ts,
          metadata = excluded.metadata;

    upserted_count := upserted_count + 1;
  end loop;

  update public.admin_alerts
  set status = 'resolved',
      updated_at = now_ts
  where alert_key like normalized_days::text || ':%'
    and status in ('open', 'acknowledged')
    and not (alert_key = any(alert_keys));

  get diagnostics resolved_count = row_count;

  result_payload := jsonb_build_object(
    'range_days', normalized_days,
    'alerts_detected', coalesce(array_length(alert_messages, 1), 0),
    'alerts_upserted', upserted_count,
    'alerts_resolved', resolved_count
  );

  update public.admin_alert_sync_runs
  set finished_at = now_ts,
      status = 'success',
      alerts_detected = coalesce(array_length(alert_messages, 1), 0),
      alerts_upserted = upserted_count,
      alerts_resolved = resolved_count,
      result = result_payload
  where id = run_id;

  return result_payload;
exception
  when others then
    if run_id is not null then
      update public.admin_alert_sync_runs
      set finished_at = now(),
          status = 'error',
          error_message = left(sqlerrm, 1000),
          result = jsonb_build_object('range_days', normalized_days)
      where id = run_id;
    end if;
    raise;
end;
$$;

create or replace function public.sync_report_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  alerts_detected integer := 0;
  alerts_upserted integer := 0;
  alerts_resolved integer := 0;
  stale_open_count integer := 0;
  total_open_count integer := 0;
  alert_keys text[] := array[]::text[];
  alert_key text;
  alert_message text;
  report_row record;
  result_payload jsonb;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'Forbidden';
  end if;

  select count(*) into total_open_count
  from public.reports
  where status = 'open';

  for report_row in
    select target_type, count(*)::integer as open_count
    from public.reports
    where status = 'open'
      and created_at >= now_ts - interval '24 hours'
    group by target_type
  loop
    if report_row.open_count >= 5 then
      alert_key := 'reports:open_spike:' || report_row.target_type;
      alert_message := 'Aumento de reportes abiertos en ' || report_row.target_type || ' en las ultimas 24h.';
      alert_keys := array_append(alert_keys, alert_key);

      insert into public.admin_alerts (alert_key, message, severity, status, metadata, first_seen_at, last_seen_at, created_at, updated_at)
      values (
        alert_key,
        alert_message,
        'warning',
        'open',
        jsonb_build_object('source', 'reports', 'target_type', report_row.target_type, 'window_hours', 24, 'open_count', report_row.open_count),
        now_ts,
        now_ts,
        now_ts,
        now_ts
      )
      on conflict (alert_key) do update
        set message = excluded.message,
            severity = excluded.severity,
            status = 'open',
            metadata = excluded.metadata,
            last_seen_at = now_ts,
            updated_at = now_ts;

      alerts_detected := alerts_detected + 1;
      alerts_upserted := alerts_upserted + 1;
    end if;
  end loop;

  select count(*) into stale_open_count
  from public.reports
  where status = 'open'
    and created_at < now_ts - interval '48 hours';

  if stale_open_count > 0 then
    alert_key := 'reports:stale_open';
    alert_message := 'Existen reportes abiertos con mas de 48 horas sin resolver.';
    alert_keys := array_append(alert_keys, alert_key);

    insert into public.admin_alerts (alert_key, message, severity, status, metadata, first_seen_at, last_seen_at, created_at, updated_at)
    values (
      alert_key,
      alert_message,
      'warning',
      'open',
      jsonb_build_object('source', 'reports', 'threshold_hours', 48, 'stale_open_count', stale_open_count),
      now_ts,
      now_ts,
      now_ts,
      now_ts
    )
    on conflict (alert_key) do update
      set message = excluded.message,
          severity = excluded.severity,
          status = 'open',
          metadata = excluded.metadata,
          last_seen_at = now_ts,
          updated_at = now_ts;

    alerts_detected := alerts_detected + 1;
    alerts_upserted := alerts_upserted + 1;
  end if;

  update public.admin_alerts
  set status = 'resolved',
      updated_at = now_ts
  where alert_key like 'reports:%'
    and status in ('open', 'acknowledged')
    and not (alert_key = any(alert_keys));

  get diagnostics alerts_resolved = row_count;

  result_payload := jsonb_build_object(
    'alerts_detected', alerts_detected,
    'alerts_upserted', alerts_upserted,
    'alerts_resolved', alerts_resolved,
    'open_reports_total', total_open_count,
    'stale_open_reports', stale_open_count
  );

  return result_payload;
end;
$$;

create or replace function public.create_dm_conversation(peer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_conversation_id uuid;
  new_conversation_id uuid;
begin
  if current_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if peer_id is null or peer_id = current_user_id then
    raise exception 'Invalid peer';
  end if;

  select cm1.conversation_id
    into existing_conversation_id
  from public.conversation_members cm1
  join public.conversation_members cm2
    on cm1.conversation_id = cm2.conversation_id
  where cm1.user_id = current_user_id
    and cm2.user_id = peer_id
    and (
      select count(*)
      from public.conversation_members cm_count
      where cm_count.conversation_id = cm1.conversation_id
    ) = 2
  limit 1;

  if existing_conversation_id is not null then
    return existing_conversation_id;
  end if;

  insert into public.conversations default values returning id into new_conversation_id;

  insert into public.conversation_members (conversation_id, user_id)
  values (new_conversation_id, current_user_id), (new_conversation_id, peer_id);

  return new_conversation_id;
end;
$$;

grant execute on function public.create_dm_conversation(uuid) to authenticated;
grant execute on function public.sync_admin_alerts(integer) to authenticated;
grant execute on function public.sync_report_alerts() to authenticated;
grant execute on function public.is_conversation_member(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_members'
  ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'streams'
  ) then
    alter publication supabase_realtime add table public.streams;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_messages'
  ) then
    alter publication supabase_realtime add table public.live_messages;
  end if;
end;
$$;


-- Streaming phases 1-6: moderation, monetization, advanced clips, dashboard support
create table if not exists public.stream_moderators (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'moderator' check (role in ('moderator')),
  created_at timestamptz not null default now(),
  unique (stream_id, user_id)
);

create table if not exists public.stream_bans (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  banned_by uuid not null references public.profiles(id) on delete cascade,
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (stream_id, user_id)
);

create table if not exists public.stream_reports (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  message_id uuid references public.live_messages(id) on delete set null,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists public.stream_donations (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  message text,
  status text not null default 'paid' check (status in ('pending', 'paid', 'refunded')),
  created_at timestamptz not null default now()
);

alter table public.clips add column if not exists start_seconds integer check (start_seconds is null or start_seconds >= 0);
alter table public.clips add column if not exists end_seconds integer check (end_seconds is null or end_seconds >= 0);
alter table public.clips add column if not exists duration_seconds integer check (duration_seconds is null or duration_seconds >= 0);
alter table public.clips add column if not exists thumbnail_url text;
alter table public.clips add column if not exists views_count integer not null default 0;
alter table public.clips add column if not exists status text not null default 'published' check (status in ('draft', 'published', 'hidden'));

create table if not exists public.clip_reactions (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like')),
  created_at timestamptz not null default now(),
  unique (clip_id, user_id)
);

create or replace function public.can_moderate_stream(target_stream_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.streams s
    where s.id = target_stream_id
      and s.streamer_id = auth.uid()
  )
  or exists (
    select 1
    from public.stream_moderators sm
    where sm.stream_id = target_stream_id
      and sm.user_id = auth.uid()
  )
  or public.is_admin();
$$;

create or replace function public.is_stream_banned(target_stream_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stream_bans sb
    where sb.stream_id = target_stream_id
      and sb.user_id = auth.uid()
      and (sb.expires_at is null or sb.expires_at > now())
  );
$$;

create index if not exists idx_stream_mods_stream on public.stream_moderators(stream_id, user_id);
create index if not exists idx_stream_bans_stream_user on public.stream_bans(stream_id, user_id);
create index if not exists idx_stream_reports_stream_created on public.stream_reports(stream_id, created_at desc);
create index if not exists idx_stream_donations_stream_created on public.stream_donations(stream_id, created_at desc);
create index if not exists idx_clip_reactions_clip on public.clip_reactions(clip_id, created_at desc);

alter table public.stream_moderators enable row level security;
alter table public.stream_bans enable row level security;
alter table public.stream_reports enable row level security;
alter table public.stream_donations enable row level security;
alter table public.clip_reactions enable row level security;

drop policy if exists "stream moderators read" on public.stream_moderators;
drop policy if exists "stream moderators manage" on public.stream_moderators;
drop policy if exists "stream bans read" on public.stream_bans;
drop policy if exists "stream bans manage" on public.stream_bans;
drop policy if exists "stream reports create" on public.stream_reports;
drop policy if exists "stream reports read moderators" on public.stream_reports;
drop policy if exists "stream reports update moderators" on public.stream_reports;
drop policy if exists "stream donations read" on public.stream_donations;
drop policy if exists "stream donations create" on public.stream_donations;
drop policy if exists "clip reactions read" on public.clip_reactions;
drop policy if exists "clip reactions own" on public.clip_reactions;
drop policy if exists "live_messages create own" on public.live_messages;

create policy "stream moderators read" on public.stream_moderators for select using (true);
create policy "stream moderators manage" on public.stream_moderators for all
using (public.can_moderate_stream(stream_id))
with check (public.can_moderate_stream(stream_id));

create policy "stream bans read" on public.stream_bans for select using (public.can_moderate_stream(stream_id) or auth.uid() = user_id);
create policy "stream bans manage" on public.stream_bans for all
using (public.can_moderate_stream(stream_id))
with check (public.can_moderate_stream(stream_id));

create policy "stream reports create" on public.stream_reports for insert with check (auth.uid() = reporter_id);
create policy "stream reports read moderators" on public.stream_reports for select using (public.can_moderate_stream(stream_id));
create policy "stream reports update moderators" on public.stream_reports for update using (public.can_moderate_stream(stream_id));

create policy "stream donations read" on public.stream_donations for select using (true);
create policy "stream donations create" on public.stream_donations for insert with check (auth.uid() = sender_id);

create policy "clip reactions read" on public.clip_reactions for select using (true);
create policy "clip reactions own" on public.clip_reactions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "live_messages create own" on public.live_messages for insert with check (
  auth.uid() = sender_id
  and not exists (
    select 1
    from public.streams s
    join public.profile_blocks pb
      on (pb.blocker_id = sender_id and pb.blocked_id = s.streamer_id)
      or (pb.blocker_id = s.streamer_id and pb.blocked_id = sender_id)
    where s.id = live_messages.stream_id
  )
  and not public.is_stream_banned(live_messages.stream_id)
);

grant execute on function public.can_moderate_stream(uuid) to authenticated;
grant execute on function public.is_stream_banned(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stream_donations'
  ) then
    alter publication supabase_realtime add table public.stream_donations;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clip_reactions'
  ) then
    alter publication supabase_realtime add table public.clip_reactions;
  end if;
end;
$$;

-- Streaming next phase: scheduling, reminders, raids
create table if not exists public.stream_schedules (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text,
  description text,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'completed', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stream_schedule_reminders (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.stream_schedules(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (schedule_id, user_id)
);

create table if not exists public.stream_raids (
  id uuid primary key default gen_random_uuid(),
  from_stream_id uuid not null references public.streams(id) on delete cascade,
  to_stream_id uuid not null references public.streams(id) on delete cascade,
  raider_id uuid not null references public.profiles(id) on delete cascade,
  message text,
  created_at timestamptz not null default now(),
  check (from_stream_id <> to_stream_id)
);

create index if not exists idx_stream_schedules_for on public.stream_schedules(scheduled_for desc);
create index if not exists idx_stream_schedule_reminders_schedule on public.stream_schedule_reminders(schedule_id, user_id);
create index if not exists idx_stream_raids_to_stream on public.stream_raids(to_stream_id, created_at desc);

alter table public.stream_schedules enable row level security;
alter table public.stream_schedule_reminders enable row level security;
alter table public.stream_raids enable row level security;

drop policy if exists "stream schedules read" on public.stream_schedules;
drop policy if exists "stream schedules own manage" on public.stream_schedules;
drop policy if exists "stream reminders read" on public.stream_schedule_reminders;
drop policy if exists "stream reminders own" on public.stream_schedule_reminders;
drop policy if exists "stream raids read" on public.stream_raids;
drop policy if exists "stream raids create" on public.stream_raids;

create policy "stream schedules read" on public.stream_schedules for select using (true);
create policy "stream schedules own manage" on public.stream_schedules for all
using (auth.uid() = streamer_id)
with check (auth.uid() = streamer_id);

create policy "stream reminders read" on public.stream_schedule_reminders for select using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.stream_schedules ss
    where ss.id = stream_schedule_reminders.schedule_id
      and ss.streamer_id = auth.uid()
  )
);
create policy "stream reminders own" on public.stream_schedule_reminders for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "stream raids read" on public.stream_raids for select using (true);
create policy "stream raids create" on public.stream_raids for insert with check (
  auth.uid() = raider_id
  and public.can_moderate_stream(from_stream_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stream_schedules'
  ) then
    alter publication supabase_realtime add table public.stream_schedules;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stream_raids'
  ) then
    alter publication supabase_realtime add table public.stream_raids;
  end if;
end;
$$;

-- Reels full phase: metadata, interactions, metrics
alter table public.reels add column if not exists description text;
alter table public.reels add column if not exists thumbnail_url text;
alter table public.reels add column if not exists comments_count integer not null default 0 check (comments_count >= 0);
alter table public.reels add column if not exists shares_count integer not null default 0 check (shares_count >= 0);
alter table public.reels add column if not exists saves_count integer not null default 0 check (saves_count >= 0);
alter table public.reels add column if not exists views_count integer not null default 0 check (views_count >= 0);
alter table public.reels add column if not exists updated_at timestamptz not null default now();

create table if not exists public.reel_reactions (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like' check (reaction in ('like')),
  created_at timestamptz not null default now(),
  unique (reel_id, user_id)
);

create table if not exists public.reel_comments (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reel_shares (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (reel_id, user_id)
);

create table if not exists public.reel_saves (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (reel_id, user_id)
);

create table if not exists public.reel_views (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (reel_id, user_id)
);

create index if not exists idx_reels_author_created on public.reels(author_id, created_at desc);
create index if not exists idx_reel_reactions_reel_created on public.reel_reactions(reel_id, created_at desc);
create index if not exists idx_reel_comments_reel_created on public.reel_comments(reel_id, created_at desc);
create index if not exists idx_reel_shares_reel_created on public.reel_shares(reel_id, created_at desc);
create index if not exists idx_reel_saves_reel_created on public.reel_saves(reel_id, created_at desc);
create index if not exists idx_reel_views_reel_created on public.reel_views(reel_id, created_at desc);

alter table public.reel_reactions enable row level security;
alter table public.reel_comments enable row level security;
alter table public.reel_shares enable row level security;
alter table public.reel_saves enable row level security;
alter table public.reel_views enable row level security;

drop policy if exists "reel reactions read all" on public.reel_reactions;
drop policy if exists "reel reactions own" on public.reel_reactions;
drop policy if exists "reel comments read all" on public.reel_comments;
drop policy if exists "reel comments own manage" on public.reel_comments;
drop policy if exists "reel shares read all" on public.reel_shares;
drop policy if exists "reel shares own" on public.reel_shares;
drop policy if exists "reel saves read all" on public.reel_saves;
drop policy if exists "reel saves own" on public.reel_saves;
drop policy if exists "reel views own insert" on public.reel_views;

create policy "reel reactions read all" on public.reel_reactions for select using (true);
create policy "reel reactions own" on public.reel_reactions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "reel comments read all" on public.reel_comments for select using (true);
create policy "reel comments own manage" on public.reel_comments for all
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

create policy "reel shares read all" on public.reel_shares for select using (true);
create policy "reel shares own" on public.reel_shares for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "reel saves read all" on public.reel_saves for select using (true);
create policy "reel saves own" on public.reel_saves for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "reel views own insert" on public.reel_views for insert
with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reel_comments'
  ) then
    alter publication supabase_realtime add table public.reel_comments;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reel_reactions'
  ) then
    alter publication supabase_realtime add table public.reel_reactions;
  end if;
end;
$$;

-- Streaming next phase: VOD archive + chapters
create table if not exists public.stream_vods (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid references public.streams(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  vod_url text not null,
  thumbnail_url text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  views_count integer not null default 0 check (views_count >= 0),
  visibility text not null default 'public' check (visibility in ('public', 'unlisted', 'private')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stream_vods_description_max_300'
  ) then
    alter table public.stream_vods
      add constraint stream_vods_description_max_300
      check (description is null or char_length(description) <= 300);
  end if;
end;
$$;

create table if not exists public.stream_vod_chapters (
  id uuid primary key default gen_random_uuid(),
  vod_id uuid not null references public.stream_vods(id) on delete cascade,
  title text not null,
  start_seconds integer not null check (start_seconds >= 0),
  created_at timestamptz not null default now(),
  unique (vod_id, start_seconds)
);

create table if not exists public.stream_vod_reactions (
  id uuid primary key default gen_random_uuid(),
  vod_id uuid not null references public.stream_vods(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  unique (vod_id, user_id)
);

create table if not exists public.stream_vod_comments (
  id uuid primary key default gen_random_uuid(),
  vod_id uuid not null references public.stream_vods(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.stream_vod_shares (
  id uuid primary key default gen_random_uuid(),
  vod_id uuid not null references public.stream_vods(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (vod_id, user_id)
);

create index if not exists idx_stream_vods_owner_created on public.stream_vods(owner_id, created_at desc);
create index if not exists idx_stream_vods_visibility_published on public.stream_vods(visibility, published_at desc);
create index if not exists idx_stream_vod_chapters_vod_start on public.stream_vod_chapters(vod_id, start_seconds);
create index if not exists idx_stream_vod_reactions_vod on public.stream_vod_reactions(vod_id, created_at desc);
create index if not exists idx_stream_vod_comments_vod on public.stream_vod_comments(vod_id, created_at desc);
create index if not exists idx_stream_vod_shares_vod on public.stream_vod_shares(vod_id, created_at desc);

alter table public.stream_vods enable row level security;
alter table public.stream_vod_chapters enable row level security;
alter table public.stream_vod_reactions enable row level security;
alter table public.stream_vod_comments enable row level security;
alter table public.stream_vod_shares enable row level security;

drop policy if exists "stream vods read" on public.stream_vods;
drop policy if exists "stream vods own manage" on public.stream_vods;
drop policy if exists "stream vods admin delete" on public.stream_vods;
drop policy if exists "stream vod chapters read" on public.stream_vod_chapters;
drop policy if exists "stream vod chapters own manage" on public.stream_vod_chapters;
drop policy if exists "stream vod reactions read" on public.stream_vod_reactions;
drop policy if exists "stream vod reactions own" on public.stream_vod_reactions;
drop policy if exists "stream vod comments read" on public.stream_vod_comments;
drop policy if exists "stream vod comments own" on public.stream_vod_comments;
drop policy if exists "stream vod shares read" on public.stream_vod_shares;
drop policy if exists "stream vod shares own" on public.stream_vod_shares;

create policy "stream vods read" on public.stream_vods for select using (
  (
    visibility in ('public', 'unlisted')
    and status = 'ready'
  )
  and not exists (
    select 1
    from public.profile_blocks pb
    where (pb.blocker_id = auth.uid() and pb.blocked_id = owner_id)
       or (pb.blocker_id = owner_id and pb.blocked_id = auth.uid())
  )
  or auth.uid() = owner_id
  or public.is_admin()
);

create policy "stream vods own manage" on public.stream_vods for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);
create policy "stream vods admin delete" on public.stream_vods for delete using (public.is_admin());

create policy "stream vod chapters read" on public.stream_vod_chapters for select using (
  exists (
    select 1
    from public.stream_vods v
    where v.id = stream_vod_chapters.vod_id
      and (
        (v.visibility in ('public', 'unlisted') and v.status = 'ready')
        or v.owner_id = auth.uid()
        or public.is_admin()
      )
  )
);

create policy "stream vod chapters own manage" on public.stream_vod_chapters for all
using (
  exists (
    select 1
    from public.stream_vods v
    where v.id = stream_vod_chapters.vod_id
      and v.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.stream_vods v
    where v.id = stream_vod_chapters.vod_id
      and v.owner_id = auth.uid()
  )
);

create policy "stream vod reactions read" on public.stream_vod_reactions for select using (true);
create policy "stream vod reactions own" on public.stream_vod_reactions for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "stream vod comments read" on public.stream_vod_comments for select using (true);
create policy "stream vod comments own" on public.stream_vod_comments for all
using (auth.uid() = author_id)
with check (auth.uid() = author_id);

create policy "stream vod shares read" on public.stream_vod_shares for select using (true);
create policy "stream vod shares own" on public.stream_vod_shares for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stream_vods'
  ) then
    alter publication supabase_realtime add table public.stream_vods;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stream_vod_chapters'
  ) then
    alter publication supabase_realtime add table public.stream_vod_chapters;
  end if;
end;
$$;

-- Streaming next phase: engagement (goals + polls)
create table if not exists public.stream_goals (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  target_value integer not null check (target_value > 0),
  current_value integer not null default 0 check (current_value >= 0),
  metric text not null default 'donation_cents' check (metric in ('donation_cents', 'subscribers', 'likes', 'custom')),
  status text not null default 'active' check (status in ('active', 'completed', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stream_goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.stream_goals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.stream_polls (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.streams(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  question text not null,
  options jsonb not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.stream_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.stream_polls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option_index integer not null check (option_index >= 0),
  created_at timestamptz not null default now(),
  unique (poll_id, user_id)
);

create index if not exists idx_stream_goals_stream on public.stream_goals(stream_id, status, created_at desc);
create index if not exists idx_stream_goal_contrib_goal on public.stream_goal_contributions(goal_id, created_at desc);
create index if not exists idx_stream_polls_stream on public.stream_polls(stream_id, created_at desc);
create index if not exists idx_stream_poll_votes_poll on public.stream_poll_votes(poll_id, created_at desc);

alter table public.stream_goals enable row level security;
alter table public.stream_goal_contributions enable row level security;
alter table public.stream_polls enable row level security;
alter table public.stream_poll_votes enable row level security;

drop policy if exists "stream goals read" on public.stream_goals;
drop policy if exists "stream goals manage" on public.stream_goals;
drop policy if exists "stream goal contrib read" on public.stream_goal_contributions;
drop policy if exists "stream goal contrib create" on public.stream_goal_contributions;
drop policy if exists "stream polls read" on public.stream_polls;
drop policy if exists "stream polls manage" on public.stream_polls;
drop policy if exists "stream poll votes read" on public.stream_poll_votes;
drop policy if exists "stream poll votes own" on public.stream_poll_votes;

create policy "stream goals read" on public.stream_goals for select using (true);
create policy "stream goals manage" on public.stream_goals for all
using (public.can_moderate_stream(stream_id))
with check (public.can_moderate_stream(stream_id));

create policy "stream goal contrib read" on public.stream_goal_contributions for select using (true);
create policy "stream goal contrib create" on public.stream_goal_contributions for insert with check (auth.uid() = user_id);

create policy "stream polls read" on public.stream_polls for select using (true);
create policy "stream polls manage" on public.stream_polls for all
using (public.can_moderate_stream(stream_id))
with check (public.can_moderate_stream(stream_id));

create policy "stream poll votes read" on public.stream_poll_votes for select using (true);
create policy "stream poll votes own" on public.stream_poll_votes for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stream_goals'
  ) then
    alter publication supabase_realtime add table public.stream_goals;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stream_polls'
  ) then
    alter publication supabase_realtime add table public.stream_polls;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stream_poll_votes'
  ) then
    alter publication supabase_realtime add table public.stream_poll_votes;
  end if;
end;
$$;

-- Support phase: ticketing
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  category text not null default 'other' check (category in ('account_access', 'technical_issue', 'billing', 'safety_report', 'other')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_user', 'resolved', 'closed')),
  description text not null,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_role text not null default 'user' check (sender_role in ('user', 'agent', 'system')),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_requester_updated on public.support_tickets(requester_id, updated_at desc);
create index if not exists idx_support_tickets_status_updated on public.support_tickets(status, updated_at desc);
create index if not exists idx_support_ticket_messages_ticket_created on public.support_ticket_messages(ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

drop policy if exists "support tickets own read" on public.support_tickets;
drop policy if exists "support tickets own create" on public.support_tickets;
drop policy if exists "support tickets admin read" on public.support_tickets;
drop policy if exists "support tickets admin update" on public.support_tickets;
drop policy if exists "support messages read" on public.support_ticket_messages;
drop policy if exists "support messages insert own" on public.support_ticket_messages;
drop policy if exists "support messages admin insert" on public.support_ticket_messages;

create policy "support tickets own read" on public.support_tickets for select using (auth.uid() = requester_id);
create policy "support tickets own create" on public.support_tickets for insert with check (auth.uid() = requester_id);
create policy "support tickets admin read" on public.support_tickets for select using (public.is_admin());
create policy "support tickets admin update" on public.support_tickets for update using (public.is_admin()) with check (public.is_admin());

create policy "support messages read" on public.support_ticket_messages for select using (
  exists (
    select 1
    from public.support_tickets t
    where t.id = support_ticket_messages.ticket_id
      and (t.requester_id = auth.uid() or public.is_admin())
  )
);

create policy "support messages insert own" on public.support_ticket_messages for insert with check (
  auth.uid() = sender_id
  and sender_role = 'user'
  and exists (
    select 1
    from public.support_tickets t
    where t.id = support_ticket_messages.ticket_id
      and t.requester_id = auth.uid()
  )
);

create policy "support messages admin insert" on public.support_ticket_messages for insert with check (
  public.is_admin()
  and sender_role in ('agent', 'system')
);

-- Monetization phase: wallet credits, premium, verification, and paid promotions
alter table public.profiles add column if not exists is_premium boolean not null default false;
alter table public.profiles add column if not exists premium_expires_at timestamptz;
alter table public.profiles add column if not exists is_verified boolean not null default false;
alter table public.profiles add column if not exists verified_expires_at timestamptz;

alter table public.posts add column if not exists promoted_until timestamptz;
alter table public.posts add column if not exists promotion_credits integer not null default 0 check (promotion_credits >= 0);

alter table public.streams add column if not exists promoted_until timestamptz;
alter table public.streams add column if not exists promotion_credits integer not null default 0 check (promotion_credits >= 0);

alter table public.stream_vods add column if not exists promoted_until timestamptz;
alter table public.stream_vods add column if not exists promotion_credits integer not null default 0 check (promotion_credits >= 0);

create table if not exists public.wallet_balances (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_credits integer not null default 0 check (balance_credits >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  counterparty_user_id uuid references public.profiles(id) on delete set null,
  transaction_type text not null check (transaction_type in (
    'credit_purchase',
    'donation_spend',
    'subscription_purchase',
    'premium_purchase',
    'verification_purchase',
    'promotion_spend',
    'donation_receive',
    'subscription_receive',
    'refund',
    'adjustment'
  )),
  amount_credits integer not null check (amount_credits <> 0),
  metadata jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'wallet_transactions_transaction_type_check'
  ) then
    alter table public.wallet_transactions
      drop constraint wallet_transactions_transaction_type_check;
  end if;

  alter table public.wallet_transactions
    add constraint wallet_transactions_transaction_type_check
    check (
      transaction_type in (
        'credit_purchase',
        'donation_spend',
        'subscription_purchase',
        'premium_purchase',
        'verification_purchase',
        'promotion_spend',
        'donation_receive',
        'subscription_receive',
        'refund',
        'adjustment'
      )
    );
end;
$$;

create table if not exists public.premium_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'expired', 'canceled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  auto_renew boolean not null default true,
  price_credits integer not null check (price_credits > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  price_credits integer not null check (price_credits > 0),
  metadata jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.content_promotions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'stream', 'stream_vod')),
  target_id uuid not null,
  credits_spent integer not null check (credits_spent > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'completed', 'canceled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_transactions_user_created on public.wallet_transactions(user_id, created_at desc);
create index if not exists idx_premium_subscriptions_user_created on public.premium_subscriptions(user_id, created_at desc);
create index if not exists idx_identity_verifications_user_created on public.identity_verifications(user_id, created_at desc);
create index if not exists idx_content_promotions_target on public.content_promotions(target_type, target_id, ends_at desc);
create index if not exists idx_posts_promoted_until on public.posts(promoted_until desc, created_at desc);
create index if not exists idx_streams_promoted_until on public.streams(promoted_until desc, created_at desc);
create index if not exists idx_stream_vods_promoted_until on public.stream_vods(promoted_until desc, published_at desc);

alter table public.wallet_balances enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.premium_subscriptions enable row level security;
alter table public.identity_verifications enable row level security;
alter table public.content_promotions enable row level security;

drop policy if exists "wallet balances read own" on public.wallet_balances;
drop policy if exists "wallet balances admin read" on public.wallet_balances;
drop policy if exists "wallet tx read own" on public.wallet_transactions;
drop policy if exists "wallet tx admin read" on public.wallet_transactions;
drop policy if exists "premium subscriptions read own" on public.premium_subscriptions;
drop policy if exists "premium subscriptions admin read" on public.premium_subscriptions;
drop policy if exists "identity verifications read own" on public.identity_verifications;
drop policy if exists "identity verifications admin read" on public.identity_verifications;
drop policy if exists "content promotions read own" on public.content_promotions;
drop policy if exists "content promotions admin read" on public.content_promotions;

create policy "wallet balances read own" on public.wallet_balances for select using (auth.uid() = user_id);
create policy "wallet balances admin read" on public.wallet_balances for select using (public.is_admin());

create policy "wallet tx read own" on public.wallet_transactions for select using (auth.uid() = user_id);
create policy "wallet tx admin read" on public.wallet_transactions for select using (public.is_admin());

create policy "premium subscriptions read own" on public.premium_subscriptions for select using (auth.uid() = user_id);
create policy "premium subscriptions admin read" on public.premium_subscriptions for select using (public.is_admin());

create policy "identity verifications read own" on public.identity_verifications for select using (auth.uid() = user_id);
create policy "identity verifications admin read" on public.identity_verifications for select using (public.is_admin());

create policy "content promotions read own" on public.content_promotions for select using (auth.uid() = user_id);
create policy "content promotions admin read" on public.content_promotions for select using (public.is_admin());

create or replace function public.ensure_wallet_balance(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_user_id is null then
    raise exception 'Invalid user';
  end if;

  insert into public.wallet_balances (user_id, balance_credits, updated_at)
  values (target_user_id, 0, now())
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.wallet_add_credits(amount_credits integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  normalized_amount integer := coalesce(amount_credits, 0);
  new_balance integer;
  package_price_usd numeric(10,2);
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if normalized_amount not in (1, 5, 10, 20, 50, 100, 500) then
    raise exception 'Invalid amount';
  end if;

  package_price_usd := case normalized_amount
    when 1 then 0.99
    when 5 then 4.99
    when 10 then 8.99
    when 20 then 18.99
    when 50 then 47.99
    when 100 then 89.99
    when 500 then 429.99
  end;

  perform public.ensure_wallet_balance(caller_id);

  update public.wallet_balances
  set balance_credits = balance_credits + normalized_amount,
      updated_at = now()
  where user_id = caller_id
  returning balance_credits into new_balance;

  insert into public.wallet_transactions (user_id, transaction_type, amount_credits, metadata)
  values (
    caller_id,
    'credit_purchase',
    normalized_amount,
    jsonb_build_object(
      'source', 'wallet_topup',
      'package_credits', normalized_amount,
      'package_price_usd', package_price_usd
    )
  );

  return new_balance;
end;
$$;

create or replace function public.purchase_premium_subscription(months_count integer default 1)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  normalized_months integer := greatest(1, coalesce(months_count, 1));
  price_per_month integer := 9;
  total_cost integer := normalized_months * price_per_month;
  current_balance integer := 0;
  start_ts timestamptz;
  end_ts timestamptz;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_wallet_balance(caller_id);

  select balance_credits into current_balance
  from public.wallet_balances
  where user_id = caller_id
  for update;

  if current_balance < total_cost then
    raise exception 'Insufficient credits';
  end if;

  update public.wallet_balances
  set balance_credits = balance_credits - total_cost,
      updated_at = now()
  where user_id = caller_id;

  select greatest(now(), coalesce(premium_expires_at, now())) into start_ts
  from public.profiles
  where id = caller_id;

  end_ts := start_ts + make_interval(months => normalized_months);

  update public.profiles
  set is_premium = true,
      premium_expires_at = end_ts,
      updated_at = now()
  where id = caller_id;

  insert into public.premium_subscriptions (user_id, status, starts_at, ends_at, auto_renew, price_credits, created_at)
  values (caller_id, 'active', start_ts, end_ts, true, total_cost, now());

  insert into public.wallet_transactions (user_id, transaction_type, amount_credits, metadata)
  values (
    caller_id,
    'premium_purchase',
    -total_cost,
    jsonb_build_object('months', normalized_months, 'price_per_month', price_per_month)
  );

  return jsonb_build_object(
    'user_id', caller_id,
    'is_premium', true,
    'premium_expires_at', end_ts,
    'remaining_credits', current_balance - total_cost
  );
end;
$$;

create or replace function public.purchase_identity_verification()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  price_credits integer := 15;
  current_balance integer := 0;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_wallet_balance(caller_id);

  select balance_credits into current_balance
  from public.wallet_balances
  where user_id = caller_id
  for update;

  if current_balance < price_credits then
    raise exception 'Insufficient credits';
  end if;

  update public.wallet_balances
  set balance_credits = balance_credits - price_credits,
      updated_at = now()
  where user_id = caller_id;

  update public.profiles
  set is_verified = true,
      verified_expires_at = null,
      updated_at = now()
  where id = caller_id;

  insert into public.identity_verifications (user_id, status, price_credits, metadata, created_at, reviewed_at)
  values (
    caller_id,
    'approved',
    price_credits,
    jsonb_build_object('source', 'paid_self_verification'),
    now(),
    now()
  );

  insert into public.wallet_transactions (user_id, transaction_type, amount_credits, metadata)
  values (
    caller_id,
    'verification_purchase',
    -price_credits,
    jsonb_build_object('verification', 'paid')
  );

  return jsonb_build_object(
    'user_id', caller_id,
    'is_verified', true,
    'remaining_credits', current_balance - price_credits
  );
end;
$$;

create or replace function public.subscribe_to_creator_with_credits(creator_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  subscription_price_credits integer := 1;
  current_balance integer := 0;
  existing_subscription_status text;
  had_existing_subscription boolean := false;
  resulting_status text := 'active';
  friendship_rows integer := 0;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if creator_id_input is null then
    raise exception 'Invalid creator';
  end if;
  if creator_id_input = caller_id then
    raise exception 'You cannot subscribe to your own profile';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = creator_id_input
      and coalesce(p.is_banned, false) = false
  ) then
    raise exception 'Creator not found';
  end if;

  select s.status
  into existing_subscription_status
  from public.subscriptions s
  where s.subscriber_id = caller_id
    and s.creator_id = creator_id_input
  limit 1;

  had_existing_subscription := existing_subscription_status is not null;

  if existing_subscription_status = 'active' then
    return jsonb_build_object(
      'subscriber_id', caller_id,
      'creator_id', creator_id_input,
      'status', 'active',
      'charged_credits', 0,
      'already_active', true
    );
  end if;

  perform public.ensure_wallet_balance(caller_id);
  perform public.ensure_wallet_balance(creator_id_input);

  select balance_credits
  into current_balance
  from public.wallet_balances
  where user_id = caller_id
  for update;

  if current_balance < subscription_price_credits then
    raise exception 'Insufficient credits';
  end if;

  update public.wallet_balances
  set balance_credits = balance_credits - subscription_price_credits,
      updated_at = now()
  where user_id = caller_id;

  update public.wallet_balances
  set balance_credits = balance_credits + subscription_price_credits,
      updated_at = now()
  where user_id = creator_id_input;

  insert into public.subscriptions (subscriber_id, creator_id, status, created_at)
  values (caller_id, creator_id_input, resulting_status, now())
  on conflict (subscriber_id, creator_id) do update
    set status = excluded.status;

  insert into public.follows (follower_id, following_id, created_at)
  values (caller_id, creator_id_input, now())
  on conflict (follower_id, following_id) do nothing;

  update public.friendships
  set status = 'accepted'
  where requester_id = caller_id
    and addressee_id = creator_id_input;

  get diagnostics friendship_rows = row_count;

  if friendship_rows = 0 then
    update public.friendships
    set status = 'accepted'
    where requester_id = creator_id_input
      and addressee_id = caller_id;

    get diagnostics friendship_rows = row_count;
  end if;

  if friendship_rows = 0 then
    insert into public.friendships (requester_id, addressee_id, status, created_at)
    values (caller_id, creator_id_input, 'accepted', now())
    on conflict (requester_id, addressee_id) do update
      set status = excluded.status;
  end if;

  insert into public.wallet_transactions (user_id, counterparty_user_id, transaction_type, amount_credits, metadata)
  values
    (
      caller_id,
      creator_id_input,
      'subscription_purchase',
      -subscription_price_credits,
      jsonb_build_object('creator_id', creator_id_input, 'had_existing_subscription', had_existing_subscription)
    ),
    (
      creator_id_input,
      caller_id,
      'subscription_receive',
      subscription_price_credits,
      jsonb_build_object('subscriber_id', caller_id)
    );

  return jsonb_build_object(
    'subscriber_id', caller_id,
    'creator_id', creator_id_input,
    'status', resulting_status,
    'charged_credits', subscription_price_credits,
    'remaining_credits', current_balance - subscription_price_credits,
    'already_active', false
  );
end;
$$;

create or replace function public.sync_premium_access(max_users integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  now_ts timestamptz := now();
  normalized_limit integer := greatest(1, least(coalesce(max_users, 200), 2000));
  renewed_count integer := 0;
  expired_count integer := 0;
  deactivated_count integer := 0;
  sub_row record;
  current_balance integer;
  next_end timestamptz;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'Forbidden';
  end if;

  update public.profiles p
  set is_premium = false,
      updated_at = now_ts
  where p.is_premium = true
    and p.premium_expires_at is not null
    and p.premium_expires_at <= now_ts;

  get diagnostics deactivated_count = row_count;

  for sub_row in
    select distinct on (s.user_id)
      s.id,
      s.user_id,
      s.ends_at,
      s.price_credits
    from public.premium_subscriptions s
    where s.status = 'active'
      and s.auto_renew = true
      and s.ends_at <= now_ts
    order by s.user_id, s.ends_at desc
    limit normalized_limit
  loop
    perform public.ensure_wallet_balance(sub_row.user_id);

    select wb.balance_credits
    into current_balance
    from public.wallet_balances wb
    where wb.user_id = sub_row.user_id
    for update;

    if current_balance >= sub_row.price_credits then
      next_end := greatest(sub_row.ends_at, now_ts) + interval '1 month';

      update public.wallet_balances
      set balance_credits = balance_credits - sub_row.price_credits,
          updated_at = now_ts
      where user_id = sub_row.user_id;

      update public.premium_subscriptions
      set ends_at = next_end,
          status = 'active'
      where id = sub_row.id;

      update public.profiles
      set is_premium = true,
          premium_expires_at = next_end,
          updated_at = now_ts
      where id = sub_row.user_id;

      insert into public.wallet_transactions (user_id, transaction_type, amount_credits, metadata)
      values (
        sub_row.user_id,
        'premium_purchase',
        -sub_row.price_credits,
        jsonb_build_object(
          'source', 'auto_renew',
          'subscription_id', sub_row.id,
          'triggered_by', caller_id
        )
      );

      renewed_count := renewed_count + 1;
    else
      update public.premium_subscriptions
      set status = 'expired'
      where id = sub_row.id;

      if exists (
        select 1
        from public.profiles p
        where p.id = sub_row.user_id
          and p.premium_expires_at is not null
          and p.premium_expires_at <= now_ts
      ) then
        update public.profiles
        set is_premium = false,
            updated_at = now_ts
        where id = sub_row.user_id;
      end if;

      expired_count := expired_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'checked', normalized_limit,
    'renewed', renewed_count,
    'expired', expired_count,
    'deactivated', deactivated_count
  );
end;
$$;

create or replace function public.send_stream_donation_with_credits(
  stream_id_input uuid,
  amount_credits_input integer,
  message_input text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  streamer_user_id uuid;
  normalized_amount integer := coalesce(amount_credits_input, 0);
  current_balance integer := 0;
  donation_id uuid;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if stream_id_input is null then
    raise exception 'Invalid stream';
  end if;
  if normalized_amount <= 0 then
    raise exception 'Invalid amount';
  end if;

  select streamer_id
  into streamer_user_id
  from public.streams
  where id = stream_id_input;

  if streamer_user_id is null then
    raise exception 'Stream not found';
  end if;
  if streamer_user_id = caller_id then
    raise exception 'You cannot donate to your own stream';
  end if;

  perform public.ensure_wallet_balance(caller_id);
  perform public.ensure_wallet_balance(streamer_user_id);

  select balance_credits into current_balance
  from public.wallet_balances
  where user_id = caller_id
  for update;

  if current_balance < normalized_amount then
    raise exception 'Insufficient credits';
  end if;

  update public.wallet_balances
  set balance_credits = balance_credits - normalized_amount,
      updated_at = now()
  where user_id = caller_id;

  update public.wallet_balances
  set balance_credits = balance_credits + normalized_amount,
      updated_at = now()
  where user_id = streamer_user_id;

  insert into public.stream_donations (stream_id, sender_id, amount_cents, message, status, created_at)
  values (
    stream_id_input,
    caller_id,
    normalized_amount,
    nullif(trim(coalesce(message_input, '')), ''),
    'paid',
    now()
  )
  returning id into donation_id;

  insert into public.wallet_transactions (user_id, counterparty_user_id, transaction_type, amount_credits, metadata)
  values
    (
      caller_id,
      streamer_user_id,
      'donation_spend',
      -normalized_amount,
      jsonb_build_object('stream_id', stream_id_input, 'donation_id', donation_id)
    ),
    (
      streamer_user_id,
      caller_id,
      'donation_receive',
      normalized_amount,
      jsonb_build_object('stream_id', stream_id_input, 'donation_id', donation_id)
    );

  return donation_id;
end;
$$;

create or replace function public.promote_content_with_credits(
  target_type_input text,
  target_id_input uuid,
  credits_input integer,
  duration_days_input integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  normalized_target_type text := lower(trim(coalesce(target_type_input, '')));
  normalized_credits integer := coalesce(credits_input, 5);
  normalized_days integer := greatest(1, coalesce(duration_days_input, 1));
  current_balance integer := 0;
  promotion_id uuid;
  promotion_until timestamptz := now() + make_interval(days => normalized_days);
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if target_id_input is null then
    raise exception 'Invalid target';
  end if;
  if normalized_credits <> 5 then
    raise exception 'Invalid credits';
  end if;
  if normalized_days <> 1 then
    raise exception 'Invalid duration';
  end if;
  if normalized_target_type not in ('post', 'stream', 'stream_vod') then
    raise exception 'Invalid target type';
  end if;

  perform public.ensure_wallet_balance(caller_id);

  if normalized_target_type = 'post' then
    if not exists (
      select 1 from public.posts p
      where p.id = target_id_input
        and p.author_id = caller_id
    ) then
      raise exception 'Post not found or not owned';
    end if;
  elsif normalized_target_type = 'stream' then
    if not exists (
      select 1 from public.streams s
      where s.id = target_id_input
        and s.streamer_id = caller_id
    ) then
      raise exception 'Stream not found or not owned';
    end if;
  elsif normalized_target_type = 'stream_vod' then
    if not exists (
      select 1 from public.stream_vods v
      where v.id = target_id_input
        and v.owner_id = caller_id
    ) then
      raise exception 'Video not found or not owned';
    end if;
  end if;

  select balance_credits into current_balance
  from public.wallet_balances
  where user_id = caller_id
  for update;

  if current_balance < normalized_credits then
    raise exception 'Insufficient credits';
  end if;

  update public.wallet_balances
  set balance_credits = balance_credits - normalized_credits,
      updated_at = now()
  where user_id = caller_id;

  if normalized_target_type = 'post' then
    update public.posts
    set promoted_until = promotion_until,
        promotion_credits = promotion_credits + normalized_credits
    where id = target_id_input;
  elsif normalized_target_type = 'stream' then
    update public.streams
    set promoted_until = promotion_until,
        promotion_credits = promotion_credits + normalized_credits
    where id = target_id_input;
  else
    update public.stream_vods
    set promoted_until = promotion_until,
        promotion_credits = promotion_credits + normalized_credits
    where id = target_id_input;
  end if;

  insert into public.content_promotions (user_id, target_type, target_id, credits_spent, starts_at, ends_at, status, created_at)
  values (caller_id, normalized_target_type, target_id_input, normalized_credits, now(), promotion_until, 'active', now())
  returning id into promotion_id;

  insert into public.wallet_transactions (user_id, transaction_type, amount_credits, metadata)
  values (
    caller_id,
    'promotion_spend',
    -normalized_credits,
    jsonb_build_object('target_type', normalized_target_type, 'target_id', target_id_input, 'promotion_id', promotion_id, 'days', normalized_days)
  );

  return promotion_id;
end;
$$;

grant execute on function public.wallet_add_credits(integer) to authenticated;
grant execute on function public.purchase_premium_subscription(integer) to authenticated;
grant execute on function public.purchase_identity_verification() to authenticated;
grant execute on function public.subscribe_to_creator_with_credits(uuid) to authenticated;
grant execute on function public.sync_premium_access(integer) to authenticated, service_role;
grant execute on function public.send_stream_donation_with_credits(uuid, integer, text) to authenticated;
grant execute on function public.promote_content_with_credits(text, uuid, integer, integer) to authenticated;
grant execute on function public.block_profile_user(uuid) to authenticated;
grant execute on function public.unblock_profile_user(uuid) to authenticated;

-- Messaging solid phase: attachments metadata, per-message receipts, and anti-spam RPCs
alter table public.messages
  add column if not exists attachment_mime_type text,
  add column if not exists attachment_size_bytes integer check (attachment_size_bytes is null or attachment_size_bytes >= 0),
  add column if not exists attachment_duration_ms integer check (attachment_duration_ms is null or attachment_duration_ms >= 0),
  add column if not exists client_idempotency_key text,
  add column if not exists edited_at timestamptz;

create unique index if not exists idx_messages_sender_conversation_idempotency
  on public.messages(sender_id, conversation_id, client_idempotency_key)
  where client_idempotency_key is not null;

create table if not exists public.message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read')),
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create index if not exists idx_message_receipts_user_status_created on public.message_receipts(user_id, status, created_at desc);
create index if not exists idx_message_receipts_message_user on public.message_receipts(message_id, user_id);

alter table public.message_receipts enable row level security;

drop policy if exists "message receipts read member" on public.message_receipts;
drop policy if exists "message receipts own update" on public.message_receipts;
drop policy if exists "message receipts service write" on public.message_receipts;

create policy "message receipts read member" on public.message_receipts for select using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.messages m
    where m.id = message_receipts.message_id
      and m.sender_id = auth.uid()
      and public.is_conversation_member(m.conversation_id)
  )
);

create policy "message receipts own update" on public.message_receipts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "message receipts service write" on public.message_receipts for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.create_message_receipts_for_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.message_receipts (message_id, user_id, status, created_at, updated_at)
  select
    new.id,
    cm.user_id,
    'sent',
    now(),
    now()
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id
    and cm.user_id <> new.sender_id
  on conflict (message_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_create_message_receipts on public.messages;
create trigger trg_create_message_receipts
after insert on public.messages
for each row execute procedure public.create_message_receipts_for_message();

create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_message_type text,
  p_content text,
  p_attachment_url text default null,
  p_attachment_mime_type text default null,
  p_attachment_size_bytes integer default null,
  p_attachment_duration_ms integer default null,
  p_client_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  normalized_type text := lower(trim(coalesce(p_message_type, 'text')));
  normalized_content text := trim(coalesce(p_content, ''));
  normalized_attachment_url text := nullif(trim(coalesce(p_attachment_url, '')), '');
  normalized_attachment_mime text := nullif(trim(coalesce(p_attachment_mime_type, '')), '');
  normalized_attachment_size integer := p_attachment_size_bytes;
  normalized_attachment_duration integer := p_attachment_duration_ms;
  normalized_idempotency text := nullif(trim(coalesce(p_client_idempotency_key, '')), '');
  existing_id uuid;
  inserted_id uuid;
  recent_count integer;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_conversation_id is null then
    raise exception 'Invalid conversation';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden';
  end if;

  if normalized_type not in ('text', 'emoji', 'image', 'video', 'audio', 'link', 'post') then
    raise exception 'Invalid message type';
  end if;
  if char_length(normalized_content) = 0 then
    raise exception 'Empty message';
  end if;
  if char_length(normalized_content) > 4000 then
    raise exception 'Message too long';
  end if;

  if normalized_type in ('image', 'video', 'audio') and normalized_attachment_url is null then
    raise exception 'Attachment required for media message';
  end if;
  if normalized_type in ('image', 'video', 'audio') and normalized_attachment_size is null then
    raise exception 'Attachment size required for media message';
  end if;

  if normalized_type = 'image' and normalized_attachment_size > (10 * 1024 * 1024) then
    raise exception 'Image exceeds size limit';
  end if;
  if normalized_type = 'video' and normalized_attachment_size > (20 * 1024 * 1024) then
    raise exception 'Video exceeds size limit';
  end if;
  if normalized_type = 'audio' and normalized_attachment_size > (12 * 1024 * 1024) then
    raise exception 'Audio exceeds size limit';
  end if;

  if normalized_idempotency is not null then
    select m.id
    into existing_id
    from public.messages m
    where m.sender_id = caller_id
      and m.conversation_id = p_conversation_id
      and m.client_idempotency_key = normalized_idempotency
    limit 1;

    if existing_id is not null then
      return existing_id;
    end if;
  end if;

  select count(*) into recent_count
  from public.messages m
  where m.sender_id = caller_id
    and m.conversation_id = p_conversation_id
    and m.created_at >= now() - interval '10 seconds';

  if recent_count >= 8 then
    raise exception 'Rate limit exceeded';
  end if;

  if exists (
    select 1
    from public.messages m
    where m.sender_id = caller_id
      and m.conversation_id = p_conversation_id
      and m.content = normalized_content
      and m.created_at >= now() - interval '15 seconds'
  ) then
    raise exception 'Duplicate message detected';
  end if;

  insert into public.messages (
    conversation_id,
    sender_id,
    message_type,
    content,
    attachment_url,
    attachment_mime_type,
    attachment_size_bytes,
    attachment_duration_ms,
    client_idempotency_key,
    created_at
  )
  values (
    p_conversation_id,
    caller_id,
    normalized_type,
    normalized_content,
    normalized_attachment_url,
    normalized_attachment_mime,
    normalized_attachment_size,
    normalized_attachment_duration,
    normalized_idempotency,
    now()
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;

create or replace function public.mark_conversation_messages_delivered(
  p_conversation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  affected integer := 0;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_conversation_id is null then
    raise exception 'Invalid conversation';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden';
  end if;

  update public.message_receipts mr
  set status = 'delivered',
      delivered_at = coalesce(mr.delivered_at, now()),
      updated_at = now()
  from public.messages m
  where mr.message_id = m.id
    and mr.user_id = caller_id
    and m.conversation_id = p_conversation_id
    and mr.status = 'sent';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.mark_conversation_messages_read(
  p_conversation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  now_ts timestamptz := now();
  affected integer := 0;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_conversation_id is null then
    raise exception 'Invalid conversation';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'Forbidden';
  end if;

  update public.message_receipts mr
  set status = 'read',
      delivered_at = coalesce(mr.delivered_at, now_ts),
      read_at = coalesce(mr.read_at, now_ts),
      updated_at = now_ts
  from public.messages m
  where mr.message_id = m.id
    and mr.user_id = caller_id
    and m.conversation_id = p_conversation_id
    and mr.status in ('sent', 'delivered');

  get diagnostics affected = row_count;

  update public.conversation_members
  set last_read_at = now_ts
  where conversation_id = p_conversation_id
    and user_id = caller_id;

  return affected;
end;
$$;

grant select on public.message_receipts to authenticated, service_role;
grant execute on function public.send_chat_message(uuid, text, text, text, text, integer, integer, text) to authenticated;
grant execute on function public.mark_conversation_messages_delivered(uuid) to authenticated;
grant execute on function public.mark_conversation_messages_read(uuid) to authenticated;

revoke insert on public.messages from authenticated;
revoke update on public.messages from authenticated;
revoke delete on public.messages from authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_receipts'
  ) then
    alter publication supabase_realtime add table public.message_receipts;
  end if;
end;
$$;

-- Feed and discovery phase: ranked feed + global search + content type filters
create extension if not exists pg_trgm;

create index if not exists idx_follows_follower_following on public.follows(follower_id, following_id);
create index if not exists idx_profiles_username_lower on public.profiles((lower(username)));
create index if not exists idx_profiles_full_name_lower on public.profiles((lower(full_name)));
create index if not exists idx_posts_content_lower on public.posts((lower(content)));
create index if not exists idx_streams_title_lower on public.streams((lower(title)));
create index if not exists idx_stream_vods_title_lower on public.stream_vods((lower(title)));
create index if not exists idx_stream_vods_description_lower on public.stream_vods((lower(coalesce(description, ''))));
create index if not exists idx_profiles_username_trgm on public.profiles using gin (lower(username) gin_trgm_ops);
create index if not exists idx_profiles_full_name_trgm on public.profiles using gin (lower(full_name) gin_trgm_ops);
create index if not exists idx_posts_content_trgm on public.posts using gin (lower(content) gin_trgm_ops);
create index if not exists idx_streams_title_trgm on public.streams using gin (lower(title) gin_trgm_ops);
create index if not exists idx_streams_category_trgm on public.streams using gin (lower(coalesce(category, '')) gin_trgm_ops);
create index if not exists idx_stream_vods_title_trgm on public.stream_vods using gin (lower(title) gin_trgm_ops);
create index if not exists idx_stream_vods_description_trgm on public.stream_vods using gin (lower(coalesce(description, '')) gin_trgm_ops);

create or replace function public.get_ranked_feed(
  p_mode text default 'for_you',
  p_page integer default 0,
  p_size integer default 10,
  p_content_type text default 'all'
)
returns table (
  id uuid,
  author_id uuid,
  content text,
  media_url text,
  media_type text,
  shared_target_type text,
  shared_target_id uuid,
  created_at timestamptz,
  reactions_count integer,
  comments_count integer,
  shares_count integer,
  saved_count integer,
  rank_score numeric,
  profile jsonb
)
language sql
stable
set search_path = public
as $$
  with params as (
    select
      greatest(coalesce(p_page, 0), 0) as page_num,
      greatest(1, least(coalesce(p_size, 10), 100)) as page_size,
      lower(trim(coalesce(p_mode, 'for_you'))) as mode_value,
      lower(trim(coalesce(p_content_type, 'all'))) as content_type_value,
      auth.uid() as viewer_id
  ),
  base as (
    select
      p.id,
      p.author_id,
      p.content,
      p.media_url,
      p.media_type,
      p.shared_target_type,
      p.shared_target_id,
      p.created_at,
      coalesce(pr.reactions_count, 0) as reactions_count,
      coalesce(pc.comments_count, 0) as comments_count,
      coalesce(ps.shares_count, 0) as shares_count,
      coalesce(sp.saved_count, 0) as saved_count,
      case when f.following_id is not null then 1 else 0 end as is_following,
      p.promoted_until,
      p.promotion_credits
    from public.posts p
    cross join params prm
    left join (
      select post_id, count(*)::integer as reactions_count
      from public.post_reactions
      group by post_id
    ) pr on pr.post_id = p.id
    left join (
      select post_id, count(*)::integer as comments_count
      from public.comments
      group by post_id
    ) pc on pc.post_id = p.id
    left join (
      select post_id, count(*)::integer as shares_count
      from public.shared_posts
      group by post_id
    ) ps on ps.post_id = p.id
    left join (
      select post_id, count(*)::integer as saved_count
      from public.saved_posts
      group by post_id
    ) sp on sp.post_id = p.id
    left join public.follows f
      on f.follower_id = prm.viewer_id
     and f.following_id = p.author_id
    where
      (
        prm.mode_value <> 'following'
        or (
          prm.viewer_id is not null
          and (f.following_id is not null or p.author_id = prm.viewer_id)
        )
      )
      and (
        prm.content_type_value = 'all'
        or (prm.content_type_value = 'text' and p.media_type is null)
        or (prm.content_type_value = 'image' and p.media_type = 'image')
        or (prm.content_type_value = 'video' and p.media_type = 'video')
      )
  ),
  scored as (
    select
      b.*,
      (
        (200.0 / (1 + greatest(extract(epoch from (now() - b.created_at)) / 3600.0, 0))) +
        (b.reactions_count * 2.0) +
        (b.comments_count * 3.0) +
        (b.shares_count * 4.0) +
        (b.saved_count * 2.0) +
        (case when b.is_following = 1 then 40.0 else 0.0 end) +
        (case when b.promoted_until is not null and b.promoted_until > now() then least(coalesce(b.promotion_credits, 0), 50) * 1.2 else 0.0 end)
      ) as rank_score
    from base b
  ),
  ranked as (
    select
      s.id,
      s.author_id,
      s.content,
      s.media_url,
      s.media_type,
      s.shared_target_type,
      s.shared_target_id,
      s.created_at,
      s.reactions_count,
      s.comments_count,
      s.shares_count,
      s.saved_count,
      s.rank_score,
      jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'is_premium', coalesce(p.is_premium, false),
        'is_verified', coalesce(p.is_verified, false)
      ) as profile,
      row_number() over (order by s.rank_score desc, s.created_at desc) as row_num
    from scored s
    join public.profiles p on p.id = s.author_id
  )
  select
    r.id,
    r.author_id,
    r.content,
    r.media_url,
    r.media_type,
    r.shared_target_type,
    r.shared_target_id,
    r.created_at,
    r.reactions_count,
    r.comments_count,
    r.shares_count,
    r.saved_count,
    r.rank_score,
    r.profile
  from ranked r
  cross join params prm
  where r.row_num > (prm.page_num * prm.page_size)
    and r.row_num <= ((prm.page_num + 1) * prm.page_size)
  order by r.row_num;
$$;

create or replace function public.global_search(
  p_query text,
  p_scope text default 'all',
  p_limit integer default 40
)
returns table (
  result_type text,
  result_id uuid,
  title text,
  subtitle text,
  created_at timestamptz,
  rank_score numeric,
  payload jsonb
)
language sql
stable
set search_path = public
as $$
  with params as (
    select
      lower(trim(coalesce(p_query, ''))) as q,
      lower(trim(coalesce(p_scope, 'all'))) as scope_value,
      greatest(1, least(coalesce(p_limit, 40), 120)) as max_items,
      auth.uid() as viewer_id
  ),
  profile_results as (
    select
      'profile'::text as result_type,
      p.id as result_id,
      p.full_name as title,
      '@' || p.username as subtitle,
      p.created_at,
      (
        case when lower(p.username) = prm.q then 180 else 0 end +
        case when lower(p.username) like prm.q || '%' then 120 else 0 end +
        case when lower(p.full_name) like prm.q || '%' then 80 else 0 end +
        case when lower(p.username) like '%' || prm.q || '%' then 40 else 0 end +
        case when lower(p.full_name) like '%' || prm.q || '%' then 30 else 0 end
      )::numeric as rank_score,
      jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'full_name', p.full_name,
        'avatar_url', p.avatar_url,
        'is_premium', coalesce(p.is_premium, false),
        'is_verified', coalesce(p.is_verified, false)
      ) as payload
    from public.profiles p
    cross join params prm
    left join public.account_settings aset on aset.user_id = p.id
    where
      prm.q <> ''
      and (
        lower(p.username) like '%' || prm.q || '%'
        or lower(p.full_name) like '%' || prm.q || '%'
      )
      and (
        p.id = prm.viewer_id
        or coalesce((aset.discoverability ->> 'searchable_profile')::boolean, true)
      )
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = p.id)
             or (pb.blocker_id = p.id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  post_results as (
    select
      'post'::text as result_type,
      p.id as result_id,
      left(p.content, 120) as title,
      coalesce('@' || pr.username, 'Publicacion') as subtitle,
      p.created_at,
      (
        case when lower(p.content) like prm.q || '%' then 80 else 0 end +
        case when lower(p.content) like '%' || prm.q || '%' then 40 else 0 end +
        (coalesce(prs.reactions_count, 0) * 2) +
        (coalesce(pcs.comments_count, 0) * 3) +
        (coalesce(pss.shares_count, 0) * 4) +
        (case when f.following_id is not null then 24 else 0 end)
      )::numeric as rank_score,
      jsonb_build_object(
        'id', p.id,
        'author_id', p.author_id,
        'content', p.content,
        'media_url', p.media_url,
        'media_type', p.media_type,
        'shared_target_type', p.shared_target_type,
        'shared_target_id', p.shared_target_id,
        'created_at', p.created_at,
        'reactions_count', coalesce(prs.reactions_count, 0),
        'comments_count', coalesce(pcs.comments_count, 0),
        'shares_count', coalesce(pss.shares_count, 0),
        'saved_count', coalesce(sps.saved_count, 0),
        'profile', jsonb_build_object(
          'id', pr.id,
          'username', pr.username,
          'full_name', pr.full_name,
          'avatar_url', pr.avatar_url,
          'is_premium', coalesce(pr.is_premium, false),
          'is_verified', coalesce(pr.is_verified, false)
        )
      ) as payload
    from public.posts p
    cross join params prm
    join public.profiles pr on pr.id = p.author_id
    left join public.follows f on f.follower_id = prm.viewer_id and f.following_id = p.author_id
    left join (
      select post_id, count(*)::integer as reactions_count
      from public.post_reactions
      group by post_id
    ) prs on prs.post_id = p.id
    left join (
      select post_id, count(*)::integer as comments_count
      from public.comments
      group by post_id
    ) pcs on pcs.post_id = p.id
    left join (
      select post_id, count(*)::integer as shares_count
      from public.shared_posts
      group by post_id
    ) pss on pss.post_id = p.id
    left join (
      select post_id, count(*)::integer as saved_count
      from public.saved_posts
      group by post_id
    ) sps on sps.post_id = p.id
    where
      prm.q <> ''
      and lower(p.content) like '%' || prm.q || '%'
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = p.author_id)
             or (pb.blocker_id = p.author_id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  stream_results as (
    select
      'stream'::text as result_type,
      s.id as result_id,
      s.title,
      coalesce(s.category, 'stream') as subtitle,
      s.created_at,
      (
        case when lower(s.title) like prm.q || '%' then 100 else 0 end +
        case when lower(s.title) like '%' || prm.q || '%' then 50 else 0 end +
        least(coalesce(s.viewer_count, 0), 100) +
        (case when f.following_id is not null then 20 else 0 end) +
        (case when s.is_live then 30 else 0 end)
      )::numeric as rank_score,
      jsonb_build_object(
        'id', s.id,
        'streamer_id', s.streamer_id,
        'title', s.title,
        'category', s.category,
        'is_live', s.is_live,
        'viewer_count', s.viewer_count,
        'stream_key_hint', s.stream_key_hint,
        'created_at', s.created_at
      ) as payload
    from public.streams s
    cross join params prm
    left join public.follows f on f.follower_id = prm.viewer_id and f.following_id = s.streamer_id
    where
      prm.q <> ''
      and (
        lower(s.title) like '%' || prm.q || '%'
        or lower(coalesce(s.category, '')) like '%' || prm.q || '%'
      )
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = s.streamer_id)
             or (pb.blocker_id = s.streamer_id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  vod_results as (
    select
      'stream_vod'::text as result_type,
      v.id as result_id,
      v.title,
      coalesce(v.description, 'Video') as subtitle,
      coalesce(v.published_at, v.created_at) as created_at,
      (
        case when lower(v.title) like prm.q || '%' then 100 else 0 end +
        case when lower(v.title) like '%' || prm.q || '%' then 50 else 0 end +
        case when lower(coalesce(v.description, '')) like '%' || prm.q || '%' then 25 else 0 end +
        least(coalesce(v.views_count, 0), 200) * 0.5 +
        (case when f.following_id is not null then 20 else 0 end)
      )::numeric as rank_score,
      jsonb_build_object(
        'id', v.id,
        'stream_id', v.stream_id,
        'owner_id', v.owner_id,
        'title', v.title,
        'description', v.description,
        'vod_url', v.vod_url,
        'thumbnail_url', v.thumbnail_url,
        'duration_seconds', v.duration_seconds,
        'views_count', v.views_count,
        'visibility', v.visibility,
        'status', v.status,
        'published_at', v.published_at,
        'created_at', v.created_at,
        'updated_at', v.updated_at
      ) as payload
    from public.stream_vods v
    cross join params prm
    left join public.follows f on f.follower_id = prm.viewer_id and f.following_id = v.owner_id
    where
      prm.q <> ''
      and v.status = 'ready'
      and v.visibility in ('public', 'unlisted')
      and (
        lower(v.title) like '%' || prm.q || '%'
        or lower(coalesce(v.description, '')) like '%' || prm.q || '%'
      )
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = v.owner_id)
             or (pb.blocker_id = v.owner_id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  reel_results as (
    select
      'reel'::text as result_type,
      r.id as result_id,
      coalesce(nullif(r.title, ''), 'Reel') as title,
      coalesce(r.description, 'Reel') as subtitle,
      r.created_at,
      (
        case when lower(coalesce(r.title, '')) like prm.q || '%' then 95 else 0 end +
        case when lower(coalesce(r.title, '')) like '%' || prm.q || '%' then 45 else 0 end +
        case when lower(coalesce(r.description, '')) like '%' || prm.q || '%' then 30 else 0 end +
        least(coalesce(r.views_count, 0), 250) * 0.5 +
        least(coalesce(r.likes_count, 0), 200) * 0.35 +
        (case when f.following_id is not null then 20 else 0 end)
      )::numeric as rank_score,
      jsonb_build_object(
        'id', r.id,
        'author_id', r.author_id,
        'title', r.title,
        'description', r.description,
        'video_url', r.video_url,
        'thumbnail_url', r.thumbnail_url,
        'likes_count', r.likes_count,
        'comments_count', r.comments_count,
        'shares_count', r.shares_count,
        'saves_count', r.saves_count,
        'views_count', r.views_count,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      ) as payload
    from public.reels r
    cross join params prm
    left join public.follows f on f.follower_id = prm.viewer_id and f.following_id = r.author_id
    where
      prm.q <> ''
      and (
        lower(coalesce(r.title, '')) like '%' || prm.q || '%'
        or lower(coalesce(r.description, '')) like '%' || prm.q || '%'
      )
      and (
        prm.viewer_id is null
        or not exists (
          select 1
          from public.profile_blocks pb
          where (pb.blocker_id = prm.viewer_id and pb.blocked_id = r.author_id)
             or (pb.blocker_id = r.author_id and pb.blocked_id = prm.viewer_id)
        )
      )
  ),
  combined as (
    select * from profile_results
    union all
    select * from post_results
    union all
    select * from stream_results
    union all
    select * from vod_results
    union all
    select * from reel_results
  )
  select
    c.result_type,
    c.result_id,
    c.title,
    c.subtitle,
    c.created_at,
    c.rank_score,
    c.payload
  from combined c
  cross join params prm
  where
    prm.scope_value = 'all'
    or (prm.scope_value = 'profiles' and c.result_type = 'profile')
    or (prm.scope_value = 'posts' and c.result_type = 'post')
    or (prm.scope_value = 'reels' and c.result_type = 'reel')
    or (prm.scope_value = 'streams' and c.result_type = 'stream')
    or (prm.scope_value = 'vods' and c.result_type = 'stream_vod')
    or (prm.scope_value = 'videos' and c.result_type in ('post', 'stream_vod', 'reel'))
  order by c.rank_score desc, c.created_at desc
  limit (select max_items from params);
$$;

grant execute on function public.get_ranked_feed(text, integer, integer, text) to authenticated, service_role, anon;
grant execute on function public.global_search(text, text, integer) to authenticated, service_role, anon;
