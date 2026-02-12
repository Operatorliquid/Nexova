# Plan de Implementación por Fases

## Resumen Ejecutivo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ROADMAP DE IMPLEMENTACIÓN                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FASE 0: Core Foundation                                                    │
│  ════════════════════════                                                   │
│  Auth • Tenancy • RBAC • Repo Setup • Observability                         │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  FASE 1: Retail & Agent                                                     │
│  ═══════════════════════                                                    │
│  DB Models • Retail Domain • Tools • State Machine • Dashboard UI           │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  FASE 2: Integrations                                                       │
│  ════════════════════                                                       │
│  WhatsApp/Infobip • BullMQ Queues • Idempotency • Handoff Flow              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  FASE 3: Hardening                                                          │
│  ═════════════════                                                          │
│  Security • Rate Limiting • Audit Trail • Load Testing • E2E Tests          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## FASE 0: Core Foundation

### Objetivo
Establecer la base del sistema: autenticación, multi-tenancy, roles y permisos, estructura del repositorio, y skeleton de observabilidad.

### Alcance Detallado

```
packages/core/
├── src/
│   ├── auth/
│   │   ├── auth.service.ts          # Login, register, refresh, logout
│   │   ├── auth.controller.ts       # HTTP handlers
│   │   ├── auth.schemas.ts          # Zod validation
│   │   ├── password.service.ts      # Argon2 hashing
│   │   ├── token.service.ts         # JWT access + refresh tokens
│   │   └── guards/
│   │       ├── auth.guard.ts        # Verify JWT
│   │       └── permission.guard.ts  # Check RBAC
│   │
│   ├── tenancy/
│   │   ├── workspace.service.ts     # CRUD workspaces
│   │   ├── workspace.controller.ts
│   │   ├── membership.service.ts    # User-workspace relations
│   │   └── context.ts               # AsyncLocalStorage for tenant
│   │
│   ├── rbac/
│   │   ├── role.service.ts          # CRUD roles
│   │   ├── permission.service.ts    # Permission checks
│   │   ├── policy.service.ts        # ABAC policies
│   │   └── decorators.ts            # @RequirePermission()
│   │
│   └── observability/
│       ├── logger.ts                # Pino structured logging
│       ├── tracing.ts               # OpenTelemetry setup
│       ├── metrics.ts               # Prometheus metrics
│       └── sentry.ts                # Error tracking

apps/api/
├── src/
│   ├── main.ts                      # Fastify bootstrap
│   ├── app.ts                       # Plugin registration
│   ├── plugins/
│   │   ├── prisma.plugin.ts         # DB connection
│   │   ├── auth.plugin.ts           # Auth middleware
│   │   ├── tenant.plugin.ts         # Tenant context
│   │   └── error.plugin.ts          # Error handling
│   └── routes/
│       └── v1/
│           ├── auth.routes.ts
│           ├── workspaces.routes.ts
│           └── health.routes.ts
```

### Checklist Definition of Done ✓

#### 0.1 Repository Setup
- [ ] Git repository inicializado con `.gitignore` completo
- [ ] pnpm workspaces configurado (`pnpm-workspace.yaml`)
- [ ] Turbo pipeline configurado para build/dev/test/lint
- [ ] TypeScript project references funcionando entre packages
- [ ] ESLint con boundary rules (packages no pueden importar de apps)
- [ ] Prettier + Husky + lint-staged configurados
- [ ] Commitlint con conventional commits
- [ ] Docker Compose con PostgreSQL 15 + Redis 7
- [ ] `.env.example` con todas las variables documentadas
- [ ] `README.md` con instrucciones de setup

#### 0.2 Database & Prisma
- [ ] Prisma schema con modelos de tenancy (User, Workspace, Membership)
- [ ] Prisma schema con modelos de auth (RefreshToken, PasswordReset)
- [ ] Prisma schema con modelos de RBAC (Role, Policy)
- [ ] Migrations generadas y aplicables
- [ ] Seed script con workspace demo + usuario admin
- [ ] Prisma Client generado y exportado desde `@nexova/core`

#### 0.3 Authentication
- [ ] `POST /api/v1/auth/register` - crear cuenta
- [ ] `POST /api/v1/auth/login` - obtener tokens
- [ ] `POST /api/v1/auth/refresh` - renovar access token
- [ ] `POST /api/v1/auth/logout` - invalidar refresh token
- [ ] `POST /api/v1/auth/forgot-password` - enviar email reset
- [ ] `POST /api/v1/auth/reset-password` - cambiar contraseña
- [ ] Passwords hasheados con Argon2id
- [ ] JWT con RS256 (access 15min, refresh 7d)
- [ ] Refresh token rotation (single use)
- [ ] Rate limiting en endpoints de auth (5 req/min login)

