# Release Runbook (Fase 4)

## Objetivo
Validar build, calidad y comportamiento base de la app antes de publicar, con un plan de rollback claro.

## Checklist de salida
1. Sin cambios pendientes de SQL en `supabase/schema.sql` sin aplicar en el entorno objetivo.
2. `npm ci` ejecutado correctamente.
3. `npm run beta:gate` en verde.
4. Variables de entorno de produccion verificadas:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_CLIENT_LOG_ENDPOINT` (opcional, recomendado)
   - `VITE_SENTRY_DSN` (opcional)
   - `VITE_FF_STREAMS`
   - `VITE_FF_WALLET`
   - `VITE_FF_MODERATION`
   - `VITE_FF_SEARCH`
   - `VITE_FF_SUPPORT`
5. Secrets de validacion DB en GitHub Actions:
   - `MIGRATION_VALIDATE_EMPTY_DB_URL`
   - `MIGRATION_VALIDATE_EXISTING_DB_URL`
6. Workflow `Release Readiness` en GitHub Actions en estado successful.
7. Artefacto `velion-dist` generado y descargable.
8. Checklist de beta publica revisado: `docs/beta-public-checklist.md`.

## Smoke test incluido
`npm run smoke:preview` valida:
- Arranque de `vite preview` en `http://127.0.0.1:4173`
- Carga correcta de rutas criticas:
  - `/`
  - `/login`
  - `/messages`
  - `/streaming`
  - `/support`
- Presencia de `id="root"` en HTML para confirmar bootstrap del frontend.

## Procedimiento de release
1. Ejecutar local: `npm run beta:gate` (si no hay URLs de validacion DB, al menos correr `npm run release:check` y `npm run migrations:validate` en entorno CI).
2. Verificar rotacion de credenciales sensibles (especialmente `service_role`) y permisos en vault.
3. Tomar backup/snapshot de DB antes de aplicar cambios.
4. Merge a `main`.
5. Confirmar `Release Readiness` en GitHub Actions.
6. Publicar artefacto `dist` en el hosting objetivo.
7. Monitorear 5xx y errores de auth durante las primeras 2 horas.

## Rollback
1. Revertir deployment al ultimo artefacto estable.
2. Si hubo cambios en SQL:
   - seguir `docs/migration-rollback-plan.md` para la migracion afectada, o
   - restaurar snapshot/backup de DB previo a release.
3. Validar rutas criticas con `npm run smoke:preview` contra el build rollback.
4. Documentar causa raiz y accion correctiva antes del siguiente intento.
5. Rotar nuevamente credenciales si el incidente involucro filtracion o acceso indebido.
