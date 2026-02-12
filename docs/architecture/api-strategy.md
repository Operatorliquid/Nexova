# ENTREGABLE 6: Estrategia de API e Integraciones

## Visión General

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API ARCHITECTURE                                    │
└─────────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────────────┐
                    │              EDGE / CDN                  │
                    │         (Rate Limiting, WAF)             │
                    └─────────────────────┬───────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
        ▼                                 ▼                                 ▼
┌───────────────┐                ┌───────────────┐                ┌───────────────┐
│   Dashboard   │                │   Webhooks    │                │  Public API   │
│   /api/v1/*   │                │  /webhooks/*  │                │   (future)    │
│               │                │               │                │               │
│  - REST API   │                │  - Infobip    │                │  - OAuth2     │
│  - WebSocket  │                │  - MercadoPago│                │  - API Keys   │
│  - JWT Auth   │                │  - Signature  │                │               │
└───────┬───────┘                └───────┬───────┘                └───────────────┘
        │                                │
        │         ┌──────────────────────┘
        │         │
        ▼         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           FASTIFY API SERVER                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  Plugins: Auth, RBAC, RequestContext, ErrorHandler, RateLimit, Swagger          │
└─────────────────────────────────────────────────────────────────────────────────┘
        │                                │
        ▼                                ▼
┌───────────────┐                ┌───────────────┐
│    Sync       │                │    Async      │
│  Operations   │                │  (Enqueue)    │
│               │                │               │
│  - CRUD       │                │  - Agent job  │
│  - Queries    │                │  - Message    │
│  - Auth       │                │  - Events     │
└───────────────┘                └───────┬───────┘
                                         │
                                         ▼
                                ┌───────────────┐
                                │    BullMQ     │
                                │    Queues     │
                                └───────────────┘
```

---

## 1. Endpoints por Módulo

### Base URL
```
Production:  https://api.nexova.io
Staging:     https://api.staging.nexova.io
Development: http://localhost:3000
```

### Versionado
```
/api/v1/*  - Versión estable
/api/v2/*  - Nueva versión (cuando aplique)
```

---

### 1.1 Auth Module (`/api/v1/auth`)

| Method | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| POST | `/auth/register` | Registro de usuario | Public |
| POST | `/auth/login` | Login con email/password | Public |
| POST | `/auth/refresh` | Refresh access token | Refresh Token |
| POST | `/auth/logout` | Logout (revoke tokens) | JWT |
| POST | `/auth/forgot-password` | Solicitar reset password | Public |
| POST | `/auth/reset-password` | Ejecutar reset password | Reset Token |
| GET | `/auth/me` | Obtener usuario actual | JWT |
| PUT | `/auth/me` | Actualizar perfil | JWT |
| POST | `/auth/mfa/enable` | Habilitar MFA | JWT |
| POST | `/auth/mfa/verify` | Verificar código MFA | JWT |
| POST | `/auth/mfa/disable` | Deshabilitar MFA | JWT + MFA |

```typescript
// POST /api/v1/auth/login
// Request
{
  "email": "user@example.com",
  "password": "securepassword",
  "mfaCode": "123456"  // Optional, required if MFA enabled
}

// Response 200
{
  "accessToken": "eyJhbG...",
  "refreshToken": "dGhpcyBpcyBh...",
  "expiresIn": 900,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "mfaEnabled": true
  }
}
```

---

### 1.2 Workspaces Module (`/api/v1/workspaces`)

| Method | Endpoint | Descripción | Permission |
|--------|----------|-------------|------------|
| GET | `/workspaces` | Listar workspaces del usuario | `workspaces:read` |
| POST | `/workspaces` | Crear workspace | `workspaces:create` |
| GET | `/workspaces/:id` | Obtener workspace | `workspaces:read` |
| PUT | `/workspaces/:id` | Actualizar workspace | `workspaces:update` |
| DELETE | `/workspaces/:id` | Eliminar workspace | `workspaces:delete` |
| GET | `/workspaces/:id/members` | Listar miembros | `members:read` |
| POST | `/workspaces/:id/members` | Invitar miembro | `members:create` |
| PUT | `/workspaces/:id/members/:userId` | Actualizar rol | `members:update` |
| DELETE | `/workspaces/:id/members/:userId` | Remover miembro | `members:delete` |
| GET | `/workspaces/:id/roles` | Listar roles | `roles:read` |
| POST | `/workspaces/:id/roles` | Crear rol | `roles:create` |
| GET | `/workspaces/:id/settings` | Obtener settings | `settings:read` |
| PUT | `/workspaces/:id/settings` | Actualizar settings | `settings:update` |

```typescript
// GET /api/v1/workspaces/:id
// Response 200
{
  "id": "uuid",
  "slug": "acme-corp",
  "name": "Acme Corporation",
  "plan": "professional",
  "status": "active",
  "settings": {
    "timezone": "America/Buenos_Aires",
    "locale": "es-AR",
    "currency": "ARS"
  },
  "limits": {
    "messagesPerMonth": 10000,
    "agentSessionsPerDay": 500,
    "productsLimit": 1000
  },
  "createdAt": "2024-01-15T10:00:00Z"
}
```

---

### 1.3 Retail Module (`/api/v1/retail`)

#### Products

| Method | Endpoint | Descripción | Permission |
|--------|----------|-------------|------------|
| GET | `/retail/products` | Listar productos | `products:read` |
| POST | `/retail/products` | Crear producto | `products:create` |
| GET | `/retail/products/:id` | Obtener producto | `products:read` |
| PUT | `/retail/products/:id` | Actualizar producto | `products:update` |
| DELETE | `/retail/products/:id` | Eliminar producto | `products:delete` |
| POST | `/retail/products/:id/variants` | Crear variante | `products:update` |
| PUT | `/retail/products/:id/variants/:variantId` | Actualizar variante | `products:update` |
| POST | `/retail/products/import` | Import CSV/Excel | `products:create` |
| GET | `/retail/products/export` | Export CSV | `products:read` |

```typescript
// GET /api/v1/retail/products?status=active&category=Electronics&page=1&limit=20
// Response 200
{
  "data": [
    {
      "id": "uuid",
      "sku": "PHONE-001",
      "name": "Smartphone XYZ",
      "description": "Latest smartphone...",
      "price": 150000,  // $1500.00 in cents
      "currency": "ARS",
      "category": "Electronics > Phones",
      "status": "active",
      "stock": {
        "available": 45,
        "reserved": 5
      },
      "images": ["https://..."],
      "variants": []
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

#### Stock

| Method | Endpoint | Descripción | Permission |
|--------|----------|-------------|------------|
| GET | `/retail/stock` | Listar stock | `stock:read` |
| GET | `/retail/stock/:productId` | Stock de producto | `stock:read` |
| POST | `/retail/stock/:productId/adjust` | Ajustar stock | `stock:adjust` |
| GET | `/retail/stock/movements` | Historial movimientos | `stock:read` |
| GET | `/retail/stock/low` | Productos bajo stock | `stock:read` |
| GET | `/retail/stock/reservations` | Reservas activas | `stock:read` |

```typescript
// POST /api/v1/retail/stock/:productId/adjust
// Request
{
  "adjustmentType": "increase",
  "quantity": 50,
  "reason": "Received shipment from supplier",
  "reference": "PO-2024-001",
  "location": "warehouse-1"
}

// Response 200
{
  "movementId": "uuid",
  "productId": "uuid",
  "previousQuantity": 45,
  "adjustment": 50,
  "newQuantity": 95,
  "available": 90,
  "reserved": 5
}
```

#### Customers

| Method | Endpoint | Descripción | Permission |
|--------|----------|-------------|------------|
| GET | `/retail/customers` | Listar clientes | `customers:read` |
| POST | `/retail/customers` | Crear cliente | `customers:create` |
| GET | `/retail/customers/:id` | Obtener cliente | `customers:read` |
| PUT | `/retail/customers/:id` | Actualizar cliente | `customers:update` |
| DELETE | `/retail/customers/:id` | Eliminar cliente | `customers:delete` |
| GET | `/retail/customers/:id/orders` | Pedidos del cliente | `orders:read` |
| GET | `/retail/customers/search` | Buscar por teléfono/email | `customers:read` |

#### Orders

| Method | Endpoint | Descripción | Permission |
|--------|----------|-------------|------------|
| GET | `/retail/orders` | Listar pedidos | `orders:read` |
| POST | `/retail/orders` | Crear pedido | `orders:create` |
| GET | `/retail/orders/:id` | Obtener pedido | `orders:read` |
| PUT | `/retail/orders/:id` | Actualizar pedido | `orders:update` |
| POST | `/retail/orders/:id/items` | Agregar item | `orders:update` |
| DELETE | `/retail/orders/:id/items/:itemId` | Remover item | `orders:update` |
| POST | `/retail/orders/:id/confirm` | Confirmar pedido | `orders:confirm` |
| POST | `/retail/orders/:id/cancel` | Cancelar pedido | `orders:cancel` |
| POST | `/retail/orders/:id/ship` | Marcar enviado | `orders:update` |
| POST | `/retail/orders/:id/deliver` | Marcar entregado | `orders:update` |
| GET | `/retail/orders/:id/history` | Historial de estados | `orders:read` |

```typescript
// GET /api/v1/retail/orders?status=pending_payment&from=2024-01-01&to=2024-01-31
// Response 200
{
  "data": [
    {
      "id": "uuid",
      "orderNumber": "ORD-2024-00001",
      "status": "pending_payment",
      "customer": {
        "id": "uuid",
        "name": "Juan Pérez",
        "phone": "+5491155551234"
      },
      "items": [
        {
          "id": "uuid",
          "productId": "uuid",
          "sku": "PHONE-001",
          "name": "Smartphone XYZ",
          "quantity": 2,
          "unitPrice": 150000,
          "total": 300000
        }
      ],
      "totals": {
        "subtotal": 300000,
        "discount": 0,
        "shipping": 5000,
        "tax": 63000,
        "total": 368000
      },
      "createdAt": "2024-01-15T10:00:00Z",
      "sessionId": "uuid"
    }
  ],
  "pagination": {...}
}
```

#### Payments

| Method | Endpoint | Descripción | Permission |
|--------|----------|-------------|------------|
| GET | `/retail/payments` | Listar pagos | `payments:read` |
| GET | `/retail/payments/:id` | Obtener pago | `payments:read` |
| POST | `/retail/orders/:orderId/payments` | Registrar pago | `payments:create` |
| POST | `/retail/payments/:id/refund` | Procesar refund | `payments:refund` |
| POST | `/retail/payments/:id/attachments` | Adjuntar recibo | `payments:update` |

---

### 1.4 Connections Module (`/api/v1/connections`)

| Method | Endpoint | Descripción | Permission |
|--------|----------|-------------|------------|
| GET | `/connections` | Listar conexiones | `connections:read` |
| POST | `/connections` | Crear conexión | `connections:create` |
| GET | `/connections/:id` | Obtener conexión | `connections:read` |
| PUT | `/connections/:id` | Actualizar conexión | `connections:update` |
| DELETE | `/connections/:id` | Eliminar conexión | `connections:delete` |
| POST | `/connections/:id/test` | Probar conexión | `connections:read` |
| POST | `/connections/:id/rotate` | Rotar credenciales | `connections:update` |

```typescript
// POST /api/v1/connections
// Request
{
  "provider": "infobip",
  "name": "WhatsApp Production",
  "credentials": {
    "apiKey": "xxx...",
    "baseUrl": "https://xxx.api.infobip.com",
    "senderNumber": "+5491155550000"
  },
  "config": {
    "webhookSecret": "xxx..."
  }
}

// Response 201
{
  "id": "uuid",
  "provider": "infobip",
  "name": "WhatsApp Production",
  "status": "inactive",
  "healthStatus": null,
  "createdAt": "2024-01-15T10:00:00Z"
}
```

---

### 1.5 Agent Module (`/api/v1/agent`)

| Method | Endpoint | Descripción | Permission |
|--------|----------|-------------|------------|
| GET | `/agent/sessions` | Listar sesiones | `sessions:read` |
| GET | `/agent/sessions/:id` | Obtener sesión | `sessions:read` |
| GET | `/agent/sessions/:id/messages` | Mensajes de sesión | `sessions:read` |
| GET | `/agent/sessions/:id/tools` | Tool executions | `sessions:read` |
| POST | `/agent/sessions/:id/takeover` | Tomar control (handoff) | `sessions:takeover` |
| POST | `/agent/sessions/:id/release` | Devolver al agente | `sessions:release` |
| POST | `/agent/sessions/:id/message` | Enviar mensaje manual | `sessions:message` |
| GET | `/agent/handoffs` | Listar handoffs pendientes | `handoffs:read` |
| POST | `/agent/handoffs/:id/claim` | Reclamar handoff | `handoffs:claim` |
| POST | `/agent/handoffs/:id/resolve` | Resolver handoff | `handoffs:resolve` |

```typescript
// GET /api/v1/agent/sessions?status=active&agentActive=true
// Response 200
{
  "data": [
    {
      "id": "uuid",
      "customer": {
        "id": "uuid",
        "phone": "+5491155551234",
        "name": "Juan Pérez"
      },
      "channelType": "whatsapp",
      "currentState": "COLLECTING_ORDER",
      "agentActive": true,
      "failureCount": 0,
      "cart": {
        "itemCount": 2,
        "total": 300000
      },
      "lastActivityAt": "2024-01-15T10:05:00Z",
      "startedAt": "2024-01-15T10:00:00Z"
    }
  ],
  "pagination": {...}
}

// POST /api/v1/agent/sessions/:id/takeover
// Response 200
{
  "sessionId": "uuid",
  "previousState": "COLLECTING_ORDER",
  "newState": "HANDOFF",
  "agentActive": false,
  "takenOverBy": "user-uuid",
  "takenOverAt": "2024-01-15T10:10:00Z"
}
```

---

### 1.6 WebSocket Gateway (`/ws`)

```typescript
// Connection
ws://api.nexova.io/ws?token=<accessToken>

// Subscribe to workspace events
{
  "type": "subscribe",
  "channels": [
    "sessions:*",       // All session events
    "orders:*",         // All order events
    "handoffs:pending"  // Pending handoffs
  ]
}

// Event: New message in session
{
  "type": "event",
  "channel": "sessions:messages",
  "data": {
    "sessionId": "uuid",
    "messageId": "uuid",
    "role": "user",
    "content": "Quiero agregar otro producto",
    "timestamp": "2024-01-15T10:05:00Z"
  }
}

// Event: Handoff requested
{
  "type": "event",
  "channel": "handoffs:pending",
  "data": {
    "handoffId": "uuid",
    "sessionId": "uuid",
    "trigger": "failure_threshold",
    "priority": "high",
    "customer": {
      "phone": "+5491155551234",
      "name": "Juan Pérez"
    }
  }
}
```

---

## 2. Webhooks

### 2.1 Infobip WhatsApp Webhook

#### Endpoint
```
POST /api/whatsapp/webhook
```

#### Headers
```
X-Hub-Signature: sha256=<hmac_signature>
Content-Type: application/json
```

#### Inbound Message
```typescript
// Infobip inbound message payload
{
  "results": [
    {
      "messageId": "ABGGFlA5FpafAgo6tHcNmNjXmuSf",
      "from": "5491155551234",
      "to": "5491155550000",
      "receivedAt": "2024-01-15T10:00:00.000Z",
      "price": {
        "pricePerMessage": 0.001,
        "currency": "USD"
      },
      "message": {
        "type": "TEXT",
        "text": "Hola, quiero ver los productos"
      },
      "contact": {
        "name": "Juan Pérez"
      }
    }
  ]
}

// Normalized internal format
{
  "messageId": "ABGGFlA5FpafAgo6tHcNmNjXmuSf",
  "from": "+5491155551234",
  "to": "+5491155550000",
  "timestamp": "2024-01-15T10:00:00.000Z",
  "type": "text",
  "content": {
    "text": "Hola, quiero ver los productos"
  },
  "contact": {
    "name": "Juan Pérez"
  },
  "raw": { /* original payload */ }
}
```

#### Delivery Report
```typescript
// Infobip delivery report
{
  "results": [
    {
      "messageId": "msg-uuid",
      "to": "5491155551234",
      "sentAt": "2024-01-15T10:00:00.000Z",
      "doneAt": "2024-01-15T10:00:01.000Z",
      "status": {
        "groupId": 3,
        "groupName": "DELIVERED",
        "id": 5,
        "name": "DELIVERED_TO_HANDSET"
      },
      "error": null
    }
  ]
}
```

#### Processing Flow
```
1. Receive POST /api/whatsapp/webhook
2. Verify X-Hub-Signature (HMAC-SHA256) if configured
3. Extract workspace from phone number mapping
4. Check idempotency in webhook_inbox (DB unique)
5. If duplicate → 200 OK (already processed)
6. Store in webhook_inbox (status: pending)
7. Enqueue to agent-process queue
8. Return 200 OK
```


---

### 2.2 MercadoPago Webhook

#### Endpoint
```
POST /webhooks/mercadopago/ipn
```

#### Payload
```typescript
{
  "action": "payment.created",
  "api_version": "v1",
  "data": {
    "id": "1234567890"
  },
  "date_created": "2024-01-15T10:00:00.000-03:00",
  "id": "webhook-uuid",
  "live_mode": true,
  "type": "payment",
  "user_id": "123456"
}
```

---

## 3. Message Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         MESSAGE PROCESSING PIPELINE                              │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Infobip  │    │ Webhook  │    │  Redis   │    │ Webhook  │    │  Queue   │
│ Webhook  │───►│Controller│───►│Idempotent│───►│  Inbox   │───►│ Enqueue  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │                               │               │
                     │ Verify                        │ Store         │ agent-process
                     │ Signature                     │ Raw           │
                     ▼                               ▼               ▼
               ┌──────────┐                    ┌──────────┐    ┌──────────┐
               │  Reject  │                    │PostgreSQL│    │  BullMQ  │
               │   401    │                    └──────────┘    └────┬─────┘
               └──────────┘                                         │
                                                                    │
     ┌──────────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Worker  │───►│  Load    │───►│  State   │───►│  Build   │───►│   LLM    │
│  Dequeue │    │  Session │    │  Machine │    │ Context  │    │  Call    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │               │               │               │
                     │ Redis         │ Validate      │ History +     │ Claude
                     │ + PostgreSQL  │ Transition    │ Tools         │ Sonnet
                     ▼               ▼               ▼               ▼
               ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
               │ Create   │    │ Update   │    │ Token    │    │Tool Calls│
               │ Session  │    │ State    │    │ Limit    │    │+ Response│
               └──────────┘    └──────────┘    └──────────┘    └────┬─────┘
                                                                    │
     ┌──────────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Parse   │───►│ Validate │───►│ Execute  │───►│  Audit   │───►│  Update  │
│Tool Calls│    │   Zod    │    │   Tool   │    │   Log    │    │  State   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │               │               │
     │ Extract       │ Schema        │ Domain        │ PostgreSQL    │ Redis
     │ tool_use      │ Validation    │ Service       │               │
     ▼               ▼               ▼               ▼               ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Loop if  │    │ Reject   │    │  Result  │    │agent_tool│    │  Persist │
│ multiple │    │ Invalid  │    │   JSON   │    │_executions    │ Snapshot │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                                    │
     ┌──────────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Build   │───►│  Enqueue │───►│  Worker  │───►│ Infobip  │───►│  Update  │
│ Response │    │msg:send  │    │  Send    │    │   API    │    │  Status  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                     │               │
                                                     │ HTTP          │ messages
                                                     │ POST          │ table
                                                     ▼               ▼
                                               ┌──────────┐    ┌──────────┐
                                               │ WhatsApp │    │  Sent    │
                                               │ Message  │    │  Status  │
                                               └──────────┘    └──────────┘
```