#### 0.4 Multi-Tenancy
- [ ] `POST /api/v1/workspaces` - crear workspace
- [ ] `GET /api/v1/workspaces` - listar workspaces del usuario
- [ ] `GET /api/v1/workspaces/:id` - detalle workspace
- [ ] `PATCH /api/v1/workspaces/:id` - actualizar workspace
- [ ] `DELETE /api/v1/workspaces/:id` - eliminar (soft delete)
- [ ] Workspace context via `x-workspace-id` header
- [ ] AsyncLocalStorage para tenant context
- [ ] Prisma middleware que filtra por `workspaceId`
- [ ] Validación de membership antes de acceder

#### 0.5 RBAC/ABAC
- [ ] `GET /api/v1/workspaces/:id/roles` - listar roles
- [ ] `POST /api/v1/workspaces/:id/roles` - crear rol custom
- [ ] `PATCH /api/v1/workspaces/:id/roles/:roleId` - editar
- [ ] `DELETE /api/v1/workspaces/:id/roles/:roleId` - eliminar
- [ ] System roles (Owner, Admin) no editables
- [ ] Decorador `@RequirePermission('orders:read')`
- [ ] Helper `hasPermission(user, 'orders:*')`
- [ ] Wildcard permissions funcionando (`*`, `orders:*`)
- [ ] Guard que valida permisos en cada request

#### 0.6 Observability
- [ ] Pino logger con JSON estructurado
- [ ] Request ID en cada log (correlation)
- [ ] OpenTelemetry traces exportando a Jaeger/OTLP
- [ ] Métricas básicas: `http_requests_total`, `http_request_duration_seconds`
- [ ] Sentry configurado para errores no capturados
- [ ] Health check endpoint: `GET /health` y `GET /health/ready`
- [ ] Prisma query logging en desarrollo

#### 0.7 Tests Fase 0
- [ ] Unit tests para `auth.service.ts` (≥80% coverage)
- [ ] Unit tests para `permission.service.ts`
- [ ] Integration tests para flujo completo de auth
- [ ] Integration tests para CRUD de workspaces
- [ ] Test de tenant isolation (usuario no puede acceder a otro workspace)

---

## FASE 1: Retail & Agent Base

### Objetivo
Implementar el dominio de retail completo, los tools del agente IA, la máquina de estados, y las pantallas del dashboard.

### Alcance Detallado

```
packages/retail/
├── src/
│   ├── products/
│   │   ├── product.service.ts
│   │   ├── product.controller.ts
│   │   ├── product.schemas.ts
│   │   └── variant.service.ts
│   │
│   ├── stock/
│   │   ├── stock.service.ts
│   │   ├── stock.controller.ts
│   │   ├── reservation.service.ts    # Reservas temporales
│   │   └── movement.service.ts       # Historial
│   │
│   ├── customers/
│   │   ├── customer.service.ts
│   │   ├── customer.controller.ts
│   │   └── address.service.ts
│   │
│   ├── orders/
│   │   ├── order.service.ts
│   │   ├── order.controller.ts
│   │   ├── order-draft.service.ts    # Borradores
│   │   └── order-item.service.ts
│   │
│   └── payments/
│       ├── payment.service.ts
│       ├── payment.controller.ts
│       └── attachment.service.ts      # Comprobantes

packages/agent-runtime/
├── src/
│   ├── llm/
│   │   ├── provider.interface.ts     # Abstracción
│   │   ├── anthropic.provider.ts     # Claude implementation
│   │   └── fallback.provider.ts      # Retry + fallback
│   │
│   ├── tools/
│   │   ├── tool.registry.ts          # Registro de tools
│   │   ├── tool.executor.ts          # Ejecución segura
│   │   ├── retail/                   # 11 tools de retail
│   │   │   ├── create-order-draft.tool.ts
│   │   │   ├── add-item-to-draft.tool.ts
│   │   │   ├── set-delivery-details.tool.ts
│   │   │   ├── request-confirmation.tool.ts
│   │   │   ├── confirm-order.tool.ts
│   │   │   ├── adjust-stock.tool.ts
│   │   │   ├── register-payment.tool.ts
│   │   │   ├── attach-receipt.tool.ts
│   │   │   ├── get-customer-context.tool.ts
│   │   │   ├── list-products.tool.ts
│   │   │   └── send-catalog.tool.ts
│   │   └── system/
│   │       └── request-human-handoff.tool.ts
│   │
│   ├── state-machine/
│   │   ├── session.state.ts          # Estados posibles
│   │   ├── session.transitions.ts    # Transiciones válidas
│   │   └── state-machine.ts         # FSM propio
│   │
│   └── memory/
│       ├── context.builder.ts        # Construye contexto para LLM
│       └── summary.service.ts        # Resumir conversaciones largas

apps/dashboard/
├── src/
│   ├── pages/
│   │   ├── auth/                     # Login, Register, Forgot
│   │   ├── dashboard/                # Home con stats
│   │   ├── inbox/                    # Chat conversations
│   │   ├── orders/                   # CRUD orders
│   │   ├── products/                 # CRUD products
│   │   ├── stock/                    # Inventory management
│   │   ├── customers/                # Customer list
│   │   └── settings/                 # Workspace config
│   │
│   ├── stores/
│   │   ├── auth.store.ts             # Zustand auth state
│   │   ├── workspace.store.ts        # Current workspace
│   │   └── inbox.store.ts            # Conversations state
│   │
│   └── hooks/
│       ├── useAuth.ts
│       ├── usePermissions.ts
│       └── useRealtime.ts            # Socket subscriptions
```

