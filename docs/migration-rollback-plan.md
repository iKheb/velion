# Plan de Rollback de Migraciones

Este documento define rollback por migracion critica para beta publica.

## Reglas
- Toda migracion nueva debe incluir estrategia de rollback antes de merge.
- Ninguna migracion se aplica en produccion sin snapshot/backup previo verificado.
- Si la migracion es destructiva, debe ir detras de feature flag y despliegue gradual.

## Matriz actual
- `202602280001_phase1_payments_ledger.sql`: rollback por restauracion de snapshot (cambia ledger y RPC criticas).
- `202603050001_phase1_payments_stripe_checkout_and_reconciliation.sql`: desactivar webhooks + restaurar snapshot + reprocesar eventos pendientes.
- `202603050002_phase2_payment_retry_state_machine.sql`: desactivar job de reconciliacion + revertir funciones de estado + restaurar snapshot si hay inconsistencia.
- `202603060001_phase3_solid_messaging.sql`: rollback por restauracion de snapshot y deshabilitar realtime para receipts si hay degradacion.
- `202603060002_phase4_feed_discovery.sql`: rollback por revert de funciones `get_ranked_feed` y `global_search` a version estable previa.
- `202603060003_search_reels_and_following_fix.sql`: rollback por revert puntual de funciones de feed/search.
- `20260306043711_history_alignment_noop.sql`: no-op; sin accion tecnica, solo reparar historial si aplica.
- `20260306043747_history_alignment_followup_noop.sql`: no-op; sin accion tecnica, solo reparar historial si aplica.

## Procedimiento corto
1. Congelar deploys y activar modo mitigacion (feature flags).
2. Ejecutar rollback SQL definido para la migracion impactada.
3. Si hay duda de integridad, restaurar snapshot completo.
4. Correr smoke + checks de pagos/mensajeria/feed.
5. Documentar incidente y accion preventiva.
