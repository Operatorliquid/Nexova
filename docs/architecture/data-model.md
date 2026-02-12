# ENTREGABLE 4: Modelo de Datos

## Resumen del Schema

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DATA MODEL OVERVIEW                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

  TENANCY & AUTH                    AGENT RUNTIME
  ══════════════                    ═════════════
  ┌───────────┐                     ┌───────────────┐
  │ Workspace │◄────────────────────│ AgentSession  │
  └─────┬─────┘                     └───────┬───────┘
        │                                   │
        │ 1:N                               │ 1:N
        ▼                                   ▼
  ┌───────────┐                     ┌───────────────┐
  │Membership │                     │ AgentMessage  │
  └─────┬─────┘                     └───────────────┘
        │                                   │
        │ N:1                               │ 1:N
        ▼                                   ▼
  ┌───────────┐  ┌───────────┐      ┌───────────────┐
  │   User    │  │   Role    │      │  AgentMemory  │
  └─────┬─────┘  └───────────┘      └───────────────┘
        │                                   │
        │ 1:N                               │ 1:N
        ▼                                   ▼
  ┌───────────┐  ┌───────────┐      ┌───────────────┐
  │RefreshTkn │  │  Policy   │      │ToolExecution  │
  └───────────┘  └───────────┘      └───────────────┘


  INTEGRATIONS                      RETAIL DOMAIN
  ════════════                      ═════════════
  ┌───────────┐                     ┌───────────┐
  │Connection │                     │  Product  │◄──┐
  └───────────┘                     └─────┬─────┘   │
                                          │         │
  ┌───────────┐                           │ 1:N     │ N:1
  │WebhookInbx│                           ▼         │
  └───────────┘                     ┌───────────┐   │
                                    │  Variant  │   │
  ┌───────────┐                     └─────┬─────┘   │
  │EventOutbox│                           │         │
  └───────────┘                           │ 1:N     │
                                          ▼         │
                                    ┌───────────┐   │
  ┌───────────┐                     │ StockItem │   │
  │ Customer  │◄───────────────┐    └───────────┘   │
  └─────┬─────┘                │                    │
        │                      │                    │
        │ 1:N                  │ N:1                │
        ▼                      │                    │
  ┌───────────┐          ┌─────┴─────┐              │
  │  Address  │          │   Order   │──────────────┘
  └───────────┘          └─────┬─────┘
                               │
                               │ 1:N
                               ▼
                         ┌───────────┐
                         │ OrderItem │
                         └───────────┘
                               │
                               │ 1:N
                               ▼
                         ┌───────────┐
                         │  Payment  │
                         └───────────┘
```

---

## Tablas por Dominio

### Tenancy & Auth (9 tablas)

| Tabla | Descripción | Soft Delete |
|-------|-------------|-------------|
| `workspaces` | Tenants del sistema | No |
| `users` | Usuarios autenticados | No |
| `memberships` | User ↔ Workspace con Role | No |
| `roles` | Definiciones de roles (RBAC) | No |
| `policies` | Reglas ABAC | No |
| `refresh_tokens` | JWT refresh tokens | No (TTL) |
| `password_resets` | Tokens de reset | No (TTL) |

### Agent Runtime (6 tablas)

| Tabla | Descripción | Soft Delete |
|-------|-------------|-------------|
| `agent_sessions` | Sesiones de conversación | No (endedAt) |
| `agent_messages` | Mensajes de la conversación | No |
| `agent_memories` | Contexto comprimido/resumido | No (TTL) |
| `agent_tool_executions` | Log de llamadas a tools | No |
| `handoff_requests` | Solicitudes de handoff a humano | No |

### Integrations (3 tablas)

| Tabla | Descripción | Soft Delete |
|-------|-------------|-------------|
| `connections` | Credenciales de integraciones | No |
| `webhook_inbox` | Webhooks entrantes (idempotencia) | No |
| `event_outbox` | Eventos para publicar (outbox pattern) | No |

### Retail Domain (11 tablas)

| Tabla | Descripción | Soft Delete |
|-------|-------------|-------------|
| `products` | Catálogo de productos | ✅ `deleted_at` |
| `product_variants` | Variantes de producto | ✅ `deleted_at` |
| `stock_items` | Niveles de inventario | No |
| `stock_movements` | Historial de movimientos | No |
| `stock_reservations` | Reservas temporales | No |
| `customers` | Contactos/compradores | ✅ `deleted_at` |
| `customer_addresses` | Direcciones de envío/facturación | No |
| `orders` | Pedidos | ✅ `deleted_at` |
| `order_items` | Líneas de pedido | No |
| `order_status_history` | Historial de estados | No |
| `payments` | Transacciones de pago | No |
| `attachments` | Archivos adjuntos | No |

### Observability (2 tablas)

| Tabla | Descripción | Soft Delete |
|-------|-------------|-------------|
| `audit_logs` | Log de auditoría inmutable | No |
| `usage_records` | Métricas de uso para billing | No |

---

## Índices Clave

### Multi-tenant Scope
```sql
-- Todos los queries principales filtran por workspace_id
@@index([workspaceId, status])
@@index([workspaceId, createdAt])
```

### Idempotencia
```sql
-- Webhooks: único por provider + externalId por workspace
@@unique([workspaceId, provider, externalId])