### Checklist Definition of Done ✓

#### 1.1 Database Models Retail
- [ ] Prisma models: Product, ProductVariant, StockItem, StockMovement
- [ ] Prisma models: Customer, CustomerAddress
- [ ] Prisma models: Order, OrderItem, OrderStatusHistory
- [ ] Prisma models: Payment, Attachment
- [ ] Todos los modelos con `workspaceId` (tenant isolation)
- [ ] Índices optimizados para queries frecuentes
- [ ] Migrations aplicadas sin errores
- [ ] Seed con productos y clientes de ejemplo

#### 1.2 Products API
- [ ] `GET /api/v1/products` - listar con paginación/filtros
- [ ] `GET /api/v1/products/:id` - detalle con variantes
- [ ] `POST /api/v1/products` - crear producto
- [ ] `PATCH /api/v1/products/:id` - actualizar
- [ ] `DELETE /api/v1/products/:id` - soft delete
- [ ] `POST /api/v1/products/import` - import CSV/Excel
- [ ] Búsqueda por nombre/SKU con full-text
- [ ] Filtros por categoría, precio, stock

#### 1.3 Stock API
- [ ] `GET /api/v1/stock` - inventario actual
- [ ] `GET /api/v1/stock/movements` - historial de movimientos
- [ ] `POST /api/v1/stock/adjust` - ajuste manual
- [ ] `POST /api/v1/stock/reserve` - reserva temporal (para orden)
- [ ] `POST /api/v1/stock/release` - liberar reserva
- [ ] Stock available = total - reserved
- [ ] Alertas de stock bajo (< threshold)
- [ ] Movimientos trackeados con razón y usuario

#### 1.4 Customers API
- [ ] `GET /api/v1/customers` - listar con búsqueda
- [ ] `GET /api/v1/customers/:id` - detalle con historial
- [ ] `POST /api/v1/customers` - crear
- [ ] `PATCH /api/v1/customers/:id` - actualizar
- [ ] `GET /api/v1/customers/by-phone/:phone` - buscar por teléfono
- [ ] Merge de clientes duplicados
- [ ] Historial de órdenes por cliente

#### 1.5 Orders API
- [ ] `GET /api/v1/orders` - listar con filtros/paginación
- [ ] `GET /api/v1/orders/:id` - detalle completo
- [ ] `POST /api/v1/orders` - crear orden
- [ ] `PATCH /api/v1/orders/:id` - actualizar
- [ ] `POST /api/v1/orders/:id/confirm` - confirmar
- [ ] `POST /api/v1/orders/:id/cancel` - cancelar
- [ ] `POST /api/v1/orders/:id/ship` - marcar enviada
- [ ] `POST /api/v1/orders/:id/deliver` - marcar entregada
- [ ] Status history automático en cada cambio
- [ ] Validación de stock antes de confirmar

#### 1.6 Payments API
- [ ] `GET /api/v1/orders/:orderId/payments` - pagos de orden
- [ ] `POST /api/v1/orders/:orderId/payments` - registrar pago
- [ ] `POST /api/v1/payments/:id/attachments` - subir comprobante
- [ ] Validación de monto total vs pagado
- [ ] Soporte múltiples métodos (cash, transfer, card)

#### 1.7 Agent Tools
- [ ] Tool `create_order_draft` implementado y testeado
- [ ] Tool `add_item_to_draft` implementado y testeado
- [ ] Tool `set_delivery_details` implementado y testeado
- [ ] Tool `request_confirmation` implementado y testeado
- [ ] Tool `confirm_order` implementado y testeado
- [ ] Tool `adjust_stock` implementado y testeado
- [ ] Tool `register_payment` implementado y testeado
- [ ] Tool `attach_receipt` implementado y testeado
- [ ] Tool `get_customer_context` implementado y testeado
- [ ] Tool `list_products` implementado y testeado
- [ ] Tool `send_catalog` implementado y testeado
- [ ] Todos los tools con JSON Schema exportado
- [ ] Tool executor con timeout (30s max)
- [ ] Tool executor con logging de ejecución

