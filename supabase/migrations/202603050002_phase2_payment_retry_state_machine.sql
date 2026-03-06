-- Phase 2: payment intent retry state machine + robust statuses
-- Created at: 2026-03-05

alter table public.payment_intents
  add column if not exists retry_count integer not null default 0 check (retry_count >= 0),
  add column if not exists last_retry_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_webhook_received_at timestamptz;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'payment_intents_status_check'
      and conrelid = 'public.payment_intents'::regclass
  ) then
    alter table public.payment_intents drop constraint payment_intents_status_check;
  end if;

  alter table public.payment_intents
    add constraint payment_intents_status_check
    check (
      status in (
        'created',
        'pending',
        'pending_webhook',
        'retrying',
        'requires_action',
        'succeeded',
        'canceled',
        'failed'
      )
    );
end;
$$;

create index if not exists idx_payment_intents_retry_queue
  on public.payment_intents(status, next_retry_at asc, created_at asc)
  where status in ('retrying', 'pending_webhook', 'pending', 'requires_action', 'created');

create or replace function public.update_payment_intent_after_provider_session(
  p_intent_id uuid,
  p_provider_intent_id text,
  p_provider_checkout_id text,
  p_status text default 'pending_webhook',
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(trim(coalesce(p_status, 'pending_webhook')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden';
  end if;

  if normalized_status not in ('created', 'pending', 'pending_webhook', 'retrying', 'requires_action', 'succeeded', 'canceled', 'failed') then
    raise exception 'Invalid status';
  end if;

  update public.payment_intents
  set provider_intent_id = nullif(trim(coalesce(p_provider_intent_id, '')), ''),
      provider_checkout_id = nullif(trim(coalesce(p_provider_checkout_id, '')), ''),
      status = normalized_status,
      metadata = coalesce(payment_intents.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      next_retry_at = case
        when normalized_status in ('pending_webhook', 'pending', 'requires_action') then coalesce(payment_intents.next_retry_at, now())
        else payment_intents.next_retry_at
      end,
      updated_at = now()
  where id = p_intent_id;
end;
$$;

create or replace function public.mark_payment_intent_failed(
  p_provider text,
  p_provider_intent_id text,
  p_provider_event_id text default null,
  p_error_message text default null,
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
      'already_final', true
    );
  end if;

  if intent_row.status in ('failed', 'canceled') then
    return jsonb_build_object(
      'intent_id', intent_row.id,
      'status', intent_row.status,
      'already_final', true
    );
  end if;

  update public.payment_intents
  set status = 'failed',
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      metadata = coalesce(payment_intents.metadata, '{}'::jsonb)
        || jsonb_build_object('provider_event_id', normalized_provider_event_id)
        || coalesce(p_metadata, '{}'::jsonb),
      next_retry_at = null,
      updated_at = now(),
      last_webhook_received_at = case when normalized_provider_event_id is not null then now() else payment_intents.last_webhook_received_at end
  where id = intent_row.id;

  return jsonb_build_object(
    'intent_id', intent_row.id,
    'status', 'failed',
    'already_final', false
  );
end;
$$;

create or replace function public.mark_payment_intent_succeeded_by_intent_id(
  p_intent_id uuid,
  p_provider_event_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_provider_event_id text := nullif(trim(coalesce(p_provider_event_id, '')), '');
  intent_row public.payment_intents%rowtype;
  new_balance integer;
  ledger_tx_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden';
  end if;

  select *
  into intent_row
  from public.payment_intents pi
  where pi.id = p_intent_id
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
      next_retry_at = null,
      error_message = null,
      updated_at = now(),
      last_webhook_received_at = case when normalized_provider_event_id is not null then now() else payment_intents.last_webhook_received_at end,
      metadata = coalesce(payment_intents.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
  where id = intent_row.id;

  insert into public.wallet_transactions (user_id, transaction_type, amount_credits, metadata)
  values (
    intent_row.user_id,
    'credit_purchase',
    intent_row.package_credits,
    jsonb_build_object(
      'source', 'payment_gateway',
      'provider', intent_row.provider,
      'provider_intent_id', intent_row.provider_intent_id,
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
      'provider', intent_row.provider,
      'provider_intent_id', intent_row.provider_intent_id,
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

create or replace function public.mark_payment_intent_retrying(
  p_intent_id uuid,
  p_error_message text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_retry_delay_minutes integer default 5,
  p_max_retries integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_delay integer := greatest(1, least(coalesce(p_retry_delay_minutes, 5), 240));
  normalized_max_retries integer := greatest(1, least(coalesce(p_max_retries, 6), 20));
  intent_row public.payment_intents%rowtype;
  next_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden';
  end if;

  select *
  into intent_row
  from public.payment_intents pi
  where pi.id = p_intent_id
  for update;

  if intent_row.id is null then
    raise exception 'Payment intent not found';
  end if;

  if intent_row.status in ('succeeded', 'canceled', 'failed') then
    return jsonb_build_object(
      'intent_id', intent_row.id,
      'status', intent_row.status,
      'already_final', true
    );
  end if;

  next_count := coalesce(intent_row.retry_count, 0) + 1;

  if next_count >= normalized_max_retries then
    update public.payment_intents
    set status = 'failed',
        retry_count = next_count,
        last_retry_at = now(),
        next_retry_at = null,
        error_message = coalesce(nullif(trim(coalesce(p_error_message, '')), ''), 'Max retries reached'),
        metadata = coalesce(payment_intents.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = intent_row.id;

    return jsonb_build_object(
      'intent_id', intent_row.id,
      'status', 'failed',
      'retry_count', next_count,
      'max_retries_reached', true
    );
  end if;

  update public.payment_intents
  set status = 'retrying',
      retry_count = next_count,
      last_retry_at = now(),
      next_retry_at = now() + make_interval(mins => normalized_delay),
      error_message = nullif(trim(coalesce(p_error_message, '')), ''),
      metadata = coalesce(payment_intents.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
  where id = intent_row.id;

  return jsonb_build_object(
    'intent_id', intent_row.id,
    'status', 'retrying',
    'retry_count', next_count,
    'max_retries_reached', false
  );
end;
$$;

drop function if exists public.reconcile_stale_payment_intents(integer, integer);

create or replace function public.reconcile_stale_payment_intents(
  p_minutes integer default 30,
  p_limit integer default 500,
  p_max_retries integer default 6
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_minutes integer := greatest(5, least(coalesce(p_minutes, 30), 1440));
  normalized_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  normalized_max_retries integer := greatest(1, least(coalesce(p_max_retries, 6), 20));
  candidate record;
  result jsonb;
  marked_retrying integer := 0;
  marked_failed integer := 0;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'Forbidden';
  end if;

  for candidate in
    select pi.id
    from public.payment_intents pi
    where pi.status in ('created', 'pending', 'pending_webhook', 'requires_action', 'retrying')
      and (
        (pi.status = 'retrying' and coalesce(pi.next_retry_at, pi.created_at) <= now())
        or (pi.status <> 'retrying' and pi.created_at < now() - make_interval(mins => normalized_minutes))
      )
    order by pi.created_at asc
    limit normalized_limit
  loop
    select public.mark_payment_intent_retrying(
      candidate.id,
      'Timed out waiting for webhook confirmation',
      jsonb_build_object('source', 'stale_reconciliation'),
      5,
      normalized_max_retries
    )
    into result;

    if coalesce(result ->> 'status', '') = 'failed' then
      marked_failed := marked_failed + 1;
    elsif coalesce(result ->> 'status', '') = 'retrying' then
      marked_retrying := marked_retrying + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'minutes', normalized_minutes,
    'limit', normalized_limit,
    'max_retries', normalized_max_retries,
    'marked_retrying', marked_retrying,
    'marked_failed', marked_failed
  );
end;
$$;

grant execute on function public.mark_payment_intent_retrying(uuid, text, jsonb, integer, integer) to service_role;
grant execute on function public.reconcile_stale_payment_intents(integer, integer, integer) to authenticated, service_role;

