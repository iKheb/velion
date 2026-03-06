# sync-admin-alerts (Edge Function)

Sincroniza alertas administrativas llamando `public.sync_admin_alerts(range_days)`.

## Request
- Method: `POST`
- Body opcional:
```json
{
  "ranges": [1, 7, 30]
}
```

Si no envias `ranges`, usa `[1,7,30]`.

## Variables de entorno
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SYNC_ALERTS_CRON_SECRET` (opcional pero recomendado)

## Deploy
```bash
supabase functions deploy sync-admin-alerts
supabase secrets set SYNC_ALERTS_CRON_SECRET=tu_secreto_fuerte
```

## Ejemplo de schedule (SQL Editor)
```sql
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'velion-sync-admin-alerts-every-5m',
  '*/5 * * * *',
  $$
  select
    net.http_post(
      url := 'https://<PROJECT-REF>.functions.supabase.co/sync-admin-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '<SYNC_ALERTS_CRON_SECRET>'
      ),
      body := '{"ranges":[1,7,30]}'::jsonb
    );
  $$
);
```