#### 1.8 State Machine
- [ ] Estados definidos: IDLE, COLLECTING_ORDER, NEEDS_DETAILS, AWAITING_CONFIRMATION, EXECUTING, DONE, HANDOFF
- [ ] Transiciones válidas implementadas
- [ ] Guards para validar transiciones
- [ ] Persistencia de estado en AgentSession
- [ ] Eventos emitidos en cada transición
- [ ] Timeout de sesión configurable (30 min default)

#### 1.9 LLM Integration
- [ ] Provider interface abstracto
- [ ] Anthropic provider (Claude Sonnet)
- [ ] System prompt con instrucciones de retail
- [ ] Tools pasados como `tool_use` en API
- [ ] Parseo de tool calls del response
- [ ] Retry con backoff exponencial
- [ ] Fallback a modelo secundario
- [ ] Token counting y límite de contexto

#### 1.10 Dashboard UI
- [ ] Login page funcional con API
- [ ] Dashboard home con stats reales
- [ ] Inbox con lista de conversaciones
- [ ] Inbox con chat view y mensajes
- [ ] Orders list con filtros y búsqueda
- [ ] Order detail con timeline
- [ ] Products grid/list view
- [ ] Product form (create/edit)
- [ ] Stock overview con alertas
- [ ] Settings workspace
- [ ] Settings team members
- [ ] React Query para data fetching
- [ ] Zustand stores configurados
- [ ] Permisos aplicados en UI (ocultar/deshabilitar)

#### 1.11 Tests Fase 1
- [ ] Unit tests para cada tool (≥90% coverage)
- [ ] Unit tests para state machine transitions
- [ ] Integration tests para orders flow completo
- [ ] Integration tests para stock reservations
- [ ] E2E test: crear orden desde API hasta confirmación

---

## FASE 2: Integrations & Queues

### Objetivo
Integrar WhatsApp vía Infobip, implementar sistema de colas con BullMQ, garantizar idempotencia, y completar el flujo de handoff a humanos.

### Alcance Detallado

```
packages/integrations/
├── src/
│   ├── whatsapp/
│   │   ├── infobip/
│   │   │   ├── infobip.client.ts      # HTTP client
│   │   │   ├── infobip.adapter.ts     # Normaliza mensajes
│   │   │   └── infobip.webhook.ts     # Procesa incoming
│   │   ├── message.normalizer.ts      # WhatsApp -> interno
│   │   └── message.sender.ts          # Interno -> WhatsApp
│   │
│   └── webhooks/
│       ├── webhook.controller.ts      # Recibe webhooks
│       ├── webhook.verifier.ts        # Valida signatures
│       └── webhook.processor.ts       # Procesa async

apps/worker/
├── src/
│   ├── main.ts                        # Worker bootstrap
│   ├── queues/
│   │   ├── message-ingress.worker.ts  # Procesa mensajes entrantes
│   │   ├── message-egress.worker.ts   # Envía mensajes salientes
│   │   ├── agent-process.worker.ts    # Ejecuta agente IA
│   │   ├── media-process.worker.ts    # Descarga/procesa media
│   │   └── notification.worker.ts     # Envía notificaciones
│   │
│   └── handlers/
│       ├── handoff.handler.ts         # Lógica de handoff
│       └── session.handler.ts         # Gestión de sesiones

packages/core/
├── src/
│   ├── idempotency/
│   │   ├── idempotency.service.ts     # Check/store keys
│   │   └── idempotency.middleware.ts  # Fastify plugin
│   │
│   └── outbox/
│       ├── outbox.service.ts          # Transactional outbox
│       └── outbox.publisher.ts        # Polling publisher
```

### Checklist Definition of Done ✓

#### 2.1 Infobip Integration
- [ ] Infobip account configurado con WhatsApp Business
- [ ] Client HTTP con retry y circuit breaker
- [ ] `POST /api/v1/connections` - crear conexión Infobip
- [ ] Webhook URL configurado en Infobip dashboard
- [ ] Signature verification para webhooks
- [ ] Normalización de mensajes (text, image, document, location)
- [ ] Envío de mensajes de texto
- [ ] Envío de templates (HSM)
- [ ] Envío de imágenes/documentos
- [ ] Manejo de delivery receipts
- [ ] Manejo de read receipts

#### 2.2 Webhook Processing
- [ ] `POST /api/v1/webhooks/infobip/:numberId` - endpoint receptor
- [ ] Signature validation antes de procesar
- [ ] Response 200 inmediato (< 100ms)
- [ ] Job encolado para procesamiento async
- [ ] Deduplicación por `messageId`
- [ ] Storage en `WebhookInbox` para audit
- [ ] Retry automático si falla procesamiento

