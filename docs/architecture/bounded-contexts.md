# ENTREGABLE 2: Bounded Contexts y Módulos

## Visión General de Módulos

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              BOUNDED CONTEXTS                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                              CORE                                        │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │    │
│  │  │ Tenancy  │ │   Auth   │ │RBAC/ABAC │ │ Ledger   │ │ Catalog  │      │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐             │    │
│  │  │ Orders   │ │  Crypto  │ │  Queue   │ │ Observability │             │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └───────────────┘             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                     ▲                                            │
│                                     │ depends on                                 │
│  ┌──────────────────────────────────┼──────────────────────────────────────┐    │
│  │                                  │                                       │    │
│  │  ┌─────────────────┐    ┌───────┴───────┐    ┌─────────────────┐       │    │
│  │  │ RETAIL (stub)   │◄───│ AGENT RUNTIME │───►│  INTEGRATIONS   │       │    │
│  │  └─────────────────┘    └───────────────┘    └─────────────────┘       │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```


---

## 1. CORE MODULE (`packages/core`)

El módulo Core provee servicios fundamentales compartidos por todos los demás módulos. Es el único módulo del cual todos pueden depender.

### 1.1 Tenancy

| Aspecto | Detalle |
|------|---------|
| **Responsabilidad** | Gestión de workspaces (tenants), aislamiento de datos, configuración por tenant |
| **Entidades** | `Workspace`, `WorkspaceSettings`, `WorkspaceLimits` |

| Inputs | Outputs |
|--------|---------|
| `createWorkspace(data)` | `Workspace` |
| `getWorkspace(id)` | `Workspace \| null` |
| `updateWorkspaceSettings(id, settings)` | `WorkspaceSettings` |
| `getWorkspaceLimits(id)` | `WorkspaceLimits` |

| Eventos Emitidos | Payload |
|------------------|---------|
| `workspace.created` | `{ workspaceId, name, plan, createdAt }` |
| `workspace.settings_updated` | `{ workspaceId, changedKeys[], updatedAt }` |
| `workspace.suspended` | `{ workspaceId, reason, suspendedAt }` |

| Dependencias Permitidas |
|-------------------------|
| `shared/types`, `shared/utils` |
| **Ninguna dependencia de otros módulos de dominio** |

---

### 1.2 Auth

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Autenticación de usuarios, emisión/validación de JWT, gestión de sesiones de usuario (no confundir con chat sessions) |
| **Entidades** | `User`, `UserSession`, `RefreshToken` |

| Inputs | Outputs |
|--------|---------|
| `login(email, password)` | `{ accessToken, refreshToken, user }` |
| `refreshToken(refreshToken)` | `{ accessToken, refreshToken }` |
| `logout(userId, sessionId)` | `void` |
| `validateToken(token)` | `TokenPayload \| throws` |
| `changePassword(userId, oldPw, newPw)` | `void` |
| `requestPasswordReset(email)` | `void` |

| Eventos Emitidos | Payload |
|------------------|---------|
| `user.logged_in` | `{ userId, workspaceId, ip, userAgent, timestamp }` |
| `user.logged_out` | `{ userId, workspaceId, timestamp }` |
| `user.password_changed` | `{ userId, timestamp }` |
| `user.password_reset_requested` | `{ userId, email, timestamp }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy` (para validar workspace del user) |
| `shared/crypto`, `shared/types` |

---

### 1.3 RBAC/ABAC

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Control de acceso basado en roles (RBAC) y atributos (ABAC). Evaluación de políticas por acción. |
| **Entidades** | `Role`, `Permission`, `Policy`, `UserRole` |

| Inputs | Outputs |
|--------|---------|
| `checkPermission(userId, action, resource)` | `boolean` |
| `evaluatePolicy(context: PolicyContext)` | `{ allowed: boolean, reason?: string }` |
| `getUserPermissions(userId)` | `Permission[]` |
| `assignRole(userId, roleId, workspaceId)` | `UserRole` |
| `createRole(workspaceId, data)` | `Role` |
| `createPolicy(workspaceId, policy)` | `Policy` |

| Eventos Emitidos | Payload |
|------------------|---------|
| `role.assigned` | `{ userId, roleId, workspaceId, assignedBy, timestamp }` |
| `role.revoked` | `{ userId, roleId, workspaceId, revokedBy, timestamp }` |
| `permission.denied` | `{ userId, action, resource, reason, timestamp }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy`, `core/auth` |
| `shared/types` |

**Modelo de Permisos (Retail):**

```typescript
// Acciones del dominio Retail
type RetailAction =
  | 'orders:read' | 'orders:create' | 'orders:update' | 'orders:cancel'
  | 'products:read' | 'products:create' | 'products:update' | 'products:delete'
  | 'stock:read' | 'stock:adjust'
  | 'payments:read' | 'payments:refund'
  | 'customers:read' | 'customers:update'
  | 'sessions:read' | 'sessions:takeover' | 'sessions:release';

