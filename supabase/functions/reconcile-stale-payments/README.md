# reconcile-stale-payments

Reconciliacion operativa de `payment_intents` con Stripe y transicion segura de reintentos.

## Deploy

```bash
supabase functions deploy reconcile-stale-payments --no-verify-jwt
```

## Variables requeridas

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`

## Seguridad

Soporta dos modos:

- `x-cron-secret: <PAYMENTS_RECONCILE_CRON_SECRET>` para ejecucion automatica.
- JWT de usuario admin (`Authorization: Bearer ...`) para ejecucion manual desde panel.

Si defines `PAYMENTS_RECONCILE_CRON_SECRET`, los jobs pueden ejecutarse sin JWT.

## Request

`POST /functions/v1/reconcile-stale-payments`

Body opcional:

```json
{
  "intent_id": "uuid-opcional",
  "minutes": 30,
  "limit": 100,
  "max_retries": 6
}
```

## Resultado

- Consulta estado actual en Stripe para intents pendientes/retrying.
- Marca `succeeded`/`failed` cuando corresponde.
- Si no hay estado final, mantiene `pending_webhook` o pasa a `retrying`.
- Ejecuta `reconcile_stale_payment_intents(...)` para empujar pendientes envejecidos a retry/failed de forma controlada.

