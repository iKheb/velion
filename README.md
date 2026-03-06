# Velion

Plataforma hibrida social + streaming gamer construida con React, Vite, TypeScript, Tailwind y Supabase.

## Stack
- Frontend: React + Vite + TypeScript + Tailwind + Framer Motion + Zustand + React Router
- Backend: Supabase (Auth email/password, Postgres, Realtime, Storage, Edge Functions)

## Inicio rapido
1. Instala dependencias:
   - `npm install`
2. Variables de entorno:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_CLIENT_LOG_ENDPOINT` (opcional)
   - `VITE_SENTRY_DSN` (opcional)
   - `VITE_FF_STREAMS`, `VITE_FF_WALLET`, `VITE_FF_MODERATION`, `VITE_FF_SEARCH`, `VITE_FF_SUPPORT`
3. Aplica migraciones de `supabase/migrations` (fuente de verdad de deploy).
4. Levanta app:
   - `npm run dev`

## Estructura
```txt
src/
  components/
  features/
  layouts/
  pages/
  hooks/
  services/
  store/
  lib/
```

## Dominios
- auth
- social
- streaming
- chat
- notifications

## Produccion
- `npm run build`
- PWA basica habilitada con `vite-plugin-pwa`.

## Calidad (Fase 1)
- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run check` (ejecuta lint + typecheck + tests + build)
- CI en GitHub Actions: `.github/workflows/ci.yml`

## Release Ops (Fase 4)
- `npm run smoke:preview` (smoke sobre build servido por `vite preview`)
- `npm run release:check` (quality + smoke)
- `npm run beta:gate` (security + migrations + artifacts + quality + smoke)
- Workflow: `.github/workflows/release-readiness.yml`
- Runbook: `docs/release-runbook.md`
- Checklist beta publica: `docs/beta-public-checklist.md`

## Data Guardrails (Fase 5)
- `npm run schema:check` valida orden de migracion en `supabase/schema.sql`
- `npm run check` ahora incluye `schema:check` antes de lint/typecheck/tests/build

## Data Guardrails+ (Fase 6)
- `schema:check` ahora tambien detecta duplicados de `create table`, `create function` y `create policy`

## Data Guardrails++ (Fase 7)
- `schema:check` bloquea grants anonimos globales (`all tables` y `default privileges`)
- `supabase/schema.sql` declara `pgcrypto` para garantizar `gen_random_uuid()`

## Data Guardrails+++ (Fase 8)
- `schema:check` detecta `alter table ... add column` redundante cuando la columna ya existe en `create table`
- Se eliminaron alteraciones redundantes en `supabase/schema.sql` para mantener migraciones limpias

## Security y Migraciones (Fase 9)
- `npm run frontend:secrets:check` bloquea uso de `service_role` en frontend
- `npm run security:audit` audita grants anonimos, RLS y storage buckets/policies
- `npm run migrations:validate` valida formato/orden de migraciones y ejecuta validacion en DB vacia + existente (CI)
- rollback por migracion: `docs/migration-rollback-plan.md`

## Admin Alerts Automation
- Edge Function: `supabase/functions/sync-admin-alerts`
- Ejecuta `public.sync_admin_alerts(range_days)` desde backend (`service_role`)
- Ver `supabase/functions/sync-admin-alerts/README.md` para deploy y `pg_cron`.

## Payments Foundation (Fase 1)
- Migracion: `supabase/migrations/202602280001_phase1_payments_ledger.sql`
- Migracion extension Stripe/reconciliacion: `supabase/migrations/202603050001_phase1_payments_stripe_checkout_and_reconciliation.sql`
- Migracion estado robusto + retries: `supabase/migrations/202603050002_phase2_payment_retry_state_machine.sql`
- Webhook: `supabase/functions/payment-webhook`
- Checkout: `supabase/functions/create-stripe-checkout`
- Reconciliacion: `supabase/functions/reconcile-payment-intent`
- Reconciliacion operativa (cron/admin): `supabase/functions/reconcile-stale-payments`
- Guia: `docs/payments-phase1.md`