// Roles predefinidos
const RETAIL_ROLES = {
  OWNER: ['*'],  // all permissions
  ADMIN: ['orders:*', 'products:*', 'stock:*', 'customers:*', 'sessions:*'],
  OPERATOR: ['orders:read', 'orders:update', 'sessions:read', 'sessions:takeover', 'sessions:release'],
  VIEWER: ['orders:read', 'products:read', 'stock:read', 'customers:read'],
};
```

---

### 1.4 Audit Log

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Registro inmutable de todas las acciones del sistema para compliance y debugging |
| **Entidades** | `AuditLog` |

| Inputs | Outputs |
|--------|---------|
| `log(entry: AuditEntry)` | `void` (fire-and-forget, async) |
| `query(filters: AuditFilters)` | `PaginatedResult<AuditLog>` |
| `getByCorrelationId(correlationId)` | `AuditLog[]` |

| Estructura AuditEntry |
|----------------------|
```typescript
interface AuditEntry {
  workspaceId: string;
  correlationId: string;      // Para agrupar acciones relacionadas
  actor: {
    type: 'user' | 'agent' | 'system' | 'webhook';
    id: string;
    ip?: string;
  };
  action: string;             // 'order.created', 'tool.executed', etc.
  resource: {
    type: string;             // 'Order', 'Product', 'Session'
    id: string;
  };
  input?: object;             // Payload de entrada (sanitizado, sin PII sensible)
  output?: object;            // Resultado (resumido)
  metadata?: object;          // Datos adicionales
  status: 'success' | 'failure';
  errorCode?: string;
  timestamp: Date;
}
```

| Eventos Emitidos | Payload |
|------------------|---------|
| **No emite eventos** | El audit log es consumidor, no productor |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy` (para scope) |
| `shared/types` |
| **Ninguna otra - debe ser independiente** |

---

### 1.5 Event Outbox + Realtime

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Persistir eventos de dominio en `event_outbox` y publicarlos vía Redis pub/sub (`outbox-relay` job). |
| **Entidades** | `EventOutbox` (DB), canal Redis `nexova:realtime` |

| Inputs | Outputs |
|--------|---------|
| `event_outbox.create(...)` | Evento publicado a Redis |

| Estructura EventOutbox |
|-----------------------|
```typescript
interface EventOutbox {
  id: string;                 // UUID
  eventType: string;          // 'order.created'
  workspaceId: string;
  aggregateId: string;
  aggregateType: string;
  payload: object;
  correlationId?: string;
  status: 'pending' | 'published' | 'failed';
  createdAt: Date;
}
```

| Dependencias Permitidas |
|-------------------------|
| `shared/types` |
| Prisma (DB) + Redis (infra) |

---
-----|---------|
| `publish(event: DomainEvent)` | `void` (dentro de TX, escribe a outbox) |
| `subscribe(eventType, handler)` | `Subscription` |
| `unsubscribe(subscriptionId)` | `void` |

