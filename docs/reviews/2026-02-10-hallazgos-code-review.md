# Hallazgos de code review (10 feb 2026)

**Estado:** Actualizado (hallazgos + estado actual)

## Alcance revisado
- apps/worker/src/main.ts
- apps/worker/src/jobs/outbox-relay.job.ts
- apps/worker/src/jobs/webhook-retry.job.ts
- apps/worker/src/jobs/debt-reminder.job.ts
- apps/api/src/routes/v1/webhook.routes.ts
- apps/api/src/routes/v1/orders.routes.ts
- apps/api/src/routes/v1/auth.routes.ts
- apps/api/src/plugins/auth.plugin.ts
- apps/dashboard/src/lib/api.ts
- apps/dashboard/src/contexts/AuthContext.tsx
- packages/agent-runtime/src/tools/retail/commerce.tools.ts
- packages/agent-runtime/src/tools/retail/payment.tools.ts
- packages/agent-runtime/src/tools/retail/index.ts
- packages/agent-runtime/src/core/memory-service.ts
- packages/agent-runtime/src/worker/agent-worker.ts

## Hallazgos
1. **[P1] Mensajes entrantes se pierden cuando el agente está inactivo**
   - **Archivo:** packages/agent-runtime/src/worker/agent-worker.ts (aprox. 380-395)
   - **Detalle:** Si `agentActive` es `false`, se marca el webhook como completado y se retorna sin persistir el inbound en `agent_messages`. Esto rompe el historial durante el takeover humano.
   - **Impacto:** Pérdida de mensajes del cliente.
   - **Propuesta (pendiente de decisión):** Persistir siempre el inbound y actualizar `lastActivityAt`/notificaciones aun con agente pausado.

2. **[P1] Outbox relay no publica `message.sent`**
   - **Archivos:**
     - apps/worker/src/main.ts (aprox. 235-249)
     - packages/agent-runtime/src/worker/agent-worker.ts (aprox. 815-828)
     - apps/worker/src/jobs/outbox-relay.job.ts (consume `pending`)
   - **Detalle:** Se insertan eventos con `status = published`, pero el relay solo procesa `pending`. Resultado: no hay publicación a Redis realtime.
   - **Impacto:** Eventos no emitidos.
   - **Propuesta (pendiente de decisión):**
     - Opción A: insertar `pending` y dejar que el relay publique.
     - Opción B: publicar inmediato y saltar el relay para esos eventos.

3. **[P2] Reintento de webhook puede quedar huérfano sin `correlationId`**
   - **Archivo:** apps/worker/src/jobs/webhook-retry.job.ts (aprox. 54-75)
   - **Detalle:** Si `webhook.correlationId` es `null`, se genera uno nuevo en el job de retry pero no se persiste en `webhook_inbox`. El `AgentWorker` busca por `correlationId` y no encuentra el registro.
   - **Impacto:** Webhooks pendientes que nunca se procesan.
   - **Propuesta (pendiente de decisión):** persistir el `correlationId` en la fila, o buscar por `webhook.id`/`externalId`.

4. **[P2] Dedupe ignora proveedor**
   - **Archivo:** apps/api/src/routes/v1/webhook.routes.ts (aprox. 161-167)
   - **Detalle:** La deduplicación solo filtra por `externalId + workspaceId`. Si hay múltiples proveedores, un `messageId` colisionado podría descartarse.
   - **Impacto:** Pérdida de eventos válidos en escenarios multi-proveedor.
   - **Propuesta (pendiente de decisión):** incluir `provider` (ej. `infobip`) en el where.

5. **[P3] Job repetible de recordatorio de deuda puede duplicarse en reinicios**
   - **Archivo:** apps/worker/src/main.ts (aprox. 366-375)
   - **Detalle:** El repeatable job no fija `jobId`. En reinicios, BullMQ puede registrar duplicados.
   - **Impacto:** Recordatorios duplicados.
   - **Propuesta (pendiente de decisión):** definir `jobId` estable (como otros jobs repetibles).

## Estado de hallazgos anteriores
- [Resuelto] Mensajes entrantes con agente inactivo ahora se persisten + `lastActivityAt` actualizado.
- [Resuelto] Eventos `message.sent` ahora se insertan como `pending` para que el relay publique.
- [Resuelto] Retry de webhooks persiste `correlationId` si faltaba.
- [Resuelto] Dedupe ahora incluye `provider`.
- [Resuelto] Job de recordatorio de deuda tiene `jobId` estable.