#### 2.3 BullMQ Queues
- [ ] Redis connection pool configurado
- [ ] Queue `message:ingress` - mensajes entrantes
- [ ] Queue `message:egress` - mensajes salientes
- [ ] Queue `agent-process` - invocación agente
- [ ] Queue `media:process` - procesamiento media
- [ ] Queue `notification:send` - notificaciones
- [ ] Queue `outbox:publish` - transactional outbox
- [ ] Dashboard BullMQ para monitoreo
- [ ] Métricas de queue en Prometheus
- [ ] Dead letter queue para jobs fallidos
- [ ] Job retention policy (7 días completed, 30 días failed)

#### 2.4 Message Ingress Worker
- [ ] Consume de `message:ingress`
- [ ] Lookup/create customer por phone
- [ ] Lookup/create session
- [ ] Store message en `AgentMessage`
- [ ] Si session.agentActive → encolar `agent-process`
- [ ] Si !session.agentActive → notificar operador
- [ ] Idempotencia por `externalMessageId`

#### 2.5 Agent Process Worker
- [ ] Consume de `agent-process`
- [ ] Load session con contexto
- [ ] Build prompt con historial
- [ ] Call LLM provider
- [ ] Parse tool calls
- [ ] Execute tools secuencialmente
- [ ] Store tool executions
- [ ] Encolar response en `message:egress`
- [ ] Update session state
- [ ] Timeout de procesamiento (60s)
- [ ] Retry con backoff si LLM falla

#### 2.6 Message Egress Worker
- [ ] Consume de `message:egress`
- [ ] Lookup connection por workspace
- [ ] Format message para Infobip
- [ ] Send via Infobip API
- [ ] Update message status
- [ ] Retry si falla (max 3)
- [ ] Store en outbox para reliability

#### 2.7 Idempotency Layer
- [ ] Redis-based idempotency keys
- [ ] TTL configurable (24h default)
- [ ] Middleware para endpoints sensibles
- [ ] Dedup en webhook processing
- [ ] Dedup en message sending
- [ ] Metrics de cache hits/misses

#### 2.8 Transactional Outbox
- [ ] Tabla `EventOutbox` en Prisma
- [ ] Service para insert en misma TX
- [ ] Publisher que hace polling cada 5s
- [ ] Publish a queue correspondiente
- [ ] Mark as processed después de publish
- [ ] Cleanup de eventos viejos (30 días)

#### 2.9 Handoff Flow
- [ ] Tool `request_human_handoff` disponible
- [ ] Detección automática de frustración (3 failures)
- [ ] Session.agentActive = false en handoff
- [ ] Notificación push a operadores
- [ ] UI de inbox muestra badge "Handoff"
- [ ] Operador puede tomar sesión
- [ ] Operador puede devolver a agente
- [ ] Historial de handoffs en sesión

#### 2.10 Realtime Updates
- [ ] WebSocket server en API
- [ ] Auth via token en connection
- [ ] Room per workspace
- [ ] Events: `message:new`, `session:updated`, `handoff:requested`
- [ ] Dashboard suscribe a eventos
- [ ] Reconnect automático

#### 2.11 Tests Fase 2
- [ ] Unit tests para Infobip adapter
- [ ] Integration tests para webhook processing
- [ ] Integration tests para queue flow completo
- [ ] Test de idempotencia (mismo mensaje 2 veces)
- [ ] Test de handoff flow completo
- [ ] Load test: 100 mensajes/min sustained

---

## FASE 3: Hardening

### Objetivo
Asegurar el sistema para producción: seguridad, rate limiting, auditoría completa, pruebas de carga, y cobertura de tests.

### Alcance Detallado

```
packages/core/
├── src/
│   ├── security/
│   │   ├── rate-limiter.ts           # Token bucket
│   │   ├── cors.config.ts            # CORS rules
│   │   ├── helmet.config.ts          # Security headers
│   │   ├── sanitizer.ts              # Input sanitization
│   │   └── secrets.service.ts        # Vault integration
│   │
│   ├── audit/
│   │   ├── audit.service.ts          # Log actions
│   │   ├── audit.middleware.ts       # Auto-capture
│   │   └── audit.query.ts            # Search/export
│   │
│   └── backup/
│       ├── backup.service.ts         # DB backups
│       └── restore.service.ts        # Restore procedure

tests/
├── e2e/
│   ├── auth.e2e.test.ts
│   ├── orders.e2e.test.ts
│   ├── agent-flow.e2e.test.ts
│   └── whatsapp-integration.e2e.test.ts
│
├── load/
│   ├── k6/
│   │   ├── auth-load.js
│   │   ├── orders-load.js
│   │   └── agent-load.js
│   └── artillery/
│       └── full-flow.yml
│
└── security/
    ├── owasp-zap.config.yml
    └── dependency-check.config.yml
```

### Checklist Definition of Done ✓