### Pipeline Stages Detail

```typescript
// Stage 1: Webhook Ingestion (API Process)
async function handleWebhook(req: Request): Promise<Response> {
  // 1.1 Verify signature
  const signature = req.headers['x-hub-signature'];
  if (!verifyHmac(req.body, signature, secret)) {
    return { status: 401, body: 'Invalid signature' };
  }

  // 1.2 Parse and normalize
  const messages = parseInfobipPayload(req.body);

  for (const msg of messages) {
    // 1.3 Idempotency check
    const isNew = await redis.set(
      `webhook_inbox.unique(workspaceId, provider, externalId)`,
      '1',
      'NX',
      'EX',
      86400
    );

    if (!isNew) {
      continue; // Already processed
    }

    // 1.4 Resolve workspace
    const workspace = await resolveWorkspaceByPhone(msg.to);

    // 1.5 Store in inbox
    await db.webhookInbox.create({
      workspaceId: workspace.id,
      provider: 'infobip',
      externalId: msg.messageId,
      eventType: 'message.inbound',
      payload: msg,
      status: 'received'
    });

    // 1.6 Enqueue for processing
    await agentQueue.add('process', {
      workspaceId: workspace.id,
      messageId: msg.messageId,
      channelId: msg.from,
      channelType: 'whatsapp'
    }, {
      jobId: `agent:${msg.messageId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    });
  }

  return { status: 202, body: 'Accepted' };
}
```

---

## 4. BullMQ Queues

### Queue Definitions

```typescript
// packages/shared/src/constants/queues.ts

