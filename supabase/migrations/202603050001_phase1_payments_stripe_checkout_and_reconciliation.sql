-- Phase 1 extension: real Stripe checkout + reconciliation helpers
-- Created at: 2026-03-05

create or replace function public.update_payment_intent_after_provider_session(
  p_intent_id uuid,
  p_provider_intent_id text,
  p_provider_checkout_id text,
  p_status text default 'pending',
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(trim(coalesce(p_status, 'pending')));
begin
  if auth.role() <> 'service_role' then
    raise exception 'Forbidden';
  end if;

  if normalized_status not in ('created', 'pending', 'requires_action', 'succeeded', 'canceled', 'failed') then
    raise exception 'Invalid status';
  end if;

  update public.payment_intents
  set provider_intent_id = nullif(trim(coalesce(p_provider_intent_id, '')), ''),
      provider_checkout_id = nullif(trim(coalesce(p_provider_checkout_id, '')), ''),
      status = normalized_status,
      metadata = coalesce(payment_intents.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
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
      updated_at = now()
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

create or replace function public.reconcile_stale_payment_intents(
  p_minutes integer default 30,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_minutes integer := greatest(5, least(coalesce(p_minutes, 30), 1440));
  normalized_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  affected integer := 0;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'Forbidden';
  end if;

  with stale as (
    select id
    from public.payment_intents
    where status in ('created', 'pending', 'requires_action')
      and created_at < now() - make_interval(mins => normalized_minutes)
    order by created_at asc
    limit normalized_limit
  )
  update public.payment_intents pi
  set status = 'failed',
      error_message = coalesce(pi.error_message, 'Timed out waiting for webhook'),
      updated_at = now()
  where pi.id in (select id from stale);

  get diagnostics affected = row_count;

  return jsonb_build_object(
    'minutes', normalized_minutes,
    'limit', normalized_limit,
    'marked_failed', affected
  );
end;
$$;

grant execute on function public.update_payment_intent_after_provider_session(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.mark_payment_intent_failed(text, text, text, text, jsonb) to service_role;
grant execute on function public.mark_payment_intent_succeeded_by_intent_id(uuid, text, jsonb) to service_role;
grant execute on function public.reconcile_stale_payment_intents(integer, integer) to authenticated, service_role;
