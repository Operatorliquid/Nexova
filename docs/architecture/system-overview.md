# ENTREGABLE 1: Visión General del Sistema

## 1. Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                   EDGE LAYER                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐              │
│  │   Infobip WA    │    │   Dashboard     │    │   Public API    │              │
│  │   Webhooks      │    │   (React SPA)   │    │   (future)      │              │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘              │
└───────────┼──────────────────────┼──────────────────────┼───────────────────────┘
            │                      │                      │
            ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER (Fastify)                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Webhook     │  │  Auth        │  │  REST        │  │  WebSocket   │         │
│  │  Controller  │  │  Controller  │  │  Controllers │  │  Gateway     │         │
│  │  (ingest)    │  │  (JWT/RBAC)  │  │  (CRUD ops)  │  │  (realtime)  │         │
│  └──────┬───────┘  └──────────────┘  └──────┬───────┘  └──────────────┘         │
│         │                                   │                                    │
│         │         ┌─────────────────────────┼─────────────────────┐             │
│         │         │      DOMAIN SERVICES    │                     │             │
│         │         │  ┌─────────┐ ┌─────────┐│┌─────────┐ ┌───────┐│             │
│         │         │  │ Session │ │  Order  │││  Stock  │ │Payment││             │
│         │         │  │ Service │ │ Service │││ Service │ │Service││             │
│         │         │  └─────────┘ └─────────┘│└─────────┘ └───────┘│             │
│         │         └─────────────────────────┼─────────────────────┘             │
│         │                                   │                                    │
│         ▼                                   ▼                                    │
│  ┌──────────────────────────────────────────────────────────────────┐           │
│  │                 EVENT OUTBOX + REALTIME PUB/SUB                   │           │
│  │              DB-backed outbox + Redis pub/sub                     │           │
│  └──────────────────────────────┬───────────────────────────────────┘           │
└─────────────────────────────────┼───────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              QUEUE LAYER (BullMQ)                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │ agent-process  │  │ message-send   │  │ outbox-relay   │  │ webhook-retry │  │
│  │ (agent work)   │  │ (WA outbound)  │  │ (event pub)    │  │ (failed retr) │  │
│  └───────┬────────┘  └───────┬────────┘  └───────┬────────┘  └───────────────┘  │
└──────────┼───────────────────┼───────────────────┼──────────────────────────────┘
           │                   │                   │
           ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            WORKER LAYER (separate process)                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         AGENT RUNTIME                                     │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │ State        │  │ LLM Provider │  │ Tool         │  │ Validator    │  │   │
│  │  │ Machine      │  │ (Claude)     │  │ Executor     │  │ (Zod+Schema) │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                  │
│  │ Message Sender  │  │ Outbox Relay    │  │ Scheduled Jobs  │                  │
│  │ Worker          │  │ Worker          │  │ Worker          │                  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────────┘
           │                   │                   │
           ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           INTEGRATION LAYER (Adapters)                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────────────────────────────┐               │
│  │ Infobip        │  │ Payments & Invoicing Adapters            │               │
│  │ Adapter        │  │ (MercadoPago, Arca/AFIP)                 │               │
│  │ (WA send/recv) │  │                                         │               │
│  └─────────────────┘  └─────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────────────────┘
           │                   │                   │
           ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────┐       ┌─────────────────────────────┐          │
