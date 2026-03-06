-- Phase 1: payments foundation + immutable ledger
-- Created at: 2026-02-28

create table if not exists public.payment_providers (
  code text primary key,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.payment_providers (code, display_name, is_active)
values
  ('stripe', 'Stripe', true),
  ('mercado_pago', 'Mercado Pago', true)
on conflict (code) do update
set display_name = excluded.display_name,
    is_active = excluded.is_active,
    updated_at = now();

create table if not exists public.payment_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null references public.payment_providers(code),
  provider_customer_id text not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_customer_id),
  unique (user_id, provider)
);

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null references public.payment_providers(code),
  package_credits integer not null check (package_credits in (1, 5, 10, 20, 50, 100, 500)),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'USD',
  status text not null default 'created' check (status in ('created', 'pending', 'requires_action', 'succeeded', 'canceled', 'failed')),
  provider_intent_id text,
  provider_checkout_id text,
  idempotency_key text,
  metadata jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (provider, provider_intent_id)
);

create unique index if not exists idx_payment_intents_user_idempotency
  on public.payment_intents(user_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.payment_providers(code),
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  unit text not null check (unit in ('credits', 'usd_cents')),
  source_type text not null,
  source_id uuid,
  external_ref text,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create unique index if not exists idx_ledger_transactions_external_ref
  on public.ledger_transactions(external_ref)
  where external_ref is not null;

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.ledger_transactions(id) on delete cascade,
  account_code text not null,
  amount_minor bigint not null check (amount_minor <> 0),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_intents_user_created on public.payment_intents(user_id, created_at desc);
create index if not exists idx_payment_intents_status_created on public.payment_intents(status, created_at desc);
create index if not exists idx_payment_webhooks_status_received on public.payment_webhook_events(status, received_at desc);
create index if not exists idx_ledger_transactions_user_created on public.ledger_transactions(user_id, created_at desc);
create index if not exists idx_ledger_entries_tx on public.ledger_entries(transaction_id, created_at);

alter table public.payment_providers enable row level security;
alter table public.payment_customers enable row level security;
alter table public.payment_intents enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_entries enable row level security;

drop policy if exists "payment providers read" on public.payment_providers;
drop policy if exists "payment customers own read" on public.payment_customers;
drop policy if exists "payment customers admin read" on public.payment_customers;
drop policy if exists "payment intents own read" on public.payment_intents;
drop policy if exists "payment intents own insert" on public.payment_intents;
drop policy if exists "payment intents admin read" on public.payment_intents;
drop policy if exists "payment intents admin update" on public.payment_intents;
drop policy if exists "payment webhooks admin read" on public.payment_webhook_events;
drop policy if exists "payment webhooks service write" on public.payment_webhook_events;
drop policy if exists "ledger tx own read" on public.ledger_transactions;
drop policy if exists "ledger tx admin read" on public.ledger_transactions;
drop policy if exists "ledger entries own read" on public.ledger_entries;
drop policy if exists "ledger entries admin read" on public.ledger_entries;

create policy "payment providers read" on public.payment_providers
for select using (true);

create policy "payment customers own read" on public.payment_customers
for select using (auth.uid() = user_id);

create policy "payment customers admin read" on public.payment_customers
for select using (public.is_admin() or auth.role() = 'service_role');

create policy "payment intents own read" on public.payment_intents
for select using (auth.uid() = user_id);

create policy "payment intents own insert" on public.payment_intents
for insert with check (auth.uid() = user_id);

create policy "payment intents admin read" on public.payment_intents
for select using (public.is_admin() or auth.role() = 'service_role');

create policy "payment intents admin update" on public.payment_intents
for update using (public.is_admin() or auth.role() = 'service_role')
with check (public.is_admin() or auth.role() = 'service_role');

create policy "payment webhooks admin read" on public.payment_webhook_events
for select using (public.is_admin() or auth.role() = 'service_role');

create policy "payment webhooks service write" on public.payment_webhook_events
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "ledger tx own read" on public.ledger_transactions
for select using (auth.uid() = user_id);

create policy "ledger tx admin read" on public.ledger_transactions
for select using (public.is_admin() or auth.role() = 'service_role');

create policy "ledger entries own read" on public.ledger_entries
for select using (
  exists (
    select 1
    from public.ledger_transactions t
    where t.id = ledger_entries.transaction_id
      and t.user_id = auth.uid()
  )
);

create policy "ledger entries admin read" on public.ledger_entries
for select using (public.is_admin() or auth.role() = 'service_role');

create or replace function public.prevent_immutable_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Immutable table: updates and deletes are not allowed';
end;
$$;

drop trigger if exists trg_no_mutation_ledger_transactions on public.ledger_transactions;
create trigger trg_no_mutation_ledger_transactions
before update or delete on public.ledger_transactions
for each row execute function public.prevent_immutable_mutation();

drop trigger if exists trg_no_mutation_ledger_entries on public.ledger_entries;
create trigger trg_no_mutation_ledger_entries
before update or delete on public.ledger_entries
for each row execute function public.prevent_immutable_mutation();

create or replace function public.ledger_post_transaction(
  p_user_id uuid,
  p_unit text,
  p_source_type text,
  p_source_id uuid,
  p_external_ref text,
  p_description text,
  p_entries jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx_id uuid;
  v_total bigint := 0;
  v_item jsonb;
  v_amount bigint;
  v_account text;
begin
  if not (auth.uid() is not null or auth.role() = 'service_role') then
    raise exception 'Not authenticated';
  end if;

  if p_unit not in ('credits', 'usd_cents') then
    raise exception 'Invalid unit';
  end if;

  if p_source_type is null or btrim(p_source_type) = '' then
    raise exception 'Invalid source_type';
  end if;

  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then
    raise exception 'Entries must be an array with at least two records';
  end if;

  for v_item in select value from jsonb_array_elements(p_entries) loop
    v_account := coalesce(v_item->>'account_code', '');
    v_amount := coalesce((v_item->>'amount_minor')::bigint, 0);

    if btrim(v_account) = '' then
      raise exception 'Every entry requires account_code';
    end if;

    if v_amount = 0 then
      raise exception 'Entry amount cannot be zero';
    end if;

    v_total := v_total + v_amount;
  end loop;

  if v_total <> 0 then
    raise exception 'Unbalanced transaction: total must be zero';
  end if;

  insert into public.ledger_transactions (user_id, unit, source_type, source_id, external_ref, description, metadata)
  values (p_user_id, p_unit, p_source_type, p_source_id, nullif(btrim(coalesce(p_external_ref, '')), ''), p_description, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_tx_id;

  insert into public.ledger_entries (transaction_id, account_code, amount_minor, metadata)
  select
    v_tx_id,
    (entry.value->>'account_code')::text,
    (entry.value->>'amount_minor')::bigint,
    coalesce(entry.value->'metadata', '{}'::jsonb)
  from jsonb_array_elements(p_entries) as entry(value);

  return v_tx_id;
end;
$$;

create or replace function public.create_credit_topup_intent(
  p_provider text,
  p_package_credits integer,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  normalized_provider text := lower(trim(coalesce(p_provider, '')));
  normalized_credits integer := coalesce(p_package_credits, 0);
  normalized_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  amount_usd_cents integer;
  existing_intent record;
  created_intent record;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  if normalized_provider not in ('stripe', 'mercado_pago') then
    raise exception 'Unsupported provider';
  end if;

  if normalized_credits not in (1, 5, 10, 20, 50, 100, 500) then
    raise exception 'Invalid package';
  end if;

  if not exists (
    select 1 from public.payment_providers pp
    where pp.code = normalized_provider
      and pp.is_active = true
  ) then
    raise exception 'Provider unavailable';
  end if;

  amount_usd_cents := case normalized_credits
    when 1 then 99
    when 5 then 499
    when 10 then 899
    when 20 then 1899
    when 50 then 4799
    when 100 then 8999
    when 500 then 42999
  end;

  if normalized_key is not null then
    select *
    into existing_intent
    from public.payment_intents pi
    where pi.user_id = caller_id
      and pi.idempotency_key = normalized_key
    limit 1;

    if existing_intent.id is not null then
      return jsonb_build_object(
        'intent_id', existing_intent.id,
        'provider', existing_intent.provider,
        'status', existing_intent.status,
        'amount_minor', existing_intent.amount_minor,
        'currency', existing_intent.currency,
        'package_credits', existing_intent.package_credits,
        'reused', true
      );
    end if;
  end if;

  insert into public.payment_intents (
    user_id,
    provider,
    package_credits,
    amount_minor,
    currency,
    status,
    idempotency_key,
    metadata,
    created_at,
    updated_at
  )
  values (
    caller_id,
    normalized_provider,
    normalized_credits,
    amount_usd_cents,
    'USD',
    'created',
    normalized_key,
    coalesce(p_metadata, '{}'::jsonb),
    now(),
    now()
  )
  returning * into created_intent;

  return jsonb_build_object(
    'intent_id', created_intent.id,
    'provider', created_intent.provider,
    'status', created_intent.status,
    'amount_minor', created_intent.amount_minor,
    'currency', created_intent.currency,
    'package_credits', created_intent.package_credits,
    'reused', false
  );
end;
$$;

create or replace function public.record_payment_webhook_event(
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider, '')));
  normalized_event_id text := trim(coalesce(p_provider_event_id, ''));
  normalized_event_type text := trim(coalesce(p_event_type, ''));
  v_event_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden';
  end if;

  if normalized_provider not in ('stripe', 'mercado_pago') then
    raise exception 'Unsupported provider';
  end if;

  if normalized_event_id = '' then
    raise exception 'Invalid provider event id';
  end if;

  if normalized_event_type = '' then
    raise exception 'Invalid event type';
  end if;

  insert into public.payment_webhook_events (
    provider,
    provider_event_id,
    event_type,
    payload,
    status,
    received_at,
    created_at,
    updated_at
  )
  values (
    normalized_provider,
    normalized_event_id,
    normalized_event_type,
    coalesce(p_payload, '{}'::jsonb),
    'pending',
    now(),
    now(),
    now()
  )
  on conflict (provider, provider_event_id) do update
    set payload = excluded.payload,
        event_type = excluded.event_type,
        received_at = now(),
        updated_at = now()
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function public.finalize_payment_webhook_event(
  p_event_id uuid,
  p_status text,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(trim(coalesce(p_status, '')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden';
  end if;

  if normalized_status not in ('processed', 'ignored', 'failed') then
    raise exception 'Invalid status';
  end if;

  update public.payment_webhook_events
  set status = normalized_status,
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      processed_at = now(),
      updated_at = now()
  where id = p_event_id;
end;
$$;

create or replace function public.mark_payment_intent_succeeded(
  p_provider text,
  p_provider_intent_id text,
  p_provider_event_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider text := lower(trim(coalesce(p_provider, '')));
  normalized_provider_intent_id text := trim(coalesce(p_provider_intent_id, ''));
  normalized_provider_event_id text := nullif(trim(coalesce(p_provider_event_id, '')), '');
  intent_row public.payment_intents%rowtype;
  new_balance integer;
  ledger_tx_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden';
  end if;

  if normalized_provider not in ('stripe', 'mercado_pago') then
    raise exception 'Unsupported provider';
  end if;

  if normalized_provider_intent_id = '' then
    raise exception 'Invalid provider intent id';
  end if;

  select *
  into intent_row
  from public.payment_intents pi
  where pi.provider = normalized_provider
    and pi.provider_intent_id = normalized_provider_intent_id
  for update;

  if intent_row.id is null then
    raise exception 'Payment intent not found';
  end if;

  if intent_row.status = 'succeeded' then
    return jsonb_build_object(
      'intent_id', intent_row.id,
      'status', intent_row.status,
      'wallet_updated', false,
      'already_settled', true
    );
  end if;

  perform public.ensure_wallet_balance(intent_row.user_id);

  update public.wallet_balances
  set balance_credits = balance_credits + intent_row.package_credits,
      updated_at = now()
  where user_id = intent_row.user_id
  returning balance_credits into new_balance;

  update public.payment_intents
  set status = 'succeeded',
      settled_at = now(),
      updated_at = now(),
      metadata = coalesce(payment_intents.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
  where id = intent_row.id;

  insert into public.wallet_transactions (user_id, transaction_type, amount_credits, metadata)
  values (
    intent_row.user_id,
    'credit_purchase',
    intent_row.package_credits,
    jsonb_build_object(
      'source', 'payment_gateway',
      'provider', normalized_provider,
      'provider_intent_id', normalized_provider_intent_id,
      'provider_event_id', normalized_provider_event_id,
      'payment_intent_id', intent_row.id,
      'amount_minor', intent_row.amount_minor,
      'currency', intent_row.currency
    ) || coalesce(p_metadata, '{}'::jsonb)
  );

  ledger_tx_id := public.ledger_post_transaction(
    intent_row.user_id,
    'credits',
    'payment_intent',
    intent_row.id,
    normalized_provider_event_id,
    'Credit topup settled by payment provider',
    jsonb_build_array(
      jsonb_build_object('account_code', 'platform:credits_reserve', 'amount_minor', -intent_row.package_credits),
      jsonb_build_object('account_code', 'user:wallet_credits', 'amount_minor', intent_row.package_credits, 'metadata', jsonb_build_object('user_id', intent_row.user_id))
    ),
    jsonb_build_object(
      'provider', normalized_provider,
      'provider_intent_id', normalized_provider_intent_id,
      'payment_intent_id', intent_row.id
    ) || coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'intent_id', intent_row.id,
    'status', 'succeeded',
    'wallet_updated', true,
    'already_settled', false,
    'new_balance_credits', new_balance,
    'ledger_transaction_id', ledger_tx_id
  );
end;
$$;

grant select on public.payment_providers to anon, authenticated, service_role;
grant select on public.payment_customers to authenticated, service_role;
grant select on public.payment_intents to authenticated, service_role;
grant select on public.payment_webhook_events to authenticated, service_role;
grant select on public.ledger_transactions to authenticated, service_role;
grant select on public.ledger_entries to authenticated, service_role;

grant execute on function public.ledger_post_transaction(uuid, text, text, uuid, text, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.create_credit_topup_intent(text, integer, text, jsonb) to authenticated;
grant execute on function public.record_payment_webhook_event(text, text, text, jsonb) to service_role;
grant execute on function public.finalize_payment_webhook_event(uuid, text, text) to service_role;
grant execute on function public.mark_payment_intent_succeeded(text, text, text, jsonb) to service_role;