#### 3.1 Security Hardening
- [ ] Helmet configurado (CSP, HSTS, X-Frame-Options)
- [ ] CORS restrictivo (solo dominios permitidos)
- [ ] Input sanitization en todos los endpoints
- [ ] SQL injection prevention (Prisma parameterized)
- [ ] XSS prevention (escape output)
- [ ] CSRF tokens en formularios
- [ ] Secure cookies (HttpOnly, Secure, SameSite)
- [ ] Secrets en Vault/AWS Secrets Manager
- [ ] No secrets en logs
- [ ] Dependency vulnerability scan (npm audit, Snyk)
- [ ] OWASP ZAP scan sin critical/high

#### 3.2 Rate Limiting
- [ ] Global rate limit: 1000 req/min por IP
- [ ] Auth endpoints: 5 req/min por IP
- [ ] API endpoints: 100 req/min por user
- [ ] Webhook endpoints: 1000 req/min por source
- [ ] Token bucket algorithm
- [ ] Redis-backed para distribuido
- [ ] Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`
- [ ] Response 429 con `Retry-After`

#### 3.3 Audit Trail
- [ ] AuditLog model en Prisma
- [ ] Log automático de: create, update, delete
- [ ] Log de auth events (login, logout, failed)
- [ ] Log de permission changes
- [ ] Log de settings changes
- [ ] Actor (userId) en cada entry
- [ ] IP address capturado
- [ ] User agent capturado
- [ ] Before/after values para updates
- [ ] `GET /api/v1/audit` - listar con filtros
- [ ] `GET /api/v1/audit/export` - export CSV
- [ ] Retention policy: 1 año

#### 3.4 Monitoring & Alerting
- [ ] Prometheus metrics completas
- [ ] Grafana dashboards:
  - [ ] API requests/latency
  - [ ] Queue depths/processing time
  - [ ] Error rates
  - [ ] Database connections
  - [ ] Redis memory
- [ ] Alertas configuradas:
  - [ ] Error rate > 1%
  - [ ] P99 latency > 2s
  - [ ] Queue depth > 1000
  - [ ] Database connections > 80%
- [ ] PagerDuty/Slack integration
- [ ] Runbooks para cada alerta

#### 3.5 Load Testing
- [ ] K6 scripts para endpoints críticos
- [ ] Baseline: 100 concurrent users
- [ ] Target: 500 concurrent users
- [ ] Spike test: 1000 users por 1 min
- [ ] Soak test: 100 users por 1 hora
- [ ] Results documentados
- [ ] Bottlenecks identificados y resueltos
- [ ] Performance budget definido

#### 3.6 E2E Tests
- [ ] Auth flow completo (register → login → refresh → logout)
- [ ] Order flow completo (create → confirm → pay → ship → deliver)
- [ ] Agent conversation flow (message → response → tool execution)
- [ ] Handoff flow (agent → human → agent)
- [ ] Multi-tenant isolation test
- [ ] Permission enforcement test
- [ ] CI pipeline con E2E tests

#### 3.7 Test Coverage
- [ ] packages/core: ≥80% coverage
- [ ] packages/retail: ≥80% coverage
- [ ] packages/agent-runtime: ≥90% coverage
- [ ] packages/integrations: ≥80% coverage
- [ ] apps/api: ≥70% coverage
- [ ] apps/worker: ≥70% coverage
- [ ] Coverage reports en CI
- [ ] Coverage gates (fail if below threshold)

#### 3.8 Documentation
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Webhook documentation
- [ ] Tool contracts documentation
- [ ] Architecture Decision Records (ADRs)
- [ ] Runbooks para operaciones comunes
- [ ] Disaster recovery plan
- [ ] Incident response playbook

#### 3.9 Deployment
- [ ] Dockerfile optimizado (multi-stage)
- [ ] Docker Compose para local
- [ ] Kubernetes manifests (o Railway/Render config)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Staging environment
- [ ] Production environment
- [ ] Blue-green deployment ready
- [ ] Rollback procedure documentado
- [ ] Database migration strategy

#### 3.10 Backup & Recovery
- [ ] Automated daily backups (PostgreSQL)
- [ ] Backup retention: 30 días
- [ ] Backup verification (restore test mensual)
- [ ] Point-in-time recovery habilitado
- [ ] Redis persistence configurado
- [ ] Disaster recovery RTO: 4 horas
- [ ] Disaster recovery RPO: 1 hora

---

## Next Actions: Primeros 10 Pasos

### Paso 1: Inicializar Git Repository

```bash
cd /Users/josestratta/Documents/Nexova

# Inicializar git
git init

# Crear .gitignore completo
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
logs/
*.log
npm-debug.log*
pnpm-debug.log*

# Testing
coverage/
.nyc_output/