│  │        PostgreSQL           │       │           Redis              │          │
│  │  ┌───────────────────────┐  │       │  ┌───────────────────────┐  │          │
│  │  │ Core Tables           │  │       │  │ Session Memory Cache  │  │          │
│  │  │ - workspaces          │  │       │  │ - agent:session:{id}  │  │          │
│  │  │ - users               │  │       │  │ (state + cart + ctx)  │  │          │
│  │  │ - roles/permissions   │  │       │  └───────────────────────┘  │          │
│  │  └───────────────────────┘  │       │  ┌───────────────────────┐  │          │
│  │  ┌───────────────────────┐  │       │  │ Rate Limiting         │  │          │
│  │  │ Domain Tables         │  │       │  │ - ratelimit:{key}     │  │          │
│  │  │ - agent_sessions      │  │       │  └───────────────────────┘  │          │
│  │  │ - agent_messages      │  │       │  ┌───────────────────────┐  │          │
│  │  │ - webhook_inbox       │  │       │  │ BullMQ Queues         │  │          │
│  │  │ - orders              │  │       │  │ - bull:agent:*        │  │          │
│  │  │ - order_items         │  │       │  │ - bull:message:*      │  │          │
│  │  │ - products            │  │       │  └───────────────────────┘  │          │
│  │  │ - stock               │  │       └─────────────────────────────┘          │
│  │  │ - payments            │  │                                                │
│  │  └───────────────────────┘  │                                                │
│  │  ┌───────────────────────┐  │                                                │
│  │  │ Audit Tables          │  │                                                │
│  │  │ - audit_logs          │  │                                                │
│  │  │ - event_outbox        │  │                                                │
│  │  └───────────────────────┘  │                                                │
│  └─────────────────────────────┘                                                │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Flujo de Datos Principal: WhatsApp Inbound → Response

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ Infobip │     │Webhook  │     │ Queue   │     │ Agent   │     │  LLM    │
│ (WA)    │     │Controller│    │(BullMQ) │     │ Runtime │     │(Claude) │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │               │
     │ POST /api/whatsapp/webhook │               │               │               │
     │──────────────►│               │               │               │
     │               │               │               │               │
     │               │ 1. Verify signature           │               │
     │               │ 2. Dedupe webhook_inbox       │               │
     │               │ 3. Parse & normalize          │               │
     │               │               │               │               │
     │               │ Enqueue job   │               │               │
     │               │──────────────►│               │               │
     │               │               │               │               │
     │  200 OK      │               │               │               │
     │◄──────────────│               │               │               │
     │               │               │               │               │
     │               │               │ Dequeue       │               │
     │               │               │──────────────►│               │
     │               │               │               │               │
     │               │               │               │ Load session  │
     │               │               │               │ state (Redis) │
     │               │               │               │               │
     │               │               │               │ Build context │
     │               │               │               │──────────────►│
     │               │               │               │               │
     │               │               │               │◄──────────────│
     │               │               │               │ Tool call req │
     │               │               │               │               │
     │               │               │               │ Validate (Zod)│
     │               │               │               │ Execute tool  │
     │               │               │               │ Log audit     │
     │               │               │               │               │
     │               │               │               │──────────────►│
     │               │               │               │ Tool result   │
     │               │               │               │               │
     │               │               │               │◄──────────────│
     │               │               │               │ Final response│
     │               │               │               │               │
     │               │               │ Enqueue       │               │
     │               │               │◄──────────────│               │
     │               │               │ message-send  │               │
     │               │               │               │               │
     │◄──────────────────────────────│               │               │
     │     Send WA message           │               │               │
     │     (via Infobip Adapter)     │               │               │
     │               │               │               │               │
```

### Detalle del flujo por pasos:

**1. Ingesta (API - síncrono, <100ms)**
- Infobip envía POST a `/api/v1/webhooks/infobip/:numberId` o `/api/whatsapp/webhook`
- Verificar firma HMAC si hay `webhookSecret` configurado
- Dedupe en `webhook_inbox` (unique workspace+provider+externalId)
- Persistir payload en `webhook_inbox` (status: `pending`)
- Enqueue job `agent-process` con `{ workspaceId, messageId, channelId, channelType, correlationId }`
- Responder 200 OK (procesamiento asíncrono)

**2. Procesamiento (Worker - asíncrono)**
- Worker toma job de `agent-process`
- Cargar/crear `agent_sessions` en DB
- Cargar estado desde Redis (`agent:session:{sessionId}`); si no existe → init `IDLE`
- Verificar `agentActive` y umbral de fallos

**3. Agent Runtime (Worker)**
- FSM decide transición válida
- Llamar LLM (Anthropic) con contexto + schemas de tools
- Ejecutar tools con validación Zod y registrar en `agent_tool_executions`
- Guardar mensajes en `agent_messages`
- Actualizar estado en Redis + snapshot en DB
- Handoff por keywords/heurísticas o fallos consecutivos

**4. Respuesta (Worker → Queue → Integration)**
- Enqueue `message-send` con `{ workspaceId, to, messageType, content, correlationId }`
- Message Sender usa Infobip Adapter
- Publica `event_outbox` (`message.sent`) y métricas de uso


---


## 3. Estrategia Event-Driven: Transactional Outbox

```
┌────────────────────────────────────────────────────────────────────────┐
│                    TRANSACTIONAL OUTBOX PATTERN                         │
└────────────────────────────────────────────────────────────────────────┘

┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Domain    │    │  PostgreSQL │    │   Outbox    │    │   Event     │
│   Service   │    │    (TX)     │    │   Relay     │    │  Handlers   │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │                  │
       │ BEGIN TX         │                  │                  │
       │─────────────────►│                  │                  │
       │                  │                  │                  │
       │ INSERT order     │                  │                  │
       │─────────────────►│                  │                  │
       │                  │                  │                  │
       │ INSERT outbox    │                  │                  │
       │ (order.created)  │                  │                  │
       │─────────────────►│                  │                  │
       │                  │                  │                  │
       │ COMMIT TX        │                  │                  │
       │─────────────────►│                  │                  │
       │                  │                  │                  │
       │                  │   Poll outbox    │                  │
       │                  │   (cada 5s)      │                  │
       │                  │◄─────────────────│                  │
       │                  │                  │                  │
       │                  │   Batch events   │                  │
       │                  │─────────────────►│                  │
       │                  │                  │                  │
       │                  │                  │ Publish to       │
       │                  │                  │ Redis pub/sub    │
       │                  │                  │─────────────────►│
       │                  │                  │                  │
       │                  │   Mark processed │                  │
       │                  │◄─────────────────│                  │
       │                  │                  │                  │
