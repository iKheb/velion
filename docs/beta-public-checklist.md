# Beta Publica - Checklist Operativo

## 0) Gate de release (bloqueante)
- CI en verde (`lint`, `typecheck`, `test`, `build`).
- `npm run beta:gate` en verde.
- Secrets de validacion de migraciones cargados en GitHub Actions:
  - `MIGRATION_VALIDATE_EMPTY_DB_URL`
  - `MIGRATION_VALIDATE_EXISTING_DB_URL`

## 1) Moderacion end-to-end
- Confirmar flujo de reporte para `post`, `story`, `reel` y `profile`.
- Verificar en admin:
  - listado de reportes abiertos,
  - cambio de estado (`open`, `reviewed`, `dismissed`),
  - accion de moderacion sobre entidad reportada.
- Prueba minima:
  - usuario A reporta contenido de usuario B,
  - admin lo ve y cambia estado,
  - estado se refleja al recargar.

## 2) Seguridad operativa
- RLS:
  - ejecutar `npm run schema:check` (RLS habilitado por tabla `public.*`).
  - ejecutar `npm run security:audit` (auditoria de `grant anon`, politicas `select` y buckets).
- Secretos frontend:
  - ejecutar `npm run frontend:secrets:check`.
  - confirmar que no existe `service_role` en variables `VITE_*`.
- Rate limit cliente (ya aplicado):
  - auth: login, signup, recovery,
  - reportes: post/story/reel/profile,
  - chat: mensajes y media.
- Rate limit backend:
  - habilitar rate limits por IP/user en edge/WAF del proveedor.
  - revisar limites de RPC anti-spam (`send_chat_message`) y monitorear rechazos.
- Claves y secretos:
  - NO exponer `service_role` en frontend.
  - Rotar `service_role` y JWT secret antes de beta publica.
  - Guardar claves en vault del proveedor y restringir acceso por entorno.

## 3) Observabilidad minima
- Frontend:
  - errores globales (`window.error`, `unhandledrejection`) capturados,
  - errores de `ErrorBoundary` y `RouteErrorBoundary` capturados.
- Backend/logs:
  - habilitar endpoint de logs de cliente con `VITE_CLIENT_LOG_ENDPOINT` (opcional),
  - revisar logs de Supabase (Auth, Database, Functions) diariamente en beta.
- Alertas minimas:
  - 5xx > umbral por 5 min,
  - fallos de auth > umbral por 5 min.

## 4) QA regresion (movil + desktop)
- Feed:
  - cargar feed, like/comentario/share/guardar, reportar.
- Perfil:
  - ver perfil, editar perfil, reportar perfil, permisos de visibilidad.
- Media:
  - subir imagen/video en post/story/reel y validar reproduccion.
- Chat:
  - enviar texto, imagen/video/audio, recibir en tiempo real.
- Streams:
  - listado, detalle de stream, chat en vivo.
- Reportes/Admin:
  - crear reporte desde UI y resolverlo en admin.
- E2E minimo automatizado:
  - ejecutar `npm run test:e2e` con `E2E_EMAIL` y `E2E_PASSWORD` de cuenta de pruebas.

## 5) Legal minimo visible
- Rutas publicas activas:
  - `/terms`
  - `/privacy`
- Enlace visible desde login a:
  - Terminos
  - Privacidad
  - Soporte

## 6) Rollback y backup
- Migraciones versionadas:
  - cada cambio SQL en archivo versionado antes de deploy (`supabase/migrations`).
- Validacion de migraciones:
  - ejecutar `npm run migrations:validate` (estructura + DB vacia + DB existente en CI).
- Backup previo:
  - snapshot completo de DB antes de release.
- Plan de rollback:
  - seguir `docs/migration-rollback-plan.md`,
  - redeploy del ultimo build estable,
  - restaurar snapshot o ejecutar migracion inversa de la migracion afectada,
  - validar rutas criticas y auth post-rollback.

## 7) Operacion y legal (bloqueante)
- Runbook de incidentes actualizado: `docs/incident-runbook.md`.
- Operativa de moderacion y trazabilidad: `docs/moderation-operations.md`.
- Legal ready: `docs/legal-readiness.md`.
- Feature flags de apagado rapido definidas y probadas: `docs/feature-flags.md`.