# Prisma
prisma/*.db
prisma/*.db-journal

# Temporary
tmp/
temp/
.cache/
EOF

# Commit inicial
git add .
git commit -m "chore: initial project structure

- Monorepo setup with pnpm workspaces
- TypeScript project references
- Turbo build pipeline
- Prisma schema for multi-tenant SaaS
- Dashboard UI with React + Vite + Tailwind

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

### Paso 2: Levantar Servicios con Docker

```bash
# Crear directorio docker si no existe
mkdir -p docker

# Verificar docker-compose.yml existe
cat docker/docker-compose.yml

# Levantar PostgreSQL y Redis
docker compose -f docker/docker-compose.yml up -d

# Verificar que están corriendo
docker compose -f docker/docker-compose.yml ps

# Verificar conexión a PostgreSQL
docker compose -f docker/docker-compose.yml exec postgres psql -U nexova -d nexova_dev -c "SELECT 1"

# Verificar conexión a Redis
docker compose -f docker/docker-compose.yml exec redis redis-cli ping
```

### Paso 3: Configurar Variables de Entorno

```bash
# Copiar ejemplo a .env
cp .env.example .env

# Editar con valores locales
cat > .env << 'EOF'
# Database
DATABASE_URL="postgresql://nexova:nexova_secret@localhost:5432/nexova_dev"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT (generar claves RS256)
JWT_ACCESS_SECRET="dev-access-secret-change-in-production"
JWT_REFRESH_SECRET="dev-refresh-secret-change-in-production"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# API
API_PORT=3000
API_HOST="0.0.0.0"
NODE_ENV="development"

# Observability
LOG_LEVEL="debug"
SENTRY_DSN=""
OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"

# Dashboard
VITE_API_URL="http://localhost:3000"
EOF
```

### Paso 4: Generar Prisma Client y Aplicar Migrations

```bash
# Generar Prisma Client
pnpm --filter @nexova/core exec prisma generate

# Crear primera migration
pnpm --filter @nexova/core exec prisma migrate dev --name init

# Verificar que las tablas se crearon
docker compose -f docker/docker-compose.yml exec postgres psql -U nexova -d nexova_dev -c "\dt"
```

### Paso 5: Crear Seed de Datos Iniciales

```bash
# Crear archivo seed
cat > prisma/seed.ts << 'EOF'
import { PrismaClient } from '@prisma/client';
import { hash } from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create demo workspace
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Demo Store',
      slug: 'demo-store',
      settings: {
        currency: 'ARS',
        timezone: 'America/Argentina/Buenos_Aires',
        language: 'es',
      },
    },
  });
  console.log('Created workspace:', workspace.name);

  // Create admin user
  const passwordHash = await hash('admin123');
  const user = await prisma.user.create({
    data: {
      email: 'admin@demo.com',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      emailVerified: true,
    },
  });
  console.log('Created user:', user.email);

  // Create owner role
  const ownerRole = await prisma.role.create({
    data: {
      workspaceId: workspace.id,
      name: 'Owner',
      permissions: ['*'],
      isSystem: true,
    },
  });

  // Create membership
  await prisma.membership.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      roleId: ownerRole.id,
      status: 'ACTIVE',
    },
  });
  console.log('Created membership for user in workspace');

  // Create sample products
  const products = await prisma.product.createMany({
    data: [
      {
        workspaceId: workspace.id,
        name: 'Remera Básica',
        description: 'Remera de algodón 100%',
        sku: 'REM-001',
        basePrice: 5000,
        status: 'ACTIVE',
      },
      {
        workspaceId: workspace.id,
        name: 'Jean Slim Fit',
        description: 'Jean de denim premium',
        sku: 'JEA-001',
        basePrice: 12000,
        status: 'ACTIVE',
      },
      {
        workspaceId: workspace.id,
        name: 'Zapatillas Running',
        description: 'Zapatillas deportivas livianas',
        sku: 'ZAP-001',
        basePrice: 28000,
        status: 'ACTIVE',
      },
    ],
  });
  console.log('Created', products.count, 'products');

  // Create sample customer
  const customer = await prisma.customer.create({
    data: {
      workspaceId: workspace.id,
      firstName: 'María',
      lastName: 'García',
      phone: '+5491155550001',
      email: 'maria@example.com',
    },
  });
  console.log('Created customer:', customer.firstName);

  console.log('Seed completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
EOF

# Agregar script a package.json de core
# Ejecutar seed
pnpm --filter @nexova/core exec prisma db seed
```

### Paso 6: Implementar Auth Service en Core

```bash
# Crear estructura de auth
mkdir -p packages/core/src/auth

# Crear auth.service.ts
cat > packages/core/src/auth/auth.service.ts << 'EOF'
import { PrismaClient, User } from '@prisma/client';
import { hash, verify } from 'argon2';
import { sign, verify as jwtVerify } from 'jsonwebtoken';
import { randomBytes } from 'crypto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
}

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new Error('Email already registered');
    }

    const passwordHash = await hash(data.password, {
      type: 2, // argon2id
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
      },
    });
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.passwordHash) {
      throw new Error('Invalid credentials');
    }

    const valid = await verify(user.passwordHash, password);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    return this.generateTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    // Verify token
    const payload = jwtVerify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET!
    ) as JwtPayload;

    if (payload.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Check if token exists in DB (not revoked)
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        token: refreshToken,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!storedToken) {
      throw new Error('Token revoked or expired');
    }

    // Revoke old token (rotation)
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // Generate new tokens
    return this.generateTokens(storedToken.user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revokedAt: new Date() },
    });
  }

  private async generateTokens(user: User): Promise<AuthTokens> {
    const accessToken = sign(
      { sub: user.id, email: user.email, type: 'access' },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m' }
    );

    const refreshToken = sign(
      { sub: user.id, email: user.email, type: 'refresh' },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    // Store refresh token
    await this.prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        userAgent: '', // TODO: pass from request
        ipAddress: '', // TODO: pass from request
      },
    });

    return { accessToken, refreshToken };
  }
}
EOF
```

### Paso 7: Implementar Fastify API Bootstrap

```bash
# Crear main.ts para API
cat > apps/api/src/main.ts << 'EOF'
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function bootstrap() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Security
  await app.register(helmet);
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
    credentials: true,
  });

  // Health checks
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  app.get('/health/ready', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ready', timestamp: new Date().toISOString() };
  });

  // API routes will be registered here
  // await app.register(authRoutes, { prefix: '/api/v1/auth' });
  // await app.register(workspaceRoutes, { prefix: '/api/v1/workspaces' });

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down...`);
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  // Start server
  const port = parseInt(process.env.API_PORT || '3000', 10);
  const host = process.env.API_HOST || '0.0.0.0';

  await app.listen({ port, host });
  app.log.info(`Server listening on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
EOF
```

### Paso 8: Configurar Scripts de Development

```bash
# Actualizar package.json del root
cat > package.json << 'EOF'
{
  "name": "nexova",
  "private": true,
  "packageManager": "pnpm@8.15.0",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "dev:api": "turbo run dev --filter=@nexova/api",
    "dev:dashboard": "turbo run dev --filter=@nexova/dashboard",
    "dev:worker": "turbo run dev --filter=@nexova/worker",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:coverage": "turbo run test:coverage",
    "clean": "turbo run clean && rm -rf node_modules",
    "db:generate": "pnpm --filter @nexova/core exec prisma generate",
    "db:migrate": "pnpm --filter @nexova/core exec prisma migrate dev",
    "db:push": "pnpm --filter @nexova/core exec prisma db push",
    "db:seed": "pnpm --filter @nexova/core exec prisma db seed",
    "db:studio": "pnpm --filter @nexova/core exec prisma studio",
    "docker:up": "docker compose -f docker/docker-compose.yml up -d",
    "docker:down": "docker compose -f docker/docker-compose.yml down",
    "docker:logs": "docker compose -f docker/docker-compose.yml logs -f",
    "prepare": "husky"
  },
  "devDependencies": {
    "@commitlint/cli": "^19.0.0",
    "@commitlint/config-conventional": "^19.0.0",
    "@types/node": "^20.11.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.56.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-import-resolver-typescript": "^3.6.0",
    "eslint-plugin-boundaries": "^4.2.0",
    "eslint-plugin-import": "^2.29.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.2.0",
    "prettier": "^3.2.0",
    "prisma": "^5.22.0",
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  }
}
EOF
```

### Paso 9: Instalar Dependencias de Auth

```bash
# Agregar dependencias a core
pnpm --filter @nexova/core add argon2 jsonwebtoken
pnpm --filter @nexova/core add -D @types/jsonwebtoken

# Agregar dependencias a api
pnpm --filter @nexova/api add fastify @fastify/cors @fastify/helmet @fastify/cookie pino-pretty
pnpm --filter @nexova/api add -D @types/node tsx
```

### Paso 10: Verificar Setup Completo

```bash
# Verificar TypeScript compila
pnpm typecheck

# Verificar ESLint pasa
pnpm lint

# Levantar todo en desarrollo
pnpm docker:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# En terminales separadas:
# Terminal 1: API
pnpm dev:api

# Terminal 2: Dashboard
pnpm dev:dashboard

# Verificar health check
curl http://localhost:3000/health

# Verificar dashboard
open http://localhost:5173
```

---

## Resumen de Dependencias por Fase

| Fase | Bloqueado por | Habilita |
|------|---------------|----------|
| 0    | -             | 1, 2, 3  |
| 1    | 0             | 2, 3     |
| 2    | 0, 1          | 3        |
| 3    | 0, 1, 2       | Production |

## Estimación de Esfuerzo

| Fase | Story Points | Complejidad |
|------|-------------|-------------|
| 0    | 21          | Media       |
| 1    | 34          | Alta        |
| 2    | 21          | Alta        |
| 3    | 13          | Media       |
| **Total** | **89** | -         |

---

*Documento generado como parte del diseño de arquitectura de Nexova Dashboard.*