export const QUEUES = {
  // ═══════════════════════════════════════════════════════════════════════
  // AGENT PROCESSING
  // ═══════════════════════════════════════════════════════════════════════
  AGENT_PROCESS: {
    name: 'agent-process',
    description: 'Main agent processing queue for inbound messages',
    concurrency: 10,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    timeout: 60000,  // 60s max per job
  },

  // ═══════════════════════════════════════════════════════════════════════
  // MESSAGE SENDING
  // ═══════════════════════════════════════════════════════════════════════
  MESSAGE_SEND: {
    name: 'message-send',
    description: 'Outbound message delivery via integrations',
    concurrency: 20,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    timeout: 30000,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EVENT OUTBOX
  // ═══════════════════════════════════════════════════════════════════════
  OUTBOX_RELAY: {
    name: 'outbox-relay',
    description: 'Transactional outbox event relay',
    concurrency: 1,  // Singleton to preserve ordering
    attempts: 10,
    backoff: { type: 'exponential', delay: 500 },
    timeout: 10000,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // WEBHOOK RETRY
  // ═══════════════════════════════════════════════════════════════════════
  WEBHOOK_RETRY: {
    name: 'webhook-retry',
    description: 'Retry failed webhook processing',
    concurrency: 5,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    timeout: 60000,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SCHEDULED JOBS
  // ═══════════════════════════════════════════════════════════════════════
  SCHEDULED: {
    name: 'scheduled:jobs',
    description: 'Scheduled/cron jobs',
    concurrency: 2,
    attempts: 3,
    backoff: { type: 'fixed', delay: 60000 },
    timeout: 300000,  // 5 min for batch jobs
  },

  // ═══════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════
  NOTIFICATION: {
    name: 'notification:send',
    description: 'Send notifications (email, push, etc.)',
    concurrency: 10,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    timeout: 30000,
  },
} as const;
```

### Queue Payloads

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// agent-process
// ═══════════════════════════════════════════════════════════════════════════
interface AgentProcessPayload {
  workspaceId: string;
  messageId: string;       // External message ID (for idempotency)
  channelId: string;       // Customer phone number
  channelType: 'whatsapp' | 'web' | 'api';
  correlationId: string;   // For tracing
  priority?: 'high' | 'normal' | 'low';
  metadata?: {
    customerName?: string;
    isReply?: boolean;
    referredMessageId?: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// message-send
// ═══════════════════════════════════════════════════════════════════════════
interface MessageSendPayload {
  workspaceId: string;
  sessionId: string;
  to: string;              // Recipient phone number
  messageType: 'text' | 'template' | 'media' | 'interactive';
  content: {
    text?: string;
    templateId?: string;
    templateParams?: Record<string, string>;
    mediaUrl?: string;
    buttons?: Array<{ id: string; title: string }>;
  };
  correlationId: string;
  replyToMessageId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// outbox-relay
// ═══════════════════════════════════════════════════════════════════════════
interface OutboxRelayPayload {
  batchSize: number;       // How many events to process
  maxAge?: number;         // Only process events older than X ms
}

// ═══════════════════════════════════════════════════════════════════════════
// webhook-retry
// ═══════════════════════════════════════════════════════════════════════════
interface WebhookRetryPayload {
  webhookInboxId: string;
  workspaceId: string;
  attempt: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// scheduled:jobs
// ═══════════════════════════════════════════════════════════════════════════
interface ScheduledJobPayload {
  jobType:
    | 'session:cleanup'        // Close inactive sessions
    | 'reservation:expire'     // Expire stock reservations
    | 'draft:expire'          // Expire order drafts
    | 'usage:aggregate'       // Aggregate usage metrics
    | 'connection:health'     // Check integration health
    | 'memory:prune';         // Prune old agent memories
  workspaceId?: string;       // null = all workspaces
  params?: Record<string, unknown>;
}
```

### Retry & DLQ Policy

```typescript
// apps/worker/src/queues/config.ts

import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

const connection = new Redis(process.env.REDIS_URL);

// ═══════════════════════════════════════════════════════════════════════════
// DLQ (Dead Letter Queue) Configuration
// ═══════════════════════════════════════════════════════════════════════════

const DLQ_CONFIG = {
  // After all retries exhausted, move to DLQ
  removeOnComplete: {
    age: 24 * 60 * 60,  // Keep completed jobs for 24h
    count: 1000,        // Keep last 1000 completed
  },
  removeOnFail: false,   // Keep failed jobs for analysis
};

// ═══════════════════════════════════════════════════════════════════════════
// Queue Factory
// ═══════════════════════════════════════════════════════════════════════════

export function createQueue(config: QueueConfig): Queue {
  const queue = new Queue(config.name, {
    connection,
    defaultJobOptions: {
      attempts: config.attempts,
      backoff: config.backoff,
      timeout: config.timeout,
      ...DLQ_CONFIG,
    },
  });

  // DLQ: Move exhausted jobs to dead letter queue
  const events = new QueueEvents(config.name, { connection });

  events.on('failed', async ({ jobId, failedReason, prev }) => {
    if (prev === 'waiting') return; // Will retry

    // All retries exhausted - move to DLQ
    const job = await queue.getJob(jobId);
    if (job && job.attemptsMade >= config.attempts) {
      await dlqQueue.add('dead-letter', {
        originalQueue: config.name,
        jobId,
        payload: job.data,
        error: failedReason,
        attempts: job.attemptsMade,
        failedAt: new Date().toISOString(),
      });

      // Alert on DLQ
      await alertService.send({
        severity: 'warning',
        title: `Job moved to DLQ: ${config.name}`,
        message: failedReason,
        metadata: { jobId, queue: config.name },
      });
    }
  });

  return queue;
}

// ═══════════════════════════════════════════════════════════════════════════
// Retry Strategies
// ═══════════════════════════════════════════════════════════════════════════

export const RETRY_STRATEGIES = {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s...
  exponential: (attemptsMade: number, baseDelay: number) => {
    return Math.min(baseDelay * Math.pow(2, attemptsMade), 30000);
  },

  // Linear backoff: 1s, 2s, 3s, 4s...
  linear: (attemptsMade: number, baseDelay: number) => {
    return Math.min(baseDelay * attemptsMade, 30000);
  },

  // Fixed delay
  fixed: (_attemptsMade: number, delay: number) => {
    return delay;
  },
};
```

### Scheduled Jobs (Cron)

```typescript
// apps/worker/src/scheduled/index.ts

import { Queue } from 'bullmq';

export function setupScheduledJobs(scheduledQueue: Queue): void {
  // ═══════════════════════════════════════════════════════════════════════
  // Session Cleanup - Every 5 minutes
  // Close sessions inactive for 24+ hours
  // ═══════════════════════════════════════════════════════════════════════
  scheduledQueue.add(
    'session:cleanup',
    { jobType: 'session:cleanup' },
    {
      repeat: { pattern: '*/5 * * * *' },
      jobId: 'session:cleanup',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Stock Reservation Expiry - Every minute
  // Release expired stock reservations
  // ═══════════════════════════════════════════════════════════════════════
  scheduledQueue.add(
    'reservation:expire',
    { jobType: 'reservation:expire' },
    {
      repeat: { pattern: '* * * * *' },
      jobId: 'reservation:expire',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Draft Expiry - Every 5 minutes
  // Expire abandoned order drafts
  // ═══════════════════════════════════════════════════════════════════════
  scheduledQueue.add(
    'draft:expire',
    { jobType: 'draft:expire' },
    {
      repeat: { pattern: '*/5 * * * *' },
      jobId: 'draft:expire',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Usage Aggregation - Every hour
  // Aggregate usage metrics for billing
  // ═══════════════════════════════════════════════════════════════════════
  scheduledQueue.add(
    'usage:aggregate',
    { jobType: 'usage:aggregate' },
    {
      repeat: { pattern: '0 * * * *' },
      jobId: 'usage:aggregate',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Connection Health Check - Every 5 minutes
  // Check all integration connections
  // ═══════════════════════════════════════════════════════════════════════
  scheduledQueue.add(
    'connection:health',
    { jobType: 'connection:health' },
    {
      repeat: { pattern: '*/5 * * * *' },
      jobId: 'connection:health',
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Memory Pruning - Daily at 3 AM
  // Prune old agent memories
  // ═══════════════════════════════════════════════════════════════════════
  scheduledQueue.add(
    'memory:prune',
    { jobType: 'memory:prune' },
    {
      repeat: { pattern: '0 3 * * *' },
      jobId: 'memory:prune',
    }
  );
}
```

---

## 5. Observability

### 5.1 Métricas Clave (Prometheus)

```typescript
// packages/core/src/observability/metrics.ts

import { Counter, Histogram, Gauge, Registry } from 'prom-client';

const registry = new Registry();

// ═══════════════════════════════════════════════════════════════════════════
// HTTP METRICS
// ═══════════════════════════════════════════════════════════════════════════

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status', 'workspace_id'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK METRICS
// ═══════════════════════════════════════════════════════════════════════════

export const webhooksReceived = new Counter({
  name: 'webhooks_received_total',
  help: 'Total webhooks received',
  labelNames: ['provider', 'event_type', 'workspace_id'],
  registers: [registry],
});

export const webhooksProcessed = new Counter({
  name: 'webhooks_processed_total',
  help: 'Total webhooks processed',
  labelNames: ['provider', 'event_type', 'status', 'workspace_id'],
  registers: [registry],
});

export const webhookDuplicates = new Counter({
  name: 'webhook_duplicates_total',
  help: 'Duplicate webhooks detected (idempotency)',
  labelNames: ['provider'],
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENT METRICS
// ═══════════════════════════════════════════════════════════════════════════

export const agentSessionsActive = new Gauge({
  name: 'agent_sessions_active',
  help: 'Currently active agent sessions',
  labelNames: ['workspace_id', 'state'],
  registers: [registry],
});

export const agentMessagesProcessed = new Counter({
  name: 'agent_messages_processed_total',
  help: 'Total messages processed by agent',
  labelNames: ['workspace_id', 'status'],
  registers: [registry],
});

export const agentProcessingDuration = new Histogram({
  name: 'agent_processing_duration_seconds',
  help: 'Agent message processing duration',
  labelNames: ['workspace_id'],
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [registry],
});

export const agentToolExecutions = new Counter({
  name: 'agent_tool_executions_total',
  help: 'Total tool executions by agent',
  labelNames: ['workspace_id', 'tool_name', 'status'],
  registers: [registry],
});

export const agentHandoffs = new Counter({
  name: 'agent_handoffs_total',
  help: 'Total handoff requests',
  labelNames: ['workspace_id', 'trigger'],
  registers: [registry],
});

export const agentFailures = new Counter({
  name: 'agent_failures_total',
  help: 'Agent failures (errors, timeouts)',
  labelNames: ['workspace_id', 'error_type'],
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// LLM METRICS
// ═══════════════════════════════════════════════════════════════════════════

export const llmRequests = new Counter({
  name: 'llm_requests_total',
  help: 'Total LLM API requests',
  labelNames: ['provider', 'model', 'status'],
  registers: [registry],
});

export const llmTokensUsed = new Counter({
  name: 'llm_tokens_used_total',
  help: 'Total LLM tokens used',
  labelNames: ['provider', 'model', 'type'], // type: input, output
  registers: [registry],
});

export const llmLatency = new Histogram({
  name: 'llm_latency_seconds',
  help: 'LLM API latency',
  labelNames: ['provider', 'model'],
  buckets: [0.5, 1, 2, 5, 10, 20, 30],
  registers: [registry],
});

export const llmFallbacks = new Counter({
  name: 'llm_fallbacks_total',
  help: 'LLM fallback activations',
  labelNames: ['from_provider', 'to_provider', 'reason'],
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE METRICS
// ═══════════════════════════════════════════════════════════════════════════

export const queueJobsTotal = new Counter({
  name: 'queue_jobs_total',
  help: 'Total queue jobs',
  labelNames: ['queue', 'status'], // status: completed, failed, delayed
  registers: [registry],
});

export const queueJobDuration = new Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Queue job processing duration',
  labelNames: ['queue'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Current queue depth (waiting jobs)',
  labelNames: ['queue'],
  registers: [registry],
});

export const dlqSize = new Gauge({
  name: 'dlq_size',
  help: 'Dead letter queue size',
  labelNames: ['original_queue'],
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// RETAIL METRICS
// ═══════════════════════════════════════════════════════════════════════════

export const ordersCreated = new Counter({
  name: 'orders_created_total',
  help: 'Total orders created',
  labelNames: ['workspace_id', 'channel'],
  registers: [registry],
});

export const ordersCompleted = new Counter({
  name: 'orders_completed_total',
  help: 'Total orders completed (paid)',
  labelNames: ['workspace_id'],
  registers: [registry],
});

export const orderValue = new Histogram({
  name: 'order_value_cents',
  help: 'Order value distribution in cents',
  labelNames: ['workspace_id'],
  buckets: [5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000],
  registers: [registry],
});

export const paymentsProcessed = new Counter({
  name: 'payments_processed_total',
  help: 'Total payments processed',
  labelNames: ['workspace_id', 'method', 'status'],
  registers: [registry],
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION METRICS
// ═══════════════════════════════════════════════════════════════════════════

export const integrationHealth = new Gauge({
  name: 'integration_health',
  help: 'Integration health status (1=healthy, 0=unhealthy)',
  labelNames: ['workspace_id', 'provider'],
  registers: [registry],
});

export const integrationLatency = new Histogram({
  name: 'integration_latency_seconds',
  help: 'Integration API latency',
  labelNames: ['provider', 'operation'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const integrationErrors = new Counter({
  name: 'integration_errors_total',
  help: 'Integration errors',
  labelNames: ['provider', 'error_type'],
  registers: [registry],
});
```

### 5.2 Alertas

```yaml
# docker/alertmanager/rules.yml

groups:
  - name: nexova-critical
    interval: 30s
    rules:
      # ═══════════════════════════════════════════════════════════════════════
      # API ALERTS
      # ═══════════════════════════════════════════════════════════════════════

      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          / sum(rate(http_requests_total[5m])) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High HTTP error rate (> 5%)"
          description: "Error rate is {{ $value | humanizePercentage }}"

      - alert: HighLatency
        expr: |
          histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High API latency (p95 > 2s)"
          description: "P95 latency is {{ $value | humanizeDuration }}"

      # ═══════════════════════════════════════════════════════════════════════
      # AGENT ALERTS
      # ═══════════════════════════════════════════════════════════════════════

      - alert: AgentProcessingBacklog
        expr: queue_depth{queue="agent-process"} > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Agent processing backlog"
          description: "{{ $value }} messages waiting in queue"

      - alert: AgentHighFailureRate
        expr: |
          sum(rate(agent_failures_total[5m]))
          / sum(rate(agent_messages_processed_total[5m])) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High agent failure rate (> 10%)"
          description: "Failure rate is {{ $value | humanizePercentage }}"

      - alert: AgentSlowProcessing
        expr: |
          histogram_quantile(0.95, rate(agent_processing_duration_seconds_bucket[5m])) > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow agent processing (p95 > 30s)"
          description: "P95 processing time is {{ $value | humanizeDuration }}"

      - alert: HighHandoffRate
        expr: |
          sum(rate(agent_handoffs_total[1h]))
          / sum(rate(agent_messages_processed_total[1h])) > 0.2
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "High handoff rate (> 20%)"
          description: "Consider improving agent training or tools"

      # ═══════════════════════════════════════════════════════════════════════
      # LLM ALERTS
      # ═══════════════════════════════════════════════════════════════════════

      - alert: LLMHighLatency
        expr: |
          histogram_quantile(0.95, rate(llm_latency_seconds_bucket[5m])) > 15
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High LLM latency (p95 > 15s)"
          description: "Consider switching to fallback provider"

      - alert: LLMHighErrorRate
        expr: |
          sum(rate(llm_requests_total{status="error"}[5m]))
          / sum(rate(llm_requests_total[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High LLM error rate (> 5%)"
          description: "Error rate is {{ $value | humanizePercentage }}"

      - alert: LLMFallbackActive
        expr: sum(rate(llm_fallbacks_total[5m])) > 0
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "LLM fallback is active"
          description: "Primary LLM provider may be degraded"

      # ═══════════════════════════════════════════════════════════════════════
      # QUEUE ALERTS
      # ═══════════════════════════════════════════════════════════════════════

      - alert: DLQNotEmpty
        expr: dlq_size > 0
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Dead letter queue has items"
          description: "{{ $value }} jobs in DLQ for queue {{ $labels.original_queue }}"

      - alert: QueueBacklog
        expr: queue_depth > 500
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Queue backlog critical"
          description: "Queue {{ $labels.queue }} has {{ $value }} pending jobs"

      - alert: QueueJobsStale
        expr: |
          time() - queue_oldest_job_timestamp > 300
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Stale jobs in queue"
          description: "Jobs older than 5 minutes in queue {{ $labels.queue }}"

      # ═══════════════════════════════════════════════════════════════════════
      # INTEGRATION ALERTS
      # ═══════════════════════════════════════════════════════════════════════

      - alert: IntegrationUnhealthy
        expr: integration_health == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Integration unhealthy"
          description: "{{ $labels.provider }} integration is down for workspace {{ $labels.workspace_id }}"

      - alert: WebhookProcessingFailed
        expr: |
          sum(rate(webhooks_processed_total{status="failed"}[5m])) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Webhook processing failures"
          description: "{{ $value }} webhooks/sec failing"

      # ═══════════════════════════════════════════════════════════════════════
      # INFRASTRUCTURE ALERTS
      # ═══════════════════════════════════════════════════════════════════════

      - alert: RedisDown
        expr: redis_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis is down"
          description: "Redis connection lost"

      - alert: PostgresDown
        expr: pg_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL is down"
          description: "Database connection lost"

      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes / 1024 / 1024 > 1024
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage (> 1GB)"
          description: "Memory usage is {{ $value }}MB"
```

### 5.3 Tracing (OpenTelemetry)

```typescript
// packages/core/src/observability/tracing.ts

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export function initTracing(serviceName: string): void {
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
}

// Custom span for agent processing
export function traceAgentProcessing(sessionId: string, messageId: string) {
  return tracer.startActiveSpan('agent.process', {
    attributes: {
      'agent.session_id': sessionId,
      'agent.message_id': messageId,
    },
  });
}
```

### 5.4 Dashboard Metrics Summary

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           OBSERVABILITY DASHBOARD                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ HEALTH OVERVIEW                                                              ││
│  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐      ││
│  │ │ API       │ │ Agent     │ │ LLM       │ │ Infobip   │ │ MercadoPago│      ││
│  │ │ ✓ 99.9%   │ │ ✓ 98.5%   │ │ ✓ 99.2%   │ │ ✓ 100%    │ │ ✓ 99.8%    │      ││
│  │ └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘      ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ KEY METRICS (Last 24h)                                                       ││
│  │                                                                              ││
│  │ Messages Processed:  12,458    │  Orders Created:     234                    ││
│  │ Avg Processing Time: 3.2s      │  Orders Completed:   198                    ││
│  │ Tool Executions:     45,230    │  Total GMV:          $2.5M                  ││
│  │ Handoff Rate:        4.2%      │  Avg Order Value:    $12,500                ││
│  │ Failure Rate:        1.8%      │  Payment Success:    94.8%                  ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ QUEUE STATUS                                                                 ││
│  │                                                                              ││
│  │ agent-process   │ ████████░░░░░░░ │  Waiting: 23   │ Processing: 8          ││
│  │ message-send    │ ██░░░░░░░░░░░░░ │  Waiting: 5    │ Processing: 2          ││
│  │ outbox-relay    │ ░░░░░░░░░░░░░░░ │  Waiting: 0    │ Processing: 1          ││
│  │ DLQ             │ ░░░░░░░░░░░░░░░ │  Items: 0                               ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │ LLM USAGE                                                                    ││
│  │                                                                              ││
│  │ Provider:        Claude Sonnet   │  Requests:    8,234                       ││
│  │ Tokens (Input):  2.1M            │  Avg Latency: 2.8s                        ││
│  │ Tokens (Output): 890K            │  Error Rate:  0.3%                        ││
│  │ Fallback Active: No              │  Cost Est:    $42.50                      ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## ASSUMPTIONS

1. **ASSUMPTION:** Los webhooks de Infobip usan HMAC-SHA256 para firma. El secret se configura en el dashboard de Infobip y se almacena en `connections.config.webhookSecret`.

2. **ASSUMPTION:** MercadoPago usa IPN (Instant Payment Notification) con signature en header. Se hace un GET al API de MercadoPago para obtener los detalles completos del pago.

3. **ASSUMPTION:** El rate limiting se implementa a nivel de API Gateway/Fastify con límites por IP y por workspace (autenticados).

4. **ASSUMPTION:** Los delivery reports de Infobip se usan para actualizar el status del mensaje en la tabla `agent_messages` pero no disparan procesamiento de agente.

5. **ASSUMPTION:** El WebSocket usa Redis Pub/Sub para sincronizar eventos entre múltiples instancias de API.

6. **ASSUMPTION:** Las alertas críticas envían a PagerDuty/OpsGenie; las warnings van a Slack.
