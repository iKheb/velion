# Payment Webhook (Fase 1)

Endpoint edge function para registrar webhooks de pagos y aplicar acreditacion idempotente cuando corresponde.

## Variables requeridas
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYMENT_WEBHOOK_TOKEN` (opcional, recomendado)

## Deploy
```bash
supabase functions deploy payment-webhook --no-verify-jwt
```

## Request esperado
`POST /functions/v1/payment-webhook`

```json
{
  "provider": "stripe",
  "event_id": "evt_123",
  "event_type": "payment_intent.succeeded",
  "payload": {
    "data": {
      "object": {
        "id": "pi_123"
      }
    }
  }
}
```

Header opcional de proteccion:
- `x-webhook-token: <PAYMENT_WEBHOOK_TOKEN>`

## Comportamiento
1. Registra evento en `public.payment_webhook_events` por `provider + event_id`.
2. Intenta detectar `provider_intent_id` en payload.
3. Si el evento es de exito de pago, ejecuta `public.mark_payment_intent_succeeded(...)`.
4. Cierra el evento como `processed`, `ignored` o `failed`.

## Notas
- La validacion criptografica de firma de Stripe/Mercado Pago queda para el siguiente paso de esta fase.
- Este handler ya deja trazabilidad e idempotencia en base de datos.