## Hallazgos adicionales (revisión completa)
1. **[P1] Ajustes de ledger sin control admin**
   - **Archivo:** apps/api/src/routes/v1/integrations.routes.ts (aprox. 1515)
   - **Detalle:** El endpoint `POST /integrations/ledger/adjustment` solo requiere autenticación, pero no valida permisos admin.
   - **Impacto:** Cualquier usuario autenticado podría crear ajustes de deuda/crédito.
   - **Propuesta:** aplicar check de permisos admin o scope específico.
   - **Estado:** ✅ Resuelto (permiso `payments:update` requerido).

2. **[P2] Delivery reports no actualizan estados**
   - **Archivo:** apps/api/src/routes/v1/webhook.routes.ts (aprox. 249)
   - **Detalle:** El webhook de delivery report responde 200 pero no actualiza estado de mensajes.
   - **Impacto:** Dashboard/CRM no refleja delivery real; métricas y seguimiento quedan incompletos.
   - **Propuesta:** persistir status y timestamp por messageId.
   - **Estado:** ✅ Resuelto (se registra evento `message.delivery` en outbox).

3. **[P2] Links de pago MercadoPago en placeholder**
   - **Archivo:** packages/agent-runtime/src/tools/retail/commerce.tools.ts (aprox. 194-210)
   - **Detalle:** `create_payment_link` genera URLs placeholder y crea pagos en estado `pending` sin integración real.
   - **Impacto:** Cliente recibe links inválidos; pagos no trazables.
   - **Propuesta:** integrar API MP o deshabilitar tool hasta estar implementada.
   - **Estado:** ✅ Resuelto (usa integración MP real y guarda `preferenceId`).

4. **[P2] Memoria persistente puede almacenar PII sin redacción**
   - **Archivo:** packages/agent-runtime/src/core/memory-service.ts
   - **Detalle:** `updateFromTurn` extrae facts/preferencias desde el diálogo y los almacena sin un filtro explícito de PII.
   - **Impacto:** Riesgo de compliance (DNI, dirección, datos de pago) en memoria larga.
   - **Propuesta:** agregar redacción/allowlist antes de persistir.
   - **Estado:** ✅ Resuelto (redacción automática de PII antes de persistir).

5. **[P2] Recordatorios pueden enviarse de inmediato (cutoff no aplicado)**
   - **Archivo:** apps/worker/src/jobs/debt-reminder.job.ts (aprox. 150-190)
   - **Detalle:** Se calcula `cutoffDate` pero no se usa en el `where`. El primer recordatorio puede salir apenas existe deuda, ignorando `firstReminderDays`.
   - **Impacto:** Mensajes de cobranza demasiado tempranos y posibles quejas.
   - **Propuesta:** filtrar por fecha de última deuda/última orden o aplicar `cutoffDate` sobre `lastDebtReminderAt`/orden.
   - **Estado:** ✅ Resuelto (se valida antigüedad mínima por orden más antigua antes del primer recordatorio).

6. **[P2] Endpoint de debug/catch-all expone payloads sin autenticación**
   - **Archivo:** apps/api/src/routes/v1/webhook.routes.ts (aprox. 446-470)
   - **Detalle:** `/webhooks/debug` y el catch-all registran headers/body completos y responden 200 sin verificación de firma.
   - **Impacto:** Exposición de PII y potencial abuso (spam/log flooding).
   - **Propuesta:** habilitar solo en `NODE_ENV=development` o detrás de autenticación/feature flag.
   - **Estado:** ✅ Resuelto (solo se habilita con `WEBHOOK_DEBUG=true` o `NODE_ENV=development`).

7. **[P2] Generación de número de orden no es segura ante concurrencia**
   - **Archivo:** apps/api/src/routes/v1/orders.routes.ts (aprox. 92-116)
   - **Detalle:** `generateOrderNumber` lee el último correlativo y suma 1; bajo concurrencia puede colisionar el `@@unique([workspaceId, orderNumber])`.
   - **Impacto:** Errores 500 en creación de órdenes concurrentes.
   - **Propuesta:** usar secuencia/contador transaccional o reintentar en conflicto.
   - **Estado:** ✅ Resuelto (retry con detección de colisión `P2002`).

8. **[P2] Tokens en localStorage exponen sesión ante XSS**
   - **Archivos:**
     - apps/dashboard/src/lib/api.ts
     - apps/dashboard/src/contexts/AuthContext.tsx
   - **Detalle:** Access/refresh tokens se leen/escriben en `localStorage`, lo que los deja expuestos si ocurre XSS.
   - **Impacto:** Toma de cuenta y acceso no autorizado.
   - **Propuesta:** mover tokens a cookies `httpOnly` con `SameSite` y rotación; reforzar CSP.
   - **Estado:** ✅ Resuelto (API emite cookies httpOnly y dashboard usa `credentials: include`).