| Estructura DomainEvent |
|-----------------------|
```typescript
interface DomainEvent {
  id: string;                 // UUID
  type: string;               // 'order.created'
  workspaceId: string;
  aggregateId: string;        // ID de la entidad
  aggregateType: string;      // 'Order'
  payload: object;
  metadata: {
    correlationId: string;
    causationId?: string;     // ID del evento que causó este
    timestamp: Date;
    version: number;
  };
}
```

| Eventos Emitidos | Payload |
|------------------|---------|
| **No emite eventos propios** | Es el canal, no el productor |

| Dependencias Permitidas |
|-------------------------|
| `shared/types` |
| **Ninguna otra - infraestructura pura** |

---

### 1.6 Connections (planned)

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Gestión de conexiones a servicios externos (credentials, tokens, health). Registry de integraciones habilitadas por workspace. |
| **Entidades** | `Connection`, `ConnectionCredentials` (encrypted) |

| Inputs | Outputs |
|--------|---------|
| `createConnection(workspaceId, type, credentials)` | `Connection` |
| `getConnection(workspaceId, type)` | `Connection \| null` |
| `testConnection(connectionId)` | `{ healthy: boolean, latencyMs: number }` |
| `rotateCredentials(connectionId, newCreds)` | `Connection` |
| `listConnections(workspaceId)` | `Connection[]` |

| Eventos Emitidos | Payload |
|------------------|---------|
| `connection.created` | `{ workspaceId, connectionId, type, createdAt }` |
| `connection.health_changed` | `{ connectionId, healthy, previousStatus, timestamp }` |
| `connection.credentials_rotated` | `{ connectionId, rotatedAt }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy`, `core/audit` |
| `shared/crypto` (para encrypt/decrypt credentials) |

---

### 1.7 Billing (planned)

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Hooks para tracking de uso (mensajes, API calls, storage). No procesa pagos directamente - emite eventos para sistema de billing externo. |
| **Entidades** | `UsageRecord`, `BillingEvent` |

| Inputs | Outputs |
|--------|---------|
| `trackUsage(workspaceId, metric, quantity)` | `void` |
| `getUsageSummary(workspaceId, period)` | `UsageSummary` |
| `checkQuota(workspaceId, metric)` | `{ allowed: boolean, remaining: number }` |

| Métricas Trackeadas |
|--------------------|
| `messages.inbound` - Mensajes WA recibidos |
| `messages.outbound` - Mensajes WA enviados |
| `agent.invocations` - Llamadas al agente |
| `llm.tokens` - Tokens consumidos |
| `storage.bytes` - Almacenamiento usado |

| Eventos Emitidos | Payload |
|------------------|---------|
| `billing.usage_recorded` | `{ workspaceId, metric, quantity, timestamp }` |
| `billing.quota_exceeded` | `{ workspaceId, metric, limit, current, timestamp }` |
| `billing.threshold_reached` | `{ workspaceId, metric, threshold, percentage }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy` |
| `shared/types` |

---

## 2. RETAIL DOMAIN (`packages/retail`)

Dominio de negocio para el rol Comercial. Completamente aislado, solo expone interfaces públicas.

### 2.1 Products

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Catálogo de productos, variantes, precios, categorías |
| **Entidades** | `Product`, `ProductVariant`, `Category`, `Price` |

| Inputs | Outputs |
|--------|---------|
| `createProduct(workspaceId, data)` | `Product` |
| `updateProduct(productId, data)` | `Product` |
| `deleteProduct(productId)` | `void` (soft delete) |
| `getProduct(productId)` | `Product \| null` |
| `listProducts(workspaceId, filters)` | `PaginatedResult<Product>` |
| `searchProducts(workspaceId, query)` | `Product[]` |

| Eventos Emitidos | Payload |
|------------------|---------|
| `product.created` | `{ workspaceId, productId, name, sku, price, createdAt }` |
| `product.updated` | `{ workspaceId, productId, changedFields[], updatedAt }` |
| `product.deleted` | `{ workspaceId, productId, deletedAt }` |
| `product.price_changed` | `{ workspaceId, productId, oldPrice, newPrice, timestamp }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy`, `core/rbac`, `core/audit`, `core/eventbus` |
| `retail/stock` (para verificar disponibilidad) |

