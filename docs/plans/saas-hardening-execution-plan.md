# NEXOVA SaaS Hardening Execution Plan

## Objetivo
Cerrar brechas críticas de seguridad y multi-tenant para habilitar un Go-Live SaaS multiusuario con riesgo controlado.

## Alcance
- API (`apps/api`): tenancy, RBAC, webhooks, archivos.
- Runtime/worker (`packages/agent-runtime`, `apps/worker`): validación de `fileRef` y fetch seguro.
- Calidad: tests de regresión y CI.

## Criterio de Go/No-Go
No se habilita producción multiusuario hasta completar **Parte 1 + Parte 2**.

## Parte 1 (P0) - Cierre inmediato de riesgos de compromiso
Estado: `completed`

1. Endurecer membresías de workspace
- Reemplazar `GET /workspaces/available` para devolver solo invitaciones pendientes del usuario autenticado.
- Cambiar `POST /workspaces/:id/join` para aceptar únicamente invitaciones existentes para ese usuario/workspace.
- Cerrar `PATCH /workspaces/:id/members/me/role` para impedir auto-escalación.

2. Verificación estricta de Stripe webhook
- Exigir `STRIPE_WEBHOOK_SECRET` + header `Stripe-Signature`.
- Validar firma con `stripe.webhooks.constructEvent` usando `rawBody`.
- Rechazar eventos inválidos (`400`) y configuración incompleta (`503`).

3. Validación
- Ejecutar typecheck/lint focalizado de API.
- Prueba manual mínima de rutas afectadas (join/invite/webhook).

## Parte 2 (P1) - Seguridad operativa multiusuario
Estado: `completed`

1. RBAC consistente en rutas de negocio
- Aplicar `requirePermission(...)` en órdenes, clientes, integraciones, stock, analytics.
- Definir matriz endpoint->permiso y cubrirla de forma explícita.

2. Endurecer configuración del workspace
- Restringir `PATCH /workspaces/:id/settings` a rol con `settings:update`.
- Separar flags sensibles (facturación, owner agent, medios de pago).

3. Archivos
- Quitar exposición pública directa de `/uploads`.
- Servir archivos con autorización por workspace y URLs firmadas o proxy seguro.

4. Logging seguro
- Eliminar payload completo en logs de webhooks.
- Mantener solo metadatos necesarios (eventId, provider, workspaceId, messageId).

## Parte 3 (P1/P2) - SSRF y fetch remoto seguro
Estado: `completed`

1. Política de salida HTTP
- Allowlist de dominios para `fileRef` remoto.
- Bloquear IPs privadas/loopback/link-local.
- Timeout, tamaño máximo y content-type estricto.

2. Ingreso de `fileRef`
- Validar en API/runtime que `fileRef` sea local controlado o dominio autorizado.

## Parte 4 (P2) - Calidad y release gating
Estado: `in_progress`

1. Testing mínimo obligatorio
- Suites implementadas para:
  - guard SSRF en `api`, `worker` y `agent-runtime`
  - invitaciones/join de workspace
  - bloqueo de auto-escalación en `members/me/role`
  - firma Stripe webhook (`MISSING_SIGNATURE`, `INVALID_SIGNATURE`, payload firmado válido)
  - matriz RBAC crítica por regresión
- Eliminado `--passWithNoTests` en paquetes críticos (`@nexova/api`, `@nexova/worker`, `@nexova/agent-runtime`).
- Pendiente: ampliar cobertura e2e de permisos por rol con fixtures reales de membresías/roles.

2. CI
- Pipeline agregado en `.github/workflows/ci.yml` con `install + lint:security + typecheck + test`.
- Pendiente: bloquear merge a nivel de branch protection con checks requeridos.

3. Higiene de repositorio
- Dejar de versionar `apps/api/uploads/**` y artefactos operativos.
- Revisar y limpiar archivos sensibles/históricos del repo.

