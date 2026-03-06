# Moderacion y Soporte Operativo

## SLA de reportes
- Critico (riesgo inmediato): revision < 30 min.
- Alto (acoso, fraude, contenido sensible): revision < 4 h.
- Normal: revision < 24 h.

## Cola de revision
1. Priorizar por severidad, volumen y recurrencia de usuario.
2. Registrar decision por caso: `reviewed` o `dismissed`.
3. Si aplica accion, registrar actor, motivo y evidencia.

## Acciones disponibles
- Ocultar/eliminar contenido.
- Ban temporal o permanente de perfil.
- Limitar interacciones (chat, comentarios, follow) por periodo.

## Trazabilidad minima
- id de reporte
- moderador responsable
- timestamp de decision
- razon de decision
- accion ejecutada
- evidencia referenciada

## Canal de apelaciones
- Entrada por soporte (`/support`) categoria `safety_report`.
- Respuesta inicial < 48 h.
- Decision final documentada y auditable.