---

### 2.2 Stock

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Inventario, reservas, movimientos de stock, alertas de bajo stock |
| **Entidades** | `StockItem`, `StockMovement`, `StockReservation` |

| Inputs | Outputs |
|--------|---------|
| `getStock(productId, workspaceId)` | `StockItem` |
| `adjustStock(productId, quantity, reason)` | `StockMovement` |
| `reserveStock(productId, quantity, orderId)` | `StockReservation` |
| `commitReservation(reservationId)` | `void` |
| `releaseReservation(reservationId)` | `void` |
| `checkAvailability(productId, quantity)` | `{ available: boolean, currentStock: number }` |

| Eventos Emitidos | Payload |
|------------------|---------|
| `stock.adjusted` | `{ workspaceId, productId, previousQty, newQty, reason, timestamp }` |
| `stock.reserved` | `{ workspaceId, productId, quantity, orderId, reservationId }` |
| `stock.committed` | `{ workspaceId, reservationId, productId, quantity }` |
| `stock.released` | `{ workspaceId, reservationId, productId, quantity }` |
| `stock.low` | `{ workspaceId, productId, currentStock, threshold }` |
| `stock.depleted` | `{ workspaceId, productId }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy`, `core/rbac`, `core/audit`, `core/eventbus` |
| `retail/products` (para validar producto existe) |

---

### 2.3 Customers

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Gestión de clientes (contactos de WhatsApp), historial, preferencias |
| **Entidades** | `Customer`, `CustomerAddress`, `CustomerPreferences` |

| Inputs | Outputs |
|--------|---------|
| `findOrCreateByPhone(workspaceId, phone)` | `Customer` |
| `updateCustomer(customerId, data)` | `Customer` |
| `getCustomer(customerId)` | `Customer \| null` |
| `getCustomerByPhone(workspaceId, phone)` | `Customer \| null` |
| `listCustomers(workspaceId, filters)` | `PaginatedResult<Customer>` |
| `addAddress(customerId, address)` | `CustomerAddress` |

| Eventos Emitidos | Payload |
|------------------|---------|
| `customer.created` | `{ workspaceId, customerId, phone, createdAt }` |
| `customer.updated` | `{ workspaceId, customerId, changedFields[], updatedAt }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy`, `core/rbac`, `core/audit`, `core/eventbus` |
| **Ninguna dependencia de otros módulos retail** |

---

### 2.4 Orders

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Gestión de pedidos, ciclo de vida, totales, estado |
| **Entidades** | `Order`, `OrderItem`, `OrderStatusHistory` |

| Inputs | Outputs |
|--------|---------|
| `createOrder(workspaceId, customerId, items)` | `Order` |
| `addItem(orderId, productId, quantity)` | `OrderItem` |
| `removeItem(orderId, itemId)` | `void` |
| `updateItemQuantity(orderId, itemId, qty)` | `OrderItem` |
| `confirmOrder(orderId)` | `Order` |
| `cancelOrder(orderId, reason)` | `Order` |
| `getOrder(orderId)` | `Order \| null` |
| `listOrders(workspaceId, filters)` | `PaginatedResult<Order>` |

| Order Status Flow |
|-------------------|
```
DRAFT → PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → DELIVERED
                ↓                                          ↓
            CANCELLED ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←← RETURNED
```

| Eventos Emitidos | Payload |
|------------------|---------|
| `order.created` | `{ workspaceId, orderId, customerId, items[], total, createdAt }` |
| `order.item_added` | `{ workspaceId, orderId, productId, quantity, lineTotal }` |
| `order.item_removed` | `{ workspaceId, orderId, productId, itemId }` |
| `order.confirmed` | `{ workspaceId, orderId, total, confirmedAt }` |
| `order.cancelled` | `{ workspaceId, orderId, reason, cancelledAt }` |
| `order.status_changed` | `{ workspaceId, orderId, previousStatus, newStatus, timestamp }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy`, `core/rbac`, `core/audit`, `core/eventbus` |
| `retail/products` (para validar productos y precios) |
| `retail/stock` (para reservar stock) |
| `retail/customers` (para asociar cliente) |

