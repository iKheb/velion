# reconcile-payment-intent

Conciliacion manual de un `payment_intent` contra Stripe Checkout.

## Deploy
```bash
supabase functions deploy reconcile-payment-intent --no-verify-jwt
```

## Env vars
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`

## Request
`POST /functions/v1/reconcile-payment-intent`

```json
{
  "intent_id": "uuid"
}
```