4. Deuda de lint (faseada)
- Fase 1 completada: ejecución de `eslint --fix` en `landing`, `dashboard`, `api`, `worker`, `agent-runtime`, `integrations`, `core`.
- Endurecimiento incremental aplicado: `prefer-const` volvió a `error` sin romper el pipeline.
- Subfase actual completada:
  - `packages/integrations/src/whatsapp/infobip.client.ts`: parser de webhook tipado con `unknown` + guards (elimina warnings de `no-unsafe-*` en ese archivo).
  - `packages/integrations/src/whatsapp/evolution.client.ts`: eliminación de `any` y extracción segura de metadatos de envío.
  - `packages/integrations/src/arca/arca.client.ts` + `packages/integrations/src/arca/integration.service.ts`: parseo SOAP tipado (`unknown`/`Record<string, unknown>`) y limpieza de variables no usadas.
  - `packages/core/src/orders/order-receipt-pdf.service.ts` y `packages/core/src/invoices/arca-invoice-pdf.service.ts`: reemplazo de `any` por `PDFPage`.
  - `packages/core/src/tenancy/prisma-tenant.middleware.ts` + `packages/core/src/stock/stock-purchase-receipt.service.ts`: tipado seguro de `args.where/data` y eliminación de casts `any`.
  - `apps/worker`: reemplazo de `console.log` por `logger.info` en `main.ts`, `jobs/debt-reminder.job.ts` y `jobs/audio-transcription.job.ts`.
  - `apps/worker`: limpieza completa de warnings en `audio-transcription`, `webhook-retry`, `scheduled`, `debt-reminder` y `main`.
  - `.eslintrc.js`: corrección de `parserOptions.project` para usar solo `tsconfig` por app/package (evita que frontend se tipara con `tsconfig.base` sin `DOM`).
  - `apps/landing`: limpieza de warnings no-estilísticos (env vars tipadas, `void` en promesas de efectos/handlers, fixes de `any` implícitos).
  - `packages/agent-runtime/src/worker/agent-worker.ts`: refactor de parseo de payload a `unknown` + guards, eliminación de `any` en helpers críticos y migración de logging a `logger`.
  - `packages/agent-runtime/src/worker/start.ts`: cleanup de entrypoint (logger + shutdown sin promesas flotantes) y warnings en 0 para ese archivo.
  - `apps/api/src/routes/v1/webhook.routes.ts`: endurecimiento completo de parseo (`unknown` + guards), eliminación de `any` y limpieza total de warnings del archivo.
  - `apps/api/src/services/quick-action/quick-action.service.ts`: refactor de parseo/normalización (`unknown` + guards), logging seguro y tipado explícito; warnings en 0.
  - `apps/api/src/routes/v1/orders.routes.ts`: tipado fuerte de filtros/updates/items, eliminación de `any` críticos y corrección de promesas flotantes; warnings en 0.
  - `apps/api/src/routes/v1/products.routes.ts`: tipado de cláusulas Prisma, remoción de `any` y corrección de `reply.send` flotante; warnings en 0.
  - `apps/api/src/routes/v1/categories.routes.ts`: tipado de filtros Prisma + eliminación de promesas flotantes; warnings en 0.
- Baseline actual (warnings) luego de limpieza del dashboard (2026-02-18):
  - `@nexova/dashboard`: 0
  - `@nexova/api`: 1048
  - `@nexova/agent-runtime`: 380
  - `@nexova/landing`: 0
  - `@nexova/integrations`: 0
  - `@nexova/core`: 0
  - `@nexova/worker`: 0
  - `@nexova/shared` / `@nexova/retail`: 0
  - Total: 1428
- Baseline actualizada (warnings) tras limpieza de quick-actions + routes (2026-02-18):
  - `@nexova/dashboard`: 0
  - `@nexova/api`: 388
  - `@nexova/agent-runtime`: 380
  - `@nexova/landing`: 0
  - `@nexova/integrations`: 0
  - `@nexova/core`: 0
  - `@nexova/worker`: 0
  - `@nexova/shared` / `@nexova/retail`: 0
  - Total: 768
- Baseline final de lint (2026-02-19):
  - `@nexova/dashboard`: 0
  - `@nexova/api`: 0
  - `@nexova/agent-runtime`: 0
  - `@nexova/landing`: 0
  - `@nexova/integrations`: 0
  - `@nexova/core`: 0
  - `@nexova/worker`: 0
  - `@nexova/shared` / `@nexova/retail`: 0
  - Total: 0

## Entregables por parte
- PR técnico con checklist de seguridad.
- Evidencia de validación (comandos + resultados).
- Registro de riesgos remanentes.