```

### Schema `event_outbox`:

```sql
CREATE TABLE event_outbox (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id),
  event_type     VARCHAR(100) NOT NULL,  -- 'order.created', 'session.handoff_requested'
  aggregate_type VARCHAR(50) NOT NULL,   -- 'Order', 'Session', 'Payment'
  aggregate_id   VARCHAR(255) NOT NULL,  -- ID de la entidad relacionada
  payload        JSONB NOT NULL,
  correlation_id UUID NULL,
  status         VARCHAR(20) DEFAULT 'pending',
  published_at   TIMESTAMPTZ NULL,
  error_message  TEXT NULL,
  retry_count    INT DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_event_outbox_status (status),
  INDEX idx_event_outbox_workspace_type (workspace_id, event_type)
);
```

### Eventos del dominio Comercial:


| Event Type | Trigger | Handlers |
|------------|---------|----------|
| `session.created` | Nueva conversación WA | Analytics, CRM sync |
| `session.handoff_requested` | Fallo agente o sentimiento negativo | Notificar dashboard, alerta operador |
| `order.created` | Tool `create_order` ejecutada | Stock reservation, Notification |
| `order.confirmed` | Usuario confirma pedido | Payment init, Stock commit |
| `order.cancelled` | Usuario cancela o timeout | Stock release |
| `payment.completed` | Webhook payment gateway | Order fulfillment, Receipt |
| `stock.low` | Stock bajo threshold | Alert, Auto-reorder (future) |

---

## 4. State Machine del Agente

```
┌───────────────────────────────────────────────────────────────────────┐
│                         AGENT STATE MACHINE                           │
└───────────────────────────────────────────────────────────────────────┘

IDLE
  ├─> COLLECTING_ORDER
  └─> HANDOFF

COLLECTING_ORDER
  ├─> NEEDS_DETAILS
  ├─> AWAITING_CONFIRMATION
  ├─> IDLE
  └─> HANDOFF

NEEDS_DETAILS
  ├─> COLLECTING_ORDER
  ├─> AWAITING_CONFIRMATION
  ├─> IDLE
  └─> HANDOFF

AWAITING_CONFIRMATION
  ├─> EXECUTING
  ├─> COLLECTING_ORDER
  ├─> IDLE
  └─> HANDOFF

EXECUTING
  ├─> DONE
  ├─> IDLE (error/retry)
  └─> HANDOFF

DONE
  ├─> IDLE
  └─> COLLECTING_ORDER

HANDOFF
  └─> IDLE (human release)
```

### Tabla de Estados y Transiciones:

| Estado Actual | Evento/Condición | Estado Siguiente | Acción |
|---------------|------------------|------------------|--------|
| `IDLE` | intent de pedido | `COLLECTING_ORDER` | Inicializa flujo de pedido |
| `COLLECTING_ORDER` | faltan datos cliente | `NEEDS_DETAILS` | Solicita datos mínimos |
| `COLLECTING_ORDER` | checkout válido | `AWAITING_CONFIRMATION` | Presenta resumen |
| `AWAITING_CONFIRMATION` | confirmación de usuario | `EXECUTING` | Ejecuta tools críticos |
| `EXECUTING` | éxito | `DONE` | Finaliza operación |
| `EXECUTING` | error / retry | `IDLE` | Resetea flujo |
| `DONE` | nuevo pedido | `COLLECTING_ORDER` | Reinicia flujo |
| `*` (any) | handoff requerido (keywords/fallos) | `HANDOFF` | Desactiva agente |
| `HANDOFF` | operador libera | `IDLE` | Rehabilita agente |

### Estructura del State en Redis:

```typescript
// Key: agent:session:{sessionId}
interface SessionMemory {
  sessionId: string;
  workspaceId: string;
  customerId: string;

  // State machine
  state: AgentState;

  // Cart y confirmaciones
  cart: Cart | null;
  pendingConfirmation: PendingConfirmation | null;

