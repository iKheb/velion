-- Phase 3: solid messaging (attachments, per-message delivery/read, anti-spam)
-- Created at: 2026-03-06

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

create index if not exists idx_message_receipts_user_status_created
  on public.message_receipts(user_id, status, created_at desc);

create index if not exists idx_message_receipts_message_user
  on public.message_receipts(message_id, user_id);

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

  select count(*)
  into recent_count
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