---

### 2.5 Payments

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Procesamiento de pagos, integración con gateways, refunds |
| **Entidades** | `Payment`, `PaymentAttempt`, `Refund` |

| Inputs | Outputs |
|--------|---------|
| `initiatePayment(orderId, method)` | `Payment` |
| `processWebhook(provider, payload)` | `Payment` |
| `getPayment(paymentId)` | `Payment \| null` |
| `getPaymentByOrder(orderId)` | `Payment \| null` |
| `refund(paymentId, amount, reason)` | `Refund` |

| Payment Status Flow |
|--------------------|
```
PENDING → PROCESSING → COMPLETED
              ↓
           FAILED → (retry) → PROCESSING
              ↓
          CANCELLED
```

| Eventos Emitidos | Payload |
|------------------|---------|
| `payment.initiated` | `{ workspaceId, paymentId, orderId, amount, method, initiatedAt }` |
| `payment.processing` | `{ workspaceId, paymentId, provider, externalId }` |
| `payment.completed` | `{ workspaceId, paymentId, orderId, amount, completedAt }` |
| `payment.failed` | `{ workspaceId, paymentId, orderId, reason, failedAt }` |
| `payment.refunded` | `{ workspaceId, paymentId, refundId, amount, reason }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy`, `core/rbac`, `core/audit`, `core/eventbus`, `core/connections` |
| `retail/orders` (para actualizar estado del pedido) |

---

## 3. INTEGRATIONS (`packages/integrations`)

Adaptadores para servicios externos. Implementan interfaces definidas en shared.

### 3.1 Infobip WhatsApp Adapter

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Envío/recepción de mensajes WhatsApp via Infobip API |
| **Interfaces Implementadas** | `IMessageProvider` |

| Inputs | Outputs |
|--------|---------|
| `sendMessage(to, content, options)` | `MessageResult` |
| `sendTemplate(to, templateId, params)` | `MessageResult` |
| `parseWebhook(rawPayload, signature)` | `InboundMessage` |
| `verifySignature(payload, signature)` | `boolean` |
| `getMessageStatus(messageId)` | `MessageStatus` |

| Estructura InboundMessage |
|--------------------------|
```typescript
interface InboundMessage {
  messageId: string;          // ID único de Infobip
  from: string;               // Phone number E.164
  to: string;                 // Business phone number
  timestamp: Date;
  type: 'text' | 'image' | 'document' | 'location' | 'button_reply';
  content: {
    text?: string;
    mediaUrl?: string;
    latitude?: number;
    longitude?: number;
    buttonId?: string;
    buttonText?: string;
  };
  context?: {
    referredMessageId?: string;  // Si es respuesta a otro mensaje
  };
  raw: object;                // Payload original para debugging
}
```

| Eventos Emitidos | Payload |
|------------------|---------|
| `integration.message_sent` | `{ workspaceId, provider: 'infobip', messageId, to, timestamp }` |
| `integration.message_failed` | `{ workspaceId, provider: 'infobip', error, to, timestamp }` |
| `integration.webhook_received` | `{ workspaceId, provider: 'infobip', messageId, from }` |

| Dependencias Permitidas |
|-------------------------|
| `core/connections` (para obtener credentials) |
| `core/audit` (para logging) |
| `shared/types`, `shared/http` |
| **Ninguna dependencia de dominios de negocio** |

---

### 3.2 Payment Gateway Adapter (Interface)

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Abstracción para payment gateways. Implementación inicial: MercadoPago |
| **Interfaces Implementadas** | `IPaymentGateway` |

