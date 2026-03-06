# Feature Flags Operativas

Flags de apagado rapido para beta:

- `VITE_FF_STREAMS` (default `true`)
- `VITE_FF_WALLET` (default `true`)
- `VITE_FF_MODERATION` (default `true`)
- `VITE_FF_SEARCH` (default `true`)
- `VITE_FF_SUPPORT` (default `true`)

Implementacion: `src/config/feature-flags.ts`.

Uso recomendado:
1. Mantener flags en proveedor de deploy por entorno.
2. Desactivar modulo afectado durante incidentes Sev-1/Sev-2.
3. Registrar toda activacion/desactivacion en bitacora de incidentes.
