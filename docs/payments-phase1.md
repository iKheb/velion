# Fase 1: Pagos Reales + Ledger Inmutable

## Alcance implementado
- Base de pagos multi-proveedor (`stripe`, `mercado_pago`).
- Registro idempotente de intents de recarga (`payment_intents`).
- Registro idempotente de webhooks (`payment_webhook_events`).
- Libro mayor inmutable con partidas balanceadas (`ledger_transactions`, `ledger_entries`).
- RPC para:
  - `create_credit_topup_intent(...)`
  - `record_payment_webhook_event(...)`
  - `mark_payment_intent_succeeded(...)`
  - `mark_payment_intent_succeeded_by_intent_id(...)`
  - `mark_payment_intent_failed(...)`
  - `update_payment_intent_after_provider_session(...)`
  - `reconcile_stale_payment_intents(...)`
  - `ledger_post_transaction(...)`
- Edge functions:
  - `payment-webhook`
  - `create-stripe-checkout`
  - `reconcile-payment-intent`
  - `reconcile-stale-payments`

## Archivos de migracion
- `supabase/migrations/202602280001_phase1_payments_ledger.sql`
- `supabase/migrations/202603050001_phase1_payments_stripe_checkout_and_reconciliation.sql`
- `supabase/migrations/202603050002_phase2_payment_retry_state_machine.sql`

## Orden de aplicacion
1. Aplicar migraciones SQL en entorno objetivo.
2. Deploy edge functions:
   - `payment-webhook`
   - `create-stripe-checkout`
   - `reconcile-payment-intent`
   - `reconcile-stale-payments`
3. Configurar secretos:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `STRIPE_SECRET_KEY`
   - `PAYMENT_WEBHOOK_TOKEN` (recomendado)
   - `PAYMENTS_RECONCILE_CRON_SECRET` (opcional, recomendado para job automatico)
4. Configurar Stripe para enviar webhooks al endpoint.

## Flujo tecnico
1. Frontend inicia checkout con `create-stripe-checkout`.
2. Se crea (o reutiliza) `payment_intent` idempotente.
3. Stripe Checkout procesa el pago.
4. Webhook entra por `payment-webhook`.
5. Settlement acredita wallet y escribe asiento inmutable en ledger.
6. Si webhook se retrasa, frontend puede ejecutar `reconcile-payment-intent`.
7. Job backend/admin puede ejecutar `reconcile-stale-payments` para conciliacion masiva y reintentos seguros.

## Estados robustos
- `pending_webhook`: checkout completado, pendiente confirmacion del proveedor.
- `retrying`: reconcilacion manual en curso.
- `retrying`: reintento de conciliacion programado por timeout o error transitorio.
- `failed`: pago rechazado/expirado/no confirmado.

## Reintento seguro
- `idempotency_key` evita duplicar intents.
- Settlement es idempotente: si ya fue acreditado, no vuelve a acreditar.
- Reintentos de conciliacion no duplican movimientos en wallet ni ledger.

## Modelo contable
- `unit` separa contabilidad de `credits` vs `usd_cents`.
- `ledger_post_transaction` exige suma total `0`.
- `ledger_transactions` y `ledger_entries` son append-only (sin update/delete).
