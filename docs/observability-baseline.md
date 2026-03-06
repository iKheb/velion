# Observabilidad Base para Beta

## Error tracking
- Frontend: `VITE_SENTRY_DSN` o proveedor equivalente habilitado en produccion.
- Backend (Edge Functions): capturar errores con contexto (function, user_id, correlation_id).

## Logs estructurados
- Formato JSON obligatorio para RPC/flows criticos:
  - mensajeria (`send_chat_message`, receipts),
  - pagos (checkout, webhook, reconciliacion),
  - moderacion (reports, acciones admin).
- Campos minimos:
  - `timestamp`
  - `module`
  - `action`
  - `status`
  - `user_id` (si aplica)
  - `correlation_id`
  - `error_code` y `error_message` (si falla)

## Dashboards y alertas
- Error rate global y por modulo.
- Latencia p95 de funciones criticas.
- Fallos de webhook/pago.
- Reportes abiertos y tiempo medio de resolucion.

## Health checks
- Ruta web: `/`, `/login`, `/privacy`, `/terms`.
- Flujos criticos: login, carga de home, perfil, envio de mensaje, webhook de pago.