| Inputs | Outputs |
|--------|---------|
| `createPaymentIntent(amount, currency, metadata)` | `PaymentIntent` |
| `capturePayment(intentId)` | `PaymentResult` |
| `refundPayment(paymentId, amount)` | `RefundResult` |
| `parseWebhook(rawPayload, signature)` | `PaymentWebhookEvent` |
| `getPaymentStatus(externalId)` | `PaymentStatus` |

| Eventos Emitidos | Payload |
|------------------|---------|
| `integration.payment_intent_created` | `{ workspaceId, provider, intentId, amount }` |
| `integration.payment_webhook_received` | `{ workspaceId, provider, eventType, externalId }` |

| Dependencias Permitidas |
|-------------------------|
| `core/connections`, `core/audit` |
| `shared/types`, `shared/http` |

---

### 3.3 LLM Provider Adapter

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Abstracción provider-agnostic para LLMs. Primary: Claude, Fallback: configurable |
| **Interfaces Implementadas** | `ILLMProvider` |

| Inputs | Outputs |
|--------|---------|
| `complete(messages, options)` | `LLMResponse` |
| `completeWithTools(messages, tools, options)` | `LLMToolResponse` |
| `streamComplete(messages, options)` | `AsyncIterable<LLMChunk>` |

| Estructura LLMToolResponse |
|---------------------------|
```typescript
interface LLMToolResponse {
  id: string;
  model: string;
  content: string | null;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}
```

| Eventos Emitidos | Payload |
|------------------|---------|
| `integration.llm_request` | `{ workspaceId, provider, model, inputTokens, timestamp }` |
| `integration.llm_response` | `{ workspaceId, provider, model, outputTokens, latencyMs }` |
| `integration.llm_error` | `{ workspaceId, provider, error, timestamp }` |
| `integration.llm_fallback` | `{ workspaceId, fromProvider, toProvider, reason }` |

| Dependencias Permitidas |
|-------------------------|
| `core/connections`, `core/audit`, `core/billing` (para track tokens) |
| `shared/types`, `shared/http` |

---

## 4. AGENT RUNTIME (`packages/agent-runtime`)

Motor de ejecución del agente conversacional. Orquesta LLM, tools y estado.

### 4.1 Sessions

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Gestión del ciclo de vida de sesiones de conversación |
| **Entidades** | `Session`, `SessionMessage` |

| Inputs | Outputs |
|--------|---------|
| `findOrCreate(workspaceId, phoneNumber)` | `Session` |
| `getSession(sessionId)` | `Session \| null` |
| `addMessage(sessionId, message)` | `SessionMessage` |
| `getMessages(sessionId, limit)` | `SessionMessage[]` |
| `closeSession(sessionId, reason)` | `void` |
| `isAgentActive(sessionId)` | `boolean` |

| Eventos Emitidos | Payload |
|------------------|---------|
| `session.created` | `{ workspaceId, sessionId, customerId, phoneNumber, createdAt }` |
| `session.message_added` | `{ sessionId, messageId, role, timestamp }` |
| `session.closed` | `{ sessionId, reason, duration, messageCount, closedAt }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy` |
| `shared/types` |

---

### 4.2 State Machine + Session Memory

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Gestión del estado del agente y memoria de sesión (cart, contexto). |
| **Estado almacenado en** | Redis: `agent:session:{id}` |

| Inputs | Outputs |
|--------|---------|
| `getSession(sessionId)` | `SessionMemory` |
| `updateState(sessionId, state)` | `void` |
| `getCart(sessionId)` | `Cart` |
| `addToCart(sessionId, item)` | `Cart` |
| `clearCart(sessionId)` | `void` |

| Estructura SessionMemory (Redis) |
|------------------------------|
```typescript
interface SessionMemory {
  sessionId: string;
  workspaceId: string;
  customerId: string;
  state: AgentState;
  cart: Cart | null;
  pendingConfirmation: PendingConfirmation | null;
  context: ConversationContext;
  lastActivityAt: Date;
}
```

---

