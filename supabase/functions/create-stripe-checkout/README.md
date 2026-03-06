# create-stripe-checkout

Crea una sesion real de Stripe Checkout para una recarga de creditos.

## Deploy
```bash
supabase functions deploy create-stripe-checkout --no-verify-jwt
```

## Env vars
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`

## Request
`POST /functions/v1/create-stripe-checkout`

```json
{
  "package_credits": 10,
  "idempotency_key": "uuid-opcional",
  "success_url": "https://app.velion.com/store?topup_intent=...&topup_status=success",
  "cancel_url": "https://app.velion.com/store?topup_intent=...&topup_status=cancel"
}
```