  // Contexto conversacional
  context: ConversationContext;
  lastActivityAt: ISO8601;
}
```

---
## 5. Distribución: API vs Worker

### API (Fastify - Proceso principal)

| Responsabilidad | Endpoint/Handler | Características |
|-----------------|------------------|-----------------|
| **Webhook ingestion** | `POST /api/v1/webhooks/infobip/:numberId` o `POST /api/whatsapp/webhook` | Validación, dedupe, enqueue. <100ms response |
| **Authentication** | `POST /auth/login`, `/auth/refresh` | JWT issue/refresh |
| **Dashboard REST** | `GET/POST/PUT /api/v1/*` | CRUD síncrono con RBAC |
| **WebSocket gateway** | `ws://*/ws` | Pub/sub para dashboard updates |
| **Health/Metrics** | `GET /health`, `/metrics` | Liveness, readiness, Prometheus |

```
REGLA: La API NUNCA ejecuta lógica de agente ni llamadas a LLM.
       Solo ingesta, autentica, sirve datos y encola trabajo.
```

### Workers (Procesos separados)

| Worker | Queue | Responsabilidad | Concurrency |
|--------|-------|-----------------|-------------|
| **AgentWorker** | `agent-process` | Ejecutar FSM + LLM + tools | 1 (configurable) |
| **MessageSender** | `message-send` | Enviar mensajes via Infobip adapter | 20 |
| **OutboxRelay** | `outbox-relay` | Poll DB, publicar eventos a Redis pub/sub | 1 |
| **WebhookRetry** | `webhook-retry` | Reintentar webhooks fallidos con backoff | 5 |
| **ScheduledJobs** | `scheduled-jobs` | Session cleanup, metrics aggregation | 2 |

### Diagrama de Procesos:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DEPLOYMENT VIEW                                  │
└─────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │                        Kubernetes Cluster                            │
  │                                                                      │
  │  ┌──────────────────────┐    ┌──────────────────────┐               │
  │  │   API Deployment     │    │  Worker Deployment   │               │
  │  │   (HPA: 2-10 pods)   │    │  (HPA: 2-8 pods)     │               │
  │  │                      │    │                      │               │
  │  │  ┌────────────────┐  │    │  ┌────────────────┐  │               │
  │  │  │ api-pod-1      │  │    │  │ worker-pod-1   │  │               │
  │  │  │ - Fastify      │  │    │  │ - AgentProc    │  │               │
  │  │  │ - REST/WS      │  │    │  │ - MsgSender    │  │               │
  │  │  └────────────────┘  │    │  │ - OutboxRelay  │  │               │
  │  │  ┌────────────────┐  │    │  └────────────────┘  │               │
  │  │  │ api-pod-2      │  │    │  ┌────────────────┐  │               │
  │  │  │ - Fastify      │  │    │  │ worker-pod-2   │  │               │
  │  │  │ - REST/WS      │  │    │  │ - AgentProc    │  │               │
  │  │  └────────────────┘  │    │  │ - MsgSender    │  │               │
  │  │         │            │    │  └────────────────┘  │               │
  │  └─────────┼────────────┘    └──────────┼───────────┘               │
  │            │                            │                            │
  │            ▼                            ▼                            │
  │  ┌──────────────────────────────────────────────────────────────┐   │
  │  │                      Shared Services                          │   │
  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │   │
  │  │  │ PostgreSQL  │  │   Redis     │  │   Sentry    │           │   │
  │  │  │ (Primary +  │  │  (Cluster)  │  │   (SaaS)    │           │   │
  │  │  │  Replicas)  │  │             │  │             │           │   │
  │  │  └─────────────┘  └─────────────┘  └─────────────┘           │   │
  │  └──────────────────────────────────────────────────────────────┘   │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## ASSUMPTIONS

1. **ASSUMPTION:** Infobip soporta verificación de webhook via HMAC signature header (`x-hub-signature` o similar).

2. **ASSUMPTION:** El payment gateway será MercadoPago para Latam; el adapter será abstracto para soportar otros en el futuro.

3. **ASSUMPTION:** La confirmación humana en `AWAITING_CONFIRMATION → EXECUTING` se implementa como un mensaje explícito del usuario ("Confirmo", "Sí, proceder") parseado por el LLM, no como un botón de UI en WhatsApp (limitación del canal).

4. **ASSUMPTION:** El threshold de stock bajo (`stock.low` event) será configurable por workspace, default 10 unidades.

5. **ASSUMPTION:** Session timeout para inactividad es 24 horas; cart timeout es 30 minutos post-confirmación de orden.

6. **ASSUMPTION:** El handoff por sentimiento se hace hoy con heurísticas de keywords; no hay tool dedicada de análisis de sentimiento.

7. **ASSUMPTION:** Outbox relay polling interval es 5 segundos (configurable); en producción puede optimizarse con `LISTEN/NOTIFY` de PostgreSQL.