## Avance actual (2026-02-18)
- Parte 1 implementada en código:
  - `GET /workspaces/available`: ahora devuelve solo invitaciones pendientes del usuario.
  - `POST /workspaces/:id/join`: ahora acepta únicamente membresías en estado `invited` y no vencidas.
  - `PATCH /workspaces/:id/members/me/role`: bloqueado para evitar auto-escalación.
  - `POST /billing/webhook`: validación estricta de firma Stripe (`Stripe-Signature` + `STRIPE_WEBHOOK_SECRET` + `constructEvent`).
- Endurecimiento adicional final de Parte 2:
  - `PATCH /workspaces/:id/settings` ahora requiere permiso `settings:update`.
  - `PATCH /workspaces/:id/settings` ahora exige permisos adicionales para settings sensibles:
    - `payments:update` (facturación/medios de pago)
    - `sessions:takeover` (owner agent)
  - RBAC aplicado en rutas de `orders` (read/create/update/cancel + receipts).
  - RBAC aplicado en rutas de `customers` (read/create/update/delete + notes + deuda).
  - RBAC aplicado en rutas de `integrations` (connections/payments/receipts/ledger).
  - RBAC aplicado en `products` y `categories` (read/create/update/delete + stock adjust).
  - RBAC aplicado en `analytics` (`analytics:read`).
  - RBAC aplicado en `stock-receipts` (`stock:adjust` para preview/apply).
  - `/uploads` público restringido a `products`; archivos sensibles ahora se sirven por `GET /api/v1/uploads/file/:category/:filename`.
  - URLs firmadas implementadas para envío de archivos (facturas/catálogos/media WhatsApp) y para upload interno.
  - Reducción de PII en logs de webhooks (se removieron payloads completos).
  - `.gitignore` actualizado para bloquear nuevos `uploads` runtime en git.
  - `uploads` históricos removidos del índice git (se mantienen locales).
  - `POST /uploads/product-image` ahora exige `products:create` o `products:update`.
  - Matriz RBAC ampliada en tests de regresión (`apps/api/test/unit/rbac-route-matrix.test.ts`) para `orders/customers/integrations/stock/analytics/uploads`.
  - Logs de webhooks saneados para no registrar payload completo:
    - `webhook.routes.ts` (Infobip parse/delivery + debug/catch-all)
    - `integrations.routes.ts` (MercadoPago webhook)
- Endurecimiento SSRF (Parte 3 completado):
  - `GET /integrations/receipts/:id/file` ahora bloquea hosts remotos no permitidos.
  - `apps/api/src/utils/remote-fetch-guard.ts`: validación DNS/IP privada, timeout, max bytes, content-type estricto.
  - `apps/worker/src/utils/remote-fetch-guard.ts`: guard SSRF aplicado al flujo de descarga de audio.
  - `packages/agent-runtime/src/utils/remote-fetch-guard.ts`: guard SSRF aplicado a herramientas de admin/payment.
  - Agent runtime (`payment.tools` y `admin.tools`) valida host permitido antes de procesar `fileRef`.
  - Worker de transcripción aplica allowlist + DNS/IP checks para URLs de media.
- Calidad y gating (Parte 4 en progreso):
  - Tests unitarios nuevos:
    - `apps/api/test/unit/remote-fetch-guard.test.ts`
    - `apps/api/test/unit/workspace-security.test.ts`
    - `apps/api/test/unit/billing-webhook.test.ts`
    - `apps/api/test/unit/rbac-route-matrix.test.ts`
    - `apps/worker/test/unit/remote-fetch-guard.test.ts`
    - `packages/agent-runtime/test/unit/remote-fetch-guard.test.ts`
  - CI nuevo:
  - `.github/workflows/ci.yml` con gates sobre paquetes críticos.
  - Script raíz nuevo: `lint:security` (superficie SSRF endurecida).
  - `apps/dashboard` quedó en 0 warnings (`pnpm exec eslint src --ext .ts,.tsx --format unix`).

## Nota de validación
- `pnpm --filter @nexova/api typecheck`: OK.
- `pnpm --filter @nexova/worker typecheck`: OK.
- `pnpm --filter @nexova/agent-runtime typecheck`: OK.
- `pnpm --filter @nexova/api test`: OK.
- `pnpm --filter @nexova/worker test`: OK.
- `pnpm --filter @nexova/agent-runtime test`: OK.
- `pnpm lint:security`: OK.
- `pnpm lint`: OK (0 errors / 0 warnings en el monorepo).
