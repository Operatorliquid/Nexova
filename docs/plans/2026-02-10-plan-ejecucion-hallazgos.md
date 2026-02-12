# Plan de ejecucion - resolver hallazgos (10 feb 2026)

## Objetivo
Resolver todos los hallazgos del code review sin romper el comportamiento actual.

## Alcance
- API, worker, agent-runtime y dashboard.
- Mantener compatibilidad con clientes actuales.

## Plan de trabajo (checklist)
1. [x] Permisos: proteger ajustes de ledger con permiso admin.
2. [x] Webhooks: persistir delivery reports de Infobip.
3. [x] Payments: reemplazar `create_payment_link` placeholder por integracion MP real.
4. [x] Memoria: redaccion PII antes de persistir memorias.
5. [x] Cobranza: aplicar cutoff/antiguedad minima en recordatorios de deuda.
6. [x] Webhooks debug/catch-all: restringir a desarrollo o feature flag.
7. [x] Ordenes: evitar colisiones de `orderNumber` en concurrencia.
8. [x] Auth: migrar tokens a cookies httpOnly en dashboard y API (manteniendo compatibilidad).
9. [x] Documentacion: marcar hallazgos resueltos y registrar pruebas.

## Criterios de aceptacion
- No se pierden mensajes ni se duplican eventos.
- Integraciones sensibles quedan protegidas por permisos.
- Links de pago MP son reales o fallan con mensaje claro si no hay conexion.
- La memoria no guarda PII identificable.
- El dashboard funciona con cookies y sigue soportando headers existentes.

## Pruebas sugeridas
- Crear orden concurrente (2 requests simultaneas) y verificar no hay colision.
- Enviar mensaje y verificar delivery report registra evento.
- Generar link MP con integracion conectada y validar URL real.
- Verificar que un usuario sin permisos no puede ajustar ledger.
- Verificar que recordatorio no sale antes del `firstReminderDays`.
