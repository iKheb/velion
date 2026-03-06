# Incident Runbook (Beta Publica)

## Sev y SLA
- Sev-1: caida total auth/feed/pagos. ACK < 5 min, mitigacion < 30 min.
- Sev-2: degradacion parcial o errores altos en modulo clave. ACK < 15 min, mitigacion < 2 h.
- Sev-3: impacto menor sin perdida de datos. ACK < 4 h.

## Alertas minimas
- 5xx por encima de umbral por 5 min.
- fallos de auth por encima de umbral por 5 min.
- errores de webhook/pagos por encima de umbral.
- backlog de reportes abiertos > umbral operativo.

## Flujo operativo
1. Detectar y clasificar severidad.
2. Abrir incidente con timestamp, owner y modulo afectado.
3. Mitigar rapido: feature flag, rollback, desactivar jobs, throttle temporal.
4. Validar salud: login, home, perfil, pagos, mensajeria.
5. Comunicar estado cada 15 min (Sev-1) o 30 min (Sev-2).
6. Cerrar incidente con RCA y acciones preventivas.

## Health checks obligatorios post-mitigacion
- `/login` carga y permite autenticacion.
- `/` (home) renderiza sin errores en consola.
- `/profile/:username` responde y respeta permisos.
- pago de prueba y webhook en estado consistente.
- envio y recepcion de mensaje en chat.