### 4.3 Tool Registry

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Registro de tools disponibles, schemas JSON/Zod, validación, ejecución |
| **Entidades** | `Tool`, `ToolSchema`, `ToolExecution` |

| Inputs | Outputs |
|--------|---------|
| `register(tool: ToolDefinition)` | `void` |
| `getTool(name)` | `Tool \| null` |
| `listTools(context?: ToolContext)` | `Tool[]` |
| `getToolSchemas()` | `ToolSchema[]` (for LLM) |
| `validateParams(toolName, params)` | `{ valid: boolean, errors?: ZodError }` |
| `execute(toolName, params, context)` | `ToolResult` |

| Estructura ToolDefinition |
|--------------------------|
```typescript
interface ToolDefinition {
  name: string;                         // 'search_products', 'add_to_cart'
  description: string;                  // Para el LLM
  category: 'query' | 'mutation';       // Query = safe, Mutation = puede requerir confirm
  requiresConfirmation: boolean;        // Si true, necesita confirm humano
  schema: {
    input: ZodSchema;                   // Validación de parámetros
    output: ZodSchema;                  // Validación de resultado
  };
  handler: (params, context) => Promise<ToolResult>;
}
```

| Tools del Rol Comercial |
|------------------------|
```typescript
const RETAIL_TOOLS = [
  // Queries (safe)
  { name: 'search_products', requiresConfirmation: false },
  { name: 'get_product_details', requiresConfirmation: false },
  { name: 'check_stock', requiresConfirmation: false },
  { name: 'get_cart', requiresConfirmation: false },
  { name: 'get_order_status', requiresConfirmation: false },

  // Mutations (may require confirmation)
  { name: 'add_to_cart', requiresConfirmation: false },
  { name: 'remove_from_cart', requiresConfirmation: false },
  { name: 'update_cart_quantity', requiresConfirmation: false },
  { name: 'create_order', requiresConfirmation: true },      // REQUIRES CONFIRM
  { name: 'confirm_order', requiresConfirmation: true },     // REQUIRES CONFIRM
  { name: 'cancel_order', requiresConfirmation: true },      // REQUIRES CONFIRM
  { name: 'initiate_payment', requiresConfirmation: true },  // REQUIRES CONFIRM
];
```

| Eventos Emitidos | Payload |
|------------------|---------|
| `tool.registered` | `{ toolName, category, requiresConfirmation }` |
| `tool.executed` | `{ sessionId, toolName, params (sanitized), result, durationMs }` |
| `tool.execution_failed` | `{ sessionId, toolName, error, params }` |
| `tool.confirmation_required` | `{ sessionId, toolName, params, pendingActionId }` |

| Dependencias Permitidas |
|-------------------------|
| `core/audit`, `core/eventbus` |
| `shared/types`, `shared/validation` |
| **Los handlers de tools inyectan servicios de dominio via DI** |

---

### 4.4 Handoff Manager

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Gestión de transferencia a operador humano, cola de espera, reasignación |
| **Entidades** | `HandoffRequest`, `OperatorAssignment` |

| Inputs | Outputs |
|--------|---------|
| `requestHandoff(sessionId, reason)` | `HandoffRequest` |
| `claimSession(sessionId, operatorId)` | `OperatorAssignment` |
| `releaseSession(sessionId, operatorId)` | `void` |
| `getPendingHandoffs(workspaceId)` | `HandoffRequest[]` |
| `getOperatorSessions(operatorId)` | `Session[]` |

| Handoff Triggers |
|-----------------|
```typescript
type HandoffTrigger =
  | 'failure_threshold'      // failureCount >= 2
  | 'negative_sentiment'     // Heurística (keywords)
  | 'user_request'          // User explicitly asks for human
  | 'sensitive_topic'       // Configured keywords/topics
  | 'operator_initiated';   // Operator takes over from dashboard
```