-- Messages: único por session + externalId
@@unique([sessionId, externalId])
```

### External ID Lookups
```sql
-- Customers por external ID (CRM sync)
@@unique([workspaceId, externalId])

-- Payments por provider + externalId
@@unique([provider, externalId])
```

### Estado y Filtros Frecuentes
```sql
-- Orders por estado
@@index([workspaceId, status])

-- Agent sessions activas
@@index([workspaceId, agentActive])

-- Stock bajo threshold
@@index([quantity])
```

---

## Constraints Importantes

### Unique Constraints

| Tabla | Constraint | Propósito |
|-------|------------|-----------|
| `workspaces` | `slug` | URL-safe identifier único |
| `users` | `email` | Login único |
| `memberships` | `[userId, workspaceId]` | Un user, un membership por workspace |
| `roles` | `[workspaceId, name]` | Roles únicos por workspace |
| `products` | `[workspaceId, sku]` | SKU único por workspace |
| `customers` | `[workspaceId, phone]` | Teléfono único por workspace |
| `orders` | `[workspaceId, orderNumber]` | Número de orden único |
| `webhook_inbox` | `[workspaceId, provider, externalId]` | Idempotencia de webhooks |
| `agent_sessions` | `[workspaceId, channelId, channelType]` | Una sesión activa por canal |

### Foreign Keys con Cascade

```prisma
// Workspace cascade: eliminar workspace elimina todo
onDelete: Cascade

// User references: mantener audit trail
onDelete: SetNull  // Para audit_logs.actorId
```

---

## Campos Especiales

### Encrypted Fields
```
connections.credentials_enc  -- AES-256-GCM
connections.credentials_iv   -- IV para decryption
users.mfa_secret            -- TOTP secret
users.mfa_backup_codes      -- Backup codes
```

### JSON Fields
```
workspaces.settings         -- Configuración del tenant
products.attributes         -- Atributos dinámicos
products.images            -- Array de URLs
orders.shipping_address    -- Snapshot de dirección
orders.metadata            -- Datos adicionales
agent_sessions.metadata    -- Cart, context
```

### Soft Delete Pattern
```prisma
deletedAt DateTime? @map("deleted_at")

@@index([deletedAt])

// Query: WHERE deleted_at IS NULL
```

---

## Relaciones Polimórficas

### Attachments
```prisma
model Attachment {
  refType  String  // "Order", "Payment", "Customer"
  refId    String  // ID de la entidad
}
```

### Stock Movements
```prisma
model StockMovement {
  referenceType String?  // "Order", "StockReservation"
  referenceId   String?  // ID de la referencia
}
```

---

## ASSUMPTIONS

1. **ASSUMPTION:** Precios en `Int` representando la menor unidad de moneda (centavos/centavitos). Para ARS con 2 decimales, $100.50 = 10050.

2. **ASSUMPTION:** `BigInt` para `totalSpent` y `quantity` en `usage_records` para evitar overflow en workspaces de alto volumen.

3. **ASSUMPTION:** Refresh tokens usan SHA-256 hash del token real; el token real nunca se almacena.

4. **ASSUMPTION:** MFA backup codes se almacenan como JSON array encriptado. Se consumen uno a uno.

5. **ASSUMPTION:** `agent_sessions` tiene constraint unique en `[workspaceId, channelId, channelType]` para asegurar una sesión activa por canal. Las sesiones cerradas (`endedAt IS NOT NULL`) no participan en el constraint via partial index.

6. **ASSUMPTION:** `stock_reservations` expiran automáticamente. Un job scheduled debe liberar reservas expiradas.

7. **ASSUMPTION:** `order_number` se genera con formato configurable por workspace (ej: "ORD-2024-00001").