| Eventos Emitidos | Payload |
|------------------|---------|
| `session.handoff_requested` | `{ workspaceId, sessionId, reason, trigger, timestamp }` |
| `session.handoff_claimed` | `{ workspaceId, sessionId, operatorId, claimedAt }` |
| `session.handoff_released` | `{ workspaceId, sessionId, operatorId, releasedAt, resolution }` |
| `session.handoff_timeout` | `{ workspaceId, sessionId, waitTimeMs }` |

| Dependencias Permitidas |
|-------------------------|
| `core/tenancy`, `core/rbac`, `core/eventbus`, `core/audit` |
| `agent-runtime/sessions`, `agent-runtime/state-machine` |

---

### 4.5 Memory Manager

| Aspecto | Detalle |
|---------|---------|
| **Responsabilidad** | Gestión del contexto conversacional, TTL, summarization para ventana de contexto |
| **Almacenamiento** | Redis (hot) + PostgreSQL (cold) |

| Inputs | Outputs |
|--------|---------|
| `getContext(sessionId, maxTokens)` | `ConversationContext` |
| `addToMemory(sessionId, entry)` | `void` |
| `summarize(sessionId)` | `string` (summary) |
| `pruneOldMemory(sessionId)` | `number` (entries removed) |
| `getRecentMessages(sessionId, n)` | `Message[]` |

| Configuración TTL |
|------------------|
```typescript
const MEMORY_CONFIG = {
  // Hot memory (Redis)
  recentMessagesLimit: 20,           // Últimos N mensajes completos
  recentMessagesTTL: '24h',          // TTL de mensajes recientes

  // Context window
  maxContextTokens: 8000,            // Tokens máx para enviar a LLM
  summaryTriggerThreshold: 15,       // Summarize después de N mensajes

  // Cold storage (PostgreSQL)
  archiveAfter: '7d',                // Mover a cold después de 7 días
  retentionPeriod: '90d',            // Eliminar después de 90 días
};
```

| Eventos Emitidos | Payload |
|------------------|---------|
| `memory.summarized` | `{ sessionId, originalMessages, summaryTokens }` |
| `memory.pruned` | `{ sessionId, entriesRemoved, reason }` |
| `memory.archived` | `{ sessionId, messagesArchived }` |

| Dependencias Permitidas |
|-------------------------|
| `core/eventbus` |
| `integrations/llm` (para summarization) |
| `shared/types` |

---

## Matriz de Dependencias

```
                    ┌─────────┬─────────┬─────────┬─────────┬─────────┐
                    │  CORE   │ RETAIL  │ INTEGR  │ AGENT   │ SHARED  │
┌───────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ CORE              │    -    │    ✗    │    ✗    │    ✗    │    ✓    │
├───────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ RETAIL            │    ✓    │    -    │    ✗    │    ✗    │    ✓    │
├───────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ INTEGRATIONS      │    ✓    │    ✗    │    -    │    ✗    │    ✓    │
├───────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ AGENT RUNTIME     │    ✓    │    ✓*   │    ✓    │    -    │    ✓    │
├───────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ SHARED            │    ✗    │    ✗    │    ✗    │    ✗    │    -    │
└───────────────────┴─────────┴─────────┴─────────┴─────────┴─────────┘

✓  = Puede depender
✗  = NO puede depender
✓* = Solo via interfaces (DI), no import directo
```

---

## ASSUMPTIONS

1. **ASSUMPTION:** El handoff por sentimiento se hace con heurística de keywords (no hay tool específica).

2. **ASSUMPTION:** La summarization de memoria también usa el LLM principal. En el futuro podría optimizarse con un modelo más pequeño/barato.

3. **ASSUMPTION:** Los credentials de conexiones se encriptan con AES-256-GCM, key derivada de una master key en env vars.

4. **ASSUMPTION:** El billing no procesa pagos de suscripción directamente - solo emite eventos de uso para un sistema externo (Stripe Billing o similar).

5. **ASSUMPTION:** La retención de audit logs es 90 días en hot storage, con posibilidad de exportar a cold storage (S3) para compliance extendido.

6. **ASSUMPTION:** El threshold de handoff (2 fallos) es configurable por workspace en `WorkspaceSettings`.
